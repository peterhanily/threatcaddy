/**
 * SEC-2 through the whole App: the share confirmation guards the real folder update, the
 * outbox and the investigation replay, for the Cloud Sync button and the Keep on this device switch.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import { syncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { suppressSyncInCurrentTransaction } from '../lib/sync-state';
import type { ChatThread } from '../types';
import enInvestigations from '../../public/locales/en/investigations.json';

const team = vi.hoisted(() => ({ connected: false }));
// The team server is never contacted: connection state, sync transport and the remote list are stubbed.
vi.mock('../contexts/AuthContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../contexts/AuthContext')>();
  return { ...actual, useAuth: () => {
    const auth = actual.useAuth();
    return team.connected
      ? { ...auth, connected: true, serverUrl: 'https://team.example.invalid', user: { id: 'analyst', email: 'analyst@example.invalid', displayName: 'Fictional Analyst', role: 'analyst' } }
      : auth;
  } };
});
vi.mock('../hooks/useServerSync', () => ({ useServerSync: () => ({ presenceFor: () => [], reportPresence: () => {}, syncConflicts: [], syncError: null,
  setSyncConflicts: () => {}, handleResolveConflict: () => {}, handleResolveAllConflicts: () => {} }) }));
vi.mock('../hooks/useRemoteInvestigations', () => ({ useRemoteInvestigations: () => ({ remoteInvestigations: [], loading: false, refresh: async () => {} }) }));

const en = enInvestigations as Record<string, string>;
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

const chat: ChatThread = { id: 'hunt', title: 'Hunting chat', folderId: 'case', model: 'synthetic-model', provider: 'anthropic', tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'reply', role: 'assistant', content: 'Fictional reply quoting another case', createdAt: 1 }] };
const queued = async () => (await db.table('_syncQueue').toArray()).map(row => `${row.table}:${row.entityId}`);

beforeEach(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {},
    removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in this test'); }));
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
    await db.folders.add({ id: 'case', name: 'Hunting case', order: 0, status: 'active', createdAt: 1, localOnly: true });
    await db.chatThreads.add(chat);
  });
});
afterEach(() => { team.connected = false; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openDetails() {
  render(<App />);
  fireEvent.click((await screen.findAllByRole('button', { name: /^Investigations/ }))[0]);
  const card = await screen.findByRole('group', { name: 'Hunting case' });
  fireEvent.click(within(card).getByRole('button', { name: 'Actions' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Settings' }));
}

async function confirmShare(action: 'Cancel' | 'Share', message: string) {
  const dialog = await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] });
  expect(dialog).toHaveTextContent(message);
  fireEvent.click(within(dialog).getByRole('button', { name: action === 'Share' ? en['detail.shareAiConfirm'] : 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: en['detail.shareAiTitle'] })).toBeNull());
}

describe('sharing a local-only investigation that holds a conversation', () => {
  it('Cloud Sync: Cancel keeps it local-only and queues nothing; Share syncs it now', async () => {
    team.connected = true;
    await ensureSyncWorkspace('https://team.example.invalid', 'analyst');
    const syncFolder = vi.spyOn(syncEngine, 'syncFolder').mockResolvedValue(undefined);
    await openDetails();

    fireEvent.click(await screen.findByRole('button', { name: /^Local only/ }));
    await confirmShare('Cancel', en['detail.shareAiMessageNow']);
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    expect((await db.folders.get('case'))?.localOnly).toBe(true);
    expect(await queued()).toEqual([]);
    expect(syncFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Local only/ }));
    await confirmShare('Share', en['detail.shareAiMessageNow']);
    await waitFor(async () => expect((await db.folders.get('case'))?.localOnly).toBe(false));
    await waitFor(() => expect(syncFolder).toHaveBeenCalledExactlyOnceWith('case'));
    expect(await queued()).toContain('folders:case');
  }, 30_000);

  it('Keep on this device: Cancel keeps it local-only; Share lets it sync once a team server is connected', async () => {
    const syncFolder = vi.spyOn(syncEngine, 'syncFolder').mockResolvedValue(undefined);
    await openDetails();
    const keepLocal = () => screen.findByRole('switch', { name: /Keep on this device/ });
    expect(await keepLocal()).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(await keepLocal());
    await confirmShare('Cancel', en['detail.shareAiMessageLater']);
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    expect((await db.folders.get('case'))?.localOnly).toBe(true);
    expect(await keepLocal()).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(await keepLocal());
    await confirmShare('Share', en['detail.shareAiMessageLater']);
    await waitFor(async () => expect((await db.folders.get('case'))?.localOnly).toBe(false));
    await waitFor(async () => expect(await keepLocal()).toHaveAttribute('aria-checked', 'false'));
    expect(syncFolder).not.toHaveBeenCalled();
    expect(await queued()).toEqual([]);
  }, 30_000);
});
