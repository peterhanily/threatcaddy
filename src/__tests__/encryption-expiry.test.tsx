import Dexie from 'dexie';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMasterKey, exportKeyRaw, arrayBufferToBase64 } from '../lib/crypto';
import { setEncryptionMeta, clearEncryptionMeta, isEncryptionEnabled, cacheSessionKey, getCachedSession, getCachedSessionKey } from '../lib/encryptionStore';
import { getSessionKey, getSessionKeyRaw, installEncryptionMiddleware, lockEncryptionSession, setSessionKey, updateSessionDuration, decryptAllExistingData } from '../lib/encryptionMiddleware';
import { restoreWorkspaceRecovery, registerLockParticipant, SealedRecovery } from '../lib/workspace-lock';
import { getEntityDraft, getFailedDrafts } from '../lib/entity-drafts';
import { getComposerDraft, setComposerText, discardAllComposerDrafts } from '../lib/chat-composer-drafts';
import { cancellableRequest } from '../lib/request-cancellation';

vi.mock('../App', () => ({ default: () => <div>Private workspace content</div> }));
vi.mock('../components/Encryption/PassphraseDialog', () => ({ PassphraseDialog: () => <div>Workspace locked</div> }));
vi.mock('../lib/workspace-initialization', () => ({ initializeWorkspace: vi.fn(async () => {}) }));
import { initializeWorkspace } from '../lib/workspace-initialization';
import { AppShell } from '../components/Encryption/AppShell';

const HOUR = 3_600_000;
const START = 1_800_000_000_000;
const metadata = (duration: '1h' | '8h' | '24h' | 'tab-close' | 'every-load' = '1h') => ({
  version: 1 as const, salt: 'test', wrappedKey: 'test', recoverySalt: 'test', recoveryWrappedKey: 'test',
  enabledAt: 1, coverageVersion: 2, sessionDuration: duration,
});
let key: CryptoKey;
let raw: string;
beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null);
  key = await generateMasterKey(); raw = arrayBufferToBase64(await exportKeyRaw(key));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START);
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers();
  // Restore any intentionally sealed fixture drafts so each test can discard them.
  setEncryptionMeta(metadata('tab-close')); setSessionKey(key);
  await restoreWorkspaceRecovery(key, () => true);
  for (const { draft } of getFailedDrafts()) draft.discard(true);
  discardAllComposerDrafts(); clearEncryptionMeta(); setSessionKey(null);
});

describe('encryption session deadlines', () => {

  it('recovers sealed drafts before mounting after an interrupted disable finishes', async () => {
    const fixture = new Dexie('disable-recovery-fixture'); fixture.version(1).stores({ notes: 'id' });
    installEncryptionMiddleware(fixture); await fixture.open();
    setEncryptionMeta(metadata()); setSessionKey(key, raw);
    await fixture.table('notes').put({ id: 'saved', title: 'Saved content' });
    const draft = getEntityDraft('disable-recovered-draft');
    draft.queue({ title: 'Unconfirmed edit' }, HOUR);
    setComposerText('disable-recovered-composer', 'Unsent prompt');
    lockEncryptionSession();
    setEncryptionMeta({ ...metadata(), transition: 'decrypting' });
    cacheSessionKey(raw, '1h');
    vi.mocked(initializeWorkspace).mockImplementationOnce(() => decryptAllExistingData(fixture));
    render(<AppShell />); await screen.findByText('Private workspace content');
    expect(isEncryptionEnabled()).toBe(false); expect(getSessionKey()).toBeNull();
    expect(draft.getSnapshot().patch.title).toBe('Unconfirmed edit');
    expect(getComposerDraft('disable-recovered-composer').text).toBe('Unsent prompt');
    draft.discard(true); await fixture.delete();
  });


  it('still closes the UI and permits a later unlock when session storage removal fails', async () => {
    setEncryptionMeta(metadata()); cacheSessionKey(raw, '1h');
    render(<AppShell />); await screen.findByText('Private workspace content');
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    try { act(() => { lockEncryptionSession(); }); }
    finally { remove.mockRestore(); }
    expect(getSessionKey()).toBeNull(); expect(screen.queryByText('Private workspace content')).not.toBeInTheDocument();
    setSessionKey(key, raw); expect(getSessionKey()).toBe(key);
  });


  it('still seals later participants and revokes the key if an earlier participant fails', () => {
    setEncryptionMeta(metadata()); setSessionKey(key, raw);
    const removeFailure = registerLockParticipant({ seal: () => { throw new Error('fixture participant failure'); }, restore: async () => {} });
    const later = vi.fn();
    const removeLater = registerLockParticipant({ seal: later, restore: async () => {} });
    const listener = vi.fn(); window.addEventListener('workspace-locked', listener);
    try {
      expect(() => lockEncryptionSession()).not.toThrow();
      expect(getSessionKey()).toBeNull(); expect(later).toHaveBeenCalledWith(key);
      expect((listener.mock.calls[0][0] as CustomEvent).detail.recoveryFailed).toBe(true);
    } finally { removeFailure(); removeLater(); window.removeEventListener('workspace-locked', listener); }
  });

  it('keeps an inaccessible recovery copy if Web Crypto fails instead of destroying unsaved work', async () => {
    const recovery = new SealedRecovery<{ text: string }>();
    vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('fixture crypto failure'));
    recovery.seal({ text: 'Only unsaved copy' }, key);
    expect(await recovery.open(key)).toEqual({ text: 'Only unsaved copy' });
    recovery.clear(); expect(recovery.hasValue()).toBe(false);
  });

  it('reseals partially restored drafts if another lock interrupts recovery', async () => {
    setEncryptionMeta(metadata()); setSessionKey(key, raw);
    const draft = getEntityDraft('double-lock-draft');
    draft.queue({ content: 'Draft across two locks' }, HOUR);
    setComposerText('double-lock-composer', 'Prompt across two locks');
    lockEncryptionSession();
    let lockAgain = true;
    const remove = registerLockParticipant({ seal: () => {}, restore: async () => {
      if (lockAgain) { lockAgain = false; lockEncryptionSession(); }
    } });
    try {
      setSessionKey(key, raw);
      await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
      expect(getSessionKey()).toBeNull();
      expect(draft.getSnapshot().patch).toEqual({});
      expect(getComposerDraft('double-lock-composer').text).toBe('');
      setSessionKey(key, raw); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
      expect(draft.getSnapshot().patch.content).toBe('Draft across two locks');
      expect(getComposerDraft('double-lock-composer').text).toBe('Prompt across two locks');
      draft.discard(true);
    } finally { remove(); }
  });

  it('unmounts sensitive UI at the deadline even without activity, and clears cached/raw keys', async () => {
    setEncryptionMeta(metadata()); cacheSessionKey(raw, '1h');
    render(<AppShell />);
    expect(await screen.findByText('Private workspace content')).toBeInTheDocument();
    // Run just the session timer; database fixtures use real IndexedDB scheduling.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    setSessionKey(getSessionKey(), raw, START);
    await act(async () => { vi.advanceTimersByTime(HOUR); });
    expect(screen.queryByText('Private workspace content')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace locked')).toBeInTheDocument();
    expect(getSessionKey()).toBeNull(); expect(getSessionKeyRaw()).toBeNull();
    expect(getCachedSessionKey()).toBeNull();
  });

  it.each(['focus', 'pageshow', 'visibilitychange'])('locks on %s after sleep without waiting for a suspended timer', async event => {
    setEncryptionMeta(metadata()); cacheSessionKey(raw, '1h');
    render(<AppShell />); await screen.findByText('Private workspace content');
    vi.setSystemTime(START + HOUR);
    act(() => { (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)); });
    expect(screen.queryByText('Private workspace content')).not.toBeInTheDocument();
    expect(getSessionKey()).toBeNull();
  });

  it('keeps the original deadline after reload and honors the full 24 hour choice', async () => {
    setEncryptionMeta(metadata('24h')); cacheSessionKey(raw, '24h');
    vi.setSystemTime(START + 9 * HOUR);
    expect(getCachedSession()?.expiresAt).toBe(START + 24 * HOUR);
    render(<AppShell />); await screen.findByText('Private workspace content');
    vi.setSystemTime(START + 24 * HOUR - 1); expect(getSessionKey()).not.toBeNull();
    act(() => { vi.setSystemTime(START + 24 * HOUR); window.dispatchEvent(new Event('focus')); });
    expect(getSessionKey()).toBeNull(); expect(screen.getByText('Workspace locked')).toBeInTheDocument();
  });

  it('shortens a duration from its original unlock time, rather than restarting it', () => {
    setEncryptionMeta(metadata('8h')); setSessionKey(key, raw);
    vi.setSystemTime(START + 2 * HOUR); setEncryptionMeta(metadata('1h'));
    updateSessionDuration(); expect(getSessionKey()).toBeNull(); expect(getCachedSessionKey()).toBeNull();
  });

  it.each(['every-load', 'tab-close'] as const)('does not impose a timed deadline on %s', duration => {
    setEncryptionMeta(metadata(duration)); setSessionKey(key, raw);
    vi.setSystemTime(START + 48 * HOUR); expect(getSessionKey()).toBe(key);
  });

  it('locks on encryption changes or storage clearing in another tab', async () => {
    setEncryptionMeta(metadata()); cacheSessionKey(raw, '1h');
    render(<AppShell />); await screen.findByText('Private workspace content');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(getSessionKey()).toBeNull(); expect(screen.getByText('Workspace locked')).toBeInTheDocument();
  });

  it('rejects stale encrypted writes and late plaintext reads across a lock', async () => {
    const fixture = new Dexie('deadline-race-fixture'); fixture.version(1).stores({ notes: 'id' });
    installEncryptionMiddleware(fixture); await fixture.open();
    setEncryptionMeta(metadata()); setSessionKey(key, raw);
    await fixture.table('notes').put({ id: 'old', title: 'Stored private content' });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      const ciphertext = await encrypt(...args); lockEncryptionSession(); return ciphertext;
    });
    await expect(fixture.table('notes').put({ id: 'late', title: 'Uncommitted private content' })).rejects.toThrow(/locked|session changed/);
    expect(await fixture.table('notes').get('late')).toBeUndefined();
    setSessionKey(key, raw);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      const plaintext = await decrypt(...args); lockEncryptionSession(); return plaintext;
    });
    await expect(fixture.table('notes').get('old')).rejects.toThrow(/locked|session changed/);
    await fixture.delete();
  });

  it('seals unsaved work, aborts provider requests, and recovers drafts without replaying uncertain writes', async () => {
    setEncryptionMeta(metadata()); setSessionKey(key, raw);
    const draft = getEntityDraft('deadline-recovery');
    let finish!: () => void;
    const persist = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const detach = draft.attach(persist);
    draft.queue({ title: 'Unsaved private edit' }, HOUR);
    const write = draft.flush(); await Promise.resolve();
    setComposerText('deadline-thread', 'Unsent private prompt');
    const request = cancellableRequest();
    lockEncryptionSession();
    expect(request.signal.aborted).toBe(true);
    expect(draft.getSnapshot().patch).toEqual({}); expect(getFailedDrafts()).toEqual([]);
    expect(getComposerDraft('deadline-thread').text).toBe('');
    finish(); await write; detach();
    expect(draft.getSnapshot().patch).toEqual({});
    setSessionKey(key, raw); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
    expect(draft.getSnapshot().patch.title).toBe('Unsaved private edit');
    expect(draft.getSnapshot().status).toBe('error'); expect(persist).toHaveBeenCalledTimes(1);
    expect(getComposerDraft('deadline-thread').text).toBe('Unsent private prompt');
    request.dispose(); draft.discard(true);
  });
});
