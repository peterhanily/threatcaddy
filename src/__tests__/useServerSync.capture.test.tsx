import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import commonEn from '../../public/locales/en/common.json';
import commonDe from '../../public/locales/de/common.json';
import { db } from '../db';
import { useServerSync } from '../hooks/useServerSync';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { SYNC_RECOVERY_KEY, SYNC_CAPTURE_KEY } from '../lib/sync-capture-policy';
import { suppressSyncInCurrentTransaction } from '../lib/sync-state';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), configure: vi.fn() }));
vi.mock('../lib/server-api', () => ({ configureServerApi: mocks.configure }));
vi.mock('../lib/sync-engine', () => ({ syncEngine: {
  start: mocks.start, stop: mocks.stop, setWSClient: vi.fn(), setWorkspaceIdentity: vi.fn(), setErrorHandler: vi.fn(),
  setConflictHandler: vi.fn(), setReadyHandler: vi.fn(), setRemoteChangeHandler: vi.fn(),
} }));
vi.mock('../lib/ws-client', () => ({ WSClient: class { connect() {} disconnect() {} on() {} onStatusChange() {} } }));
const note = { id: 'n', folderId: 'f', title: 'Retained', content: 'Harmless synthetic note', tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
const reloads = { notes: vi.fn(), tasks: vi.fn(), timeline: vi.fn(), timelines: vi.fn(), whiteboards: vi.fn(), standaloneIOCs: vi.fn(), chats: vi.fn(), folders: vi.fn(), tags: vi.fn() };
const auth = { user: { id: 'alice' } as { id: string } | null, serverUrl: 'https://test.invalid' as string | null, connected: true, getAccessToken: async () => null, setReachable: vi.fn() };

beforeEach(async () => {
  vi.clearAllMocks();
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
  });
  await db.folders.add({ id: 'f', name: 'Synthetic case', order: 0, createdAt: 1 });
  await ensureSyncWorkspace('https://test.invalid', 'alice');
});

describe('transport lifecycle never owns signed-out capture', () => {
  it('keeps capturing after StrictMode cleanup, logout and unmount', async () => {
    const { rerender, unmount } = renderHook(({ value }) => useServerSync(value, reloads), {
      initialProps: { value: auth }, reactStrictMode: true,
    });
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    rerender({ value: { ...auth, user: null, serverUrl: null, connected: false } });
    await act(async () => { await db.notes.add(note); });
    unmount();
    await db.notes.update('n', { title: 'Still durable after unmount' });
    expect((await db.table('_syncQueue').toArray()).map(row => row.data.title)).toEqual(['Retained', 'Still durable after unmount']);
    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.configure).toHaveBeenLastCalledWith(null, expect.any(Function));
  });

  it('shows and clears the durable recovery pause while signed out', async () => {
    const signedOut = { ...auth, user: null, serverUrl: null, connected: false };
    const { result } = renderHook(() => useServerSync(signedOut, reloads));
    await act(async () => { await db.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: true }); });
    await waitFor(() => expect(result.current.syncError).toContain('Sync history recovery'));
    await act(async () => { await db.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: false }); });
    await waitFor(() => expect(result.current.syncError).toBeNull());
    await act(async () => { await db.table('_localMigrations').put({ key: SYNC_CAPTURE_KEY, version: 1, state: 'reconciliation-required', reason: 'legacy-capture-gap' }); });
    await waitFor(() => expect(result.current.syncError).toContain('signed out'));
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('explains the durable pause in the interface language and follows a language change', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'de', fallbackLng: 'en', defaultNS: 'common', interpolation: { escapeValue: false },
      resources: { en: { common: commonEn }, de: { common: commonDe } } });
    const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={locale}>{children}</I18nextProvider>;
    const signedOut = { ...auth, user: null, serverUrl: null, connected: false };
    const { result } = renderHook(() => useServerSync(signedOut, reloads), { wrapper });
    await act(async () => { await db.table('_syncMeta').put({ key: SYNC_RECOVERY_KEY, value: true }); });
    await waitFor(() => expect(result.current.syncError).toBe(commonDe['syncStatus.pausedHistory']));
    expect(commonDe['syncStatus.pausedHistory']).not.toBe(commonEn['syncStatus.pausedHistory']);
    await act(async () => { await locale.changeLanguage('en'); });
    expect(result.current.syncError).toBe(commonEn['syncStatus.pausedHistory']);
    await act(async () => { await locale.changeLanguage('de'); });
    await act(async () => { await db.table('_localMigrations').put({ key: SYNC_CAPTURE_KEY, version: 1, state: 'reconciliation-required', reason: 'legacy-capture-gap' }); });
    await waitFor(() => expect(result.current.syncError).toBe(commonDe['syncStatus.pausedCapture']));
  });
});
