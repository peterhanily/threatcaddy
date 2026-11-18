/** The whole App in German: the phone Analyst Mode banner, the screenshare-hidden view, the loading fallbacks and the
 * product draft, remote investigation and standalone banners use the analyst's language. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, getConfig, render, screen, within } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import i18n from '../i18n';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import deCommon from '../../public/locales/de/common.json';
import deExec from '../../public/locales/de/exec.json';
import deInvestigations from '../../public/locales/de/investigations.json';

const de = { common: deCommon as Record<string, string>, exec: deExec as Record<string, string>, investigations: deInvestigations as Record<string, string> };

// Inert unless a test turns them on: a view that never finishes loading, and the standalone file:// warning.
const control = vi.hoisted(() => ({ suspend: false, never: new Promise<never>(() => {}), fileWarning: false }));
vi.mock('../components/Chat/ChatView', () => ({ ChatView: () => { if (control.suspend) throw control.never; return null; } }));
vi.mock('../components/ExecMode/ExecDashboard', () => ({ ExecDashboard: () => { if (control.suspend) throw control.never; return null; } }));
vi.mock('../contexts/UIModalContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/UIModalContext')>();
  return { ...actual, useUIModals: () => {
    const ui = actual.useUIModals();
    return control.fileWarning ? { ...ui, showFileEncryptionWarning: true } : ui;
  } };
});
// A product composer that keeps a draft, and a hub that opens a team server investigation without a server.
vi.mock('../components/Products/ProductView', async () => {
  const { useEffect } = await import('react');
  return { ProductView: ({ onComposerSessionChange }: { onComposerSessionChange?: (folderId?: string) => void }) => {
    useEffect(() => { onComposerSessionChange?.('case'); }, [onComposerSessionChange]);
    return null;
  } };
});
vi.mock('../components/Investigations/InvestigationsHub', () => ({
  InvestigationsHub: ({ onOpenInvestigation }: { onOpenInvestigation: (id: string, mode: 'remote') => void }) =>
    <button onClick={() => onOpenInvestigation('remote-case', 'remote')}>Open synthetic remote investigation</button>,
}));
vi.mock('../hooks/useInvestigationData', () => {
  const empty = { notes: [], tasks: [], events: [], whiteboards: [], iocs: [], chats: [], evidence: [], loading: false,
    loadedSuccessfully: true, error: null, refresh: async () => {}, isRemote: true };
  return { useInvestigationData: () => empty };
});

// A cold render of the App and its lazy chunks can exceed the default timeouts under a loaded suite.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

const stubWidth = (phone: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: phone && query === '(max-width: 767px)', media: query, onchange: null, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await Promise.all(db.tables.map(table => table.clear()));
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  i18n.addResourceBundle('de', 'exec', deExec, true, true);
  i18n.addResourceBundle('de', 'investigations', deInvestigations, true, true);
  localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ language: 'de' }));
});
afterEach(async () => {
  control.suspend = false;
  control.fileWarning = false;
  vi.unstubAllGlobals();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('app shell text', () => {
  it('shows the phone Analyst Mode banner in the analyst\'s language', async () => {
    expect(de.exec['dashboard.analystModeBanner']).toBeTruthy();
    stubWidth(true);
    sessionStorage.setItem('tc-analyst-mode', '1');
    render(<App />);
    expect(await screen.findByText(de.exec['dashboard.analystModeBanner'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.exec['dashboard.backToExecView'] })).toBeInTheDocument();
    expect(screen.queryByText('Analyst Mode — optimized for desktop')).toBeNull();
  }, 30_000);

  it('says a view is hidden while screensharing, and offers the way back, in the analyst\'s language', async () => {
    expect(de.common['screenshare.browseVisible']).toBeTruthy();
    expect(de.common['screenshare.viewHidden']).toBeTruthy();
    stubWidth(false);
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: de.common['screenshare.toggle'] }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: de.common['screenshare.showUpTo'].replace('{{level}}', 'TLP:CLEAR') }));
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${de.common['sidebar.settings']}`) }))[0]);
    const back = await screen.findByRole('button', { name: de.common['screenshare.browseVisible'] });
    expect(screen.getByText(de.common['screenshare.viewHidden'])).toBeInTheDocument();
    expect(screen.queryByText('This view is hidden while screensharing.')).toBeNull();
    expect(screen.queryByText('Browse visible investigations')).toBeNull();
    fireEvent.click(back);
    expect(screen.queryByRole('button', { name: de.common['screenshare.browseVisible'] })).toBeNull();
  }, 30_000);

  it('shows the analyst view\'s and the phone dashboard\'s loading text in the analyst\'s language', async () => {
    control.suspend = true;
    stubWidth(false);
    const analyst = render(<App />);
    expect(await screen.findByText(de.common.loadingView)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
    analyst.unmount();
    stubWidth(true);
    render(<App />);
    expect(await screen.findByText(de.common.loadingView)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  }, 30_000);

  it('offers to resume a product draft kept in this tab in the analyst\'s language', async () => {
    await db.folders.add({ id: 'case', name: 'Fictional Case Alpha', order: 0, status: 'active', createdAt: 1 });
    stubWidth(false);
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${de.common['sidebar.products']}`) }))[0]);
    expect(await screen.findByText(de.common['productDraft.retained'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.common['productDraft.resume'] })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved product draft retained in this tab.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume draft' })).toBeNull();
  }, 30_000);

  it('says what a remote investigation keeps on this device, and offers to sync it, in the analyst\'s language', async () => {
    stubWidth(false);
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${de.common['sidebar.investigations']}`) }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open synthetic remote investigation' }));
    expect(await screen.findByText(de.investigations['remote.viewingBanner'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.investigations['card.syncLocally'] })).toBeInTheDocument();
    expect(screen.queryByText(/Viewing (a )?remote investigation/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync locally' })).toBeNull();
  }, 30_000);

  it('warns about an unencrypted standalone file in the analyst\'s language, with its Settings link', async () => {
    control.fileWarning = true;
    stubWidth(false);
    render(<App />);
    const enable = await screen.findByRole('button', { name: de.common['standaloneWarning.enableEncryption'] });
    const banner = enable.closest('div') as HTMLElement;
    expect(enable.parentElement).toHaveTextContent(de.common['standaloneWarning.message']);
    expect(banner).not.toHaveTextContent(/Running standalone|Enable encryption|Dismiss/);
    fireEvent.click(within(banner).getByRole('button', { name: de.common.dismiss }));
    expect(screen.queryByRole('button', { name: de.common['standaloneWarning.enableEncryption'] })).toBeNull();
  }, 30_000);
});
