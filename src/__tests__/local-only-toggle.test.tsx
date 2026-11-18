import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import { syncEngine } from '../lib/sync-engine';
import { SYNC_WORKSPACE_KEY } from '../lib/sync-capture-policy';
import { InvestigationDetailPanel } from '../components/Investigation/InvestigationDetailPanel';
import { ToastProvider } from '../contexts/ToastContext';
import type { Folder } from '../types';

// The whole App, so the toggle drives the real folder update and outbox privacy marker.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

const privacyMarker = async () => (await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'case'])))?.value;

beforeEach(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {},
    removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add({ id: 'case', name: 'Solo case', order: 0, status: 'active', createdAt: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('D-LOCAL-1 local-only without a team server', () => {
  it('an unbound workspace can keep an investigation on this device without calling syncFolder', async () => {
    const syncFolder = vi.spyOn(syncEngine, 'syncFolder').mockResolvedValue(undefined);
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Investigations/ }))[0]);
    const card = await screen.findByRole('group', { name: 'Solo case' });
    fireEvent.click(within(card).getByRole('button', { name: 'Actions' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Settings' }));
    const toggle = await screen.findByRole('switch', { name: /Keep on this device/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    await waitFor(async () => expect((await db.folders.get('case'))?.localOnly).toBe(true));
    expect(await privacyMarker()).toBe(true);
    await waitFor(() => expect(screen.getByRole('switch', { name: /Keep on this device/ })).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(screen.getByRole('switch', { name: /Keep on this device/ }));
    await waitFor(async () => expect((await db.folders.get('case'))?.localOnly).toBe(false));
    expect(await privacyMarker()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(syncFolder).not.toHaveBeenCalled();
  }, 30_000);
});

describe('investigation privacy copy', () => {
  const folder: Folder = { id: 'case', name: 'Shared case', order: 0, status: 'active', createdAt: 1, localOnly: true };
  const props = { onUpdate: vi.fn(), onClose: vi.fn(), allTags: [], onCreateTag: vi.fn(), entityCounts: { notes: 0, tasks: 0, events: 0, whiteboards: 0 }, effectiveClsLevels: [] };
  const panel = (extra: Partial<Parameters<typeof InvestigationDetailPanel>[0]>) => <ToastProvider><InvestigationDetailPanel {...props} folder={folder} {...extra} /></ToastProvider>;

  it('says local-only investigations are hidden from AI elsewhere, with or without a server', async () => {
    const onToggleSync = vi.fn();
    const view = render(panel({ serverConnected: true, onToggleSync }));
    expect(screen.getByText(/AI working in investigations that can sync cannot see it/)).toBeInTheDocument();
    view.unmount();
    render(panel({ serverConnected: false, onToggleSync }));
    fireEvent.click(await screen.findByRole('switch', { name: /Keep on this device/ }));
    expect(screen.getByText(/AI working in investigations that can sync cannot see it/)).toBeInTheDocument();
    // Sharing first checks for AI-written content (local-only-share-confirm.test.tsx).
    await waitFor(() => expect(onToggleSync).toHaveBeenCalledExactlyOnceWith('case', true));
  });

  it('says AI requests with its content still follow the AI route, which may be the team server', async () => {
    const sentence = 'AI requests that include its content still follow the route shown in Settings → AI, which may be the team server.';
    const view = render(panel({ serverConnected: true, onToggleSync: vi.fn() }));
    expect(screen.getByText(/AI working in investigations that can sync cannot see it/)).toHaveTextContent(sentence);
    view.unmount();
    render(panel({ serverConnected: false, onToggleSync: vi.fn() }));
    expect(await screen.findByRole('switch', { name: /Keep on this device/ })).toHaveAccessibleDescription(expect.stringContaining(sentence));
  });

  it('shows no privacy control when the panel cannot change it', () => {
    render(panel({ serverConnected: false }));
    expect(screen.queryByRole('switch', { name: /Keep on this device/ })).not.toBeInTheDocument();
  });

  it('offers no switch in a workspace bound to a team server while it is unreachable', async () => {
    // Re-sharing there must queue a replay of rows skipped while local-only, which needs the connection.
    await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value: { version: 1, serverUrl: 'https://team.example', userId: 'user-1' } });
    render(panel({ serverConnected: false, onToggleSync: vi.fn() }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
