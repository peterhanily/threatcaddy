import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { authStorageKey } from '../lib/auth-storage';
import type { TeamUser } from '../types';
import { db } from '../db';
import { markPending, clearPending } from '../lib/pending-changes';
import { REMOTE_LOGOUT_FAILED } from '../lib/session-logout';

const user: TeamUser = { id: 'alice', email: 'alice@example.com', displayName: 'Alice', role: 'user' };
const auth = { serverUrl: 'https://team.example', accessToken: 'access-original', refreshToken: 'refresh-original', user };
const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
let lockRequest: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem(authStorageKey, JSON.stringify(auth));
  let pending: Promise<unknown> = Promise.resolve();
  lockRequest = vi.fn((_name: string, operationOrOptions: (() => Promise<unknown>) | LockOptions, callback?: () => Promise<unknown>) => {
    const operation = typeof operationOrOptions === 'function' ? operationOrOptions : callback;
    if (!operation) throw new Error('Missing lock operation');
    const result = pending.then(() => {
      if (typeof operationOrOptions !== 'function') operationOrOptions.signal?.throwIfAborted();
      return operation();
    });
    pending = result.catch(() => {});
    return result;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: lockRequest } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.removeItem(authStorageKey);
  if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('AuthProvider shared workspace session lifecycle', () => {
  it('does not switch accounts or close the current DB while a file or chat draft is unsaved', async () => {
    await db.open();
    const pending = Symbol('synthetic unsent work'); markPending(pending);
    const beforeSelection = sessionStorage.getItem('threatcaddy-active-workspace');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: 'new-account-access', refreshToken: 'new-account-refresh', user: { ...user, id: 'other-user' },
    }))));
    const changed = vi.fn(); window.addEventListener('workspace-will-switch', changed);
    try {
      const view = renderHook(useAuth, { wrapper: AuthProvider });
      await act(async () => {
        await expect(view.result.current.login('other@example.com', 'synthetic-password')).rejects.toThrow('Unsent chat drafts or pending file imports require attention');
      });
      expect(changed).not.toHaveBeenCalled(); expect(db.isOpen()).toBe(true);
      expect(sessionStorage.getItem('threatcaddy-active-workspace')).toBe(beforeSelection);
      expect(JSON.parse(localStorage.getItem(authStorageKey) ?? 'null')).toEqual(auth);
    } finally { clearPending(pending); window.removeEventListener('workspace-will-switch', changed); }
  });
  it.each(['login', 'register'] as const)('keeps the %s response deadline active after headers', async operation => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel }))));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    let request!: Promise<void>;
    act(() => { request = operation === 'login' ? view.result.current.login('alice@example.com', 'synthetic') : view.result.current.register('alice@example.com', 'Alice', 'synthetic'); });
    const rejected = expect(request).rejects.toThrow(/deadline exceeded/);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await rejected; });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(authStorageKey)!).refreshToken).toBe('refresh-original');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds login bodies and times out a stalled refresh without losing durable credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Length': '2000000' } })));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    await act(async () => { await expect(view.result.current.login('alice@example.com', 'synthetic')).rejects.toThrow(/size limit/); });
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel })));
    act(() => view.result.current.invalidateAccessToken());
    let refreshing!: Promise<string | null>;
    act(() => { refreshing = view.result.current.getAccessToken(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); expect(await refreshing).toBeNull(); });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(authStorageKey)!).refreshToken).toBe('refresh-original');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes refresh from two provider instances and reuses the rotated durable credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: 'access-rotated', refreshToken: 'refresh-rotated' })));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(useAuth, { wrapper: AuthProvider });
    const second = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => { first.result.current.invalidateAccessToken(); second.result.current.invalidateAccessToken(); });
    let tokens: (string | null)[] = [];
    await act(async () => { tokens = await Promise.all([first.result.current.getAccessToken(), second.result.current.getAccessToken()]); });
    expect(tokens).toEqual(['access-rotated', 'access-rotated']);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lockRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(authStorageKey)!)).toMatchObject({ refreshToken: 'refresh-rotated' });
  });

  it('shares one in-flight refresh within a provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }))));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    await act(async () => { await Promise.all([view.result.current.getAccessToken(), view.result.current.getAccessToken()]); });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not restore a session when a refresh response arrives after logout', async () => {
    let resolveRefresh!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRefresh = resolve; })).mockImplementation(() => Promise.resolve(new Response('{"ok":true}')));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    let refreshing!: Promise<string | null>;
    await act(async () => { refreshing = view.result.current.getAccessToken(); await Promise.resolve(); });
    let loggingOut!: Promise<void>;
    act(() => { loggingOut = view.result.current.logout(); });
    expect(view.result.current.user).toBeNull();
    expect(localStorage.getItem(authStorageKey)).toBeNull();
    let token: string | null = 'unexpected';
    await act(async () => { resolveRefresh(new Response(JSON.stringify({ accessToken: 'late-access', refreshToken: 'late-refresh' }))); token = await refreshing; await loggingOut; });
    expect(token).toBeNull();
    expect(view.result.current.user).toBeNull();
    expect(localStorage.getItem(authStorageKey)).toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://team.example/api/auth/logout');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)).toEqual({ refreshToken: auth.refreshToken });
  });

  it('immediately signs out locally and revokes with refresh proof after access-token invalidation', async () => {
    let resolveLogout!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveLogout = resolve; })));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    let logout!: Promise<void>;
    await act(async () => { logout = view.result.current.logout(); await Promise.resolve(); });
    expect(view.result.current.user).toBeNull();
    expect(view.result.current.connected).toBe(false);
    expect(localStorage.getItem(authStorageKey)).toBeNull();
    expect(await view.result.current.getAccessToken()).toBeNull();
    expect(fetch).toHaveBeenCalledWith('https://team.example/api/auth/logout', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.refreshToken }), redirect: 'error', credentials: 'omit',
    }));
    await act(async () => { resolveLogout(new Response('{"ok":true}')); await logout; });
  });

  it.each([undefined, null, ''])('can revoke a restored refresh credential when the saved access token is %s', async accessToken => {
    localStorage.setItem(authStorageKey, JSON.stringify({ ...auth, accessToken }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    expect(view.result.current.user?.id).toBe(user.id);
    await act(async () => { await view.result.current.logout(); });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ refreshToken: auth.refreshToken });
    expect(localStorage.getItem(authStorageKey)).toBeNull();
  });

  it('revokes the latest durable same-account credential as well as a stale in-memory family', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{"ok":true}'))));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    localStorage.setItem(authStorageKey, JSON.stringify({ ...auth, refreshToken: 'other-tab-latest' }));
    await act(async () => { await view.result.current.logout(); });
    const tokens = vi.mocked(fetch).mock.calls.map(([, request]) => JSON.parse(request?.body as string).refreshToken);
    expect(tokens).toEqual(['other-tab-latest', auth.refreshToken]);
    expect(localStorage.getItem(authStorageKey)).toBeNull();
  });

  it('does not clear another account written to storage while revoking this provider session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    const other = { ...auth, user: { ...user, id: 'bob' }, refreshToken: 'bob-refresh' };
    localStorage.setItem(authStorageKey, JSON.stringify(other));
    await act(async () => { const revocation = view.result.current.logout(); view.result.current.setServerUrl(null); await revocation; });
    expect(JSON.parse(localStorage.getItem(authStorageKey) ?? 'null')).toEqual(other);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).refreshToken).toBe(auth.refreshToken);
  });

  it.each([
    () => Promise.resolve(new Response('{"ok":true}', { status: 503 })),
    () => Promise.resolve(new Response('{}')),
    () => Promise.resolve(new Response('{"ok":true}', { headers: { 'Content-Length': '20000' } })),
    () => Promise.reject(new Error('transport diagnostic with sensitive content')),
  ])('reports unconfirmed remote revocation without restoring credentials or exposing transport details', async response => {
    vi.stubGlobal('fetch', vi.fn(response));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    await act(async () => { await expect(view.result.current.logout()).rejects.toThrow(REMOTE_LOGOUT_FAILED); });
    expect(view.result.current.user).toBeNull();
    expect(localStorage.getItem(authStorageKey)).toBeNull();
  });

  it('bounds a stalled logout receipt and cancels its reader while keeping local sign-out final', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel }))));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    let logout!: Promise<void>;
    act(() => { logout = view.result.current.logout(); });
    const rejected = expect(logout).rejects.toThrow(REMOTE_LOGOUT_FAILED);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); await rejected; });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(localStorage.getItem(authStorageKey)).toBeNull();
  });

  it('can revoke without Web Locks even though token refresh fails closed in that context', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    await act(async () => { await view.result.current.logout(); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(authStorageKey)).toBeNull();
  });

  it('consumes same-identity storage rotation and logout without adopting another account', async () => {
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => {
      localStorage.setItem(authStorageKey, JSON.stringify({ ...auth, accessToken: 'other-tab-access', refreshToken: 'other-tab-refresh' }));
      window.dispatchEvent(new StorageEvent('storage', { key: authStorageKey, storageArea: localStorage }));
    });
    expect(await view.result.current.getAccessToken()).toBe('other-tab-access');
    act(() => {
      localStorage.setItem(authStorageKey, JSON.stringify({ ...auth, user: { ...user, id: 'bob' } }));
      window.dispatchEvent(new StorageEvent('storage', { key: authStorageKey, storageArea: localStorage }));
    });
    expect(view.result.current.user?.id).toBe('alice');
    act(() => {
      localStorage.removeItem(authStorageKey);
      window.dispatchEvent(new StorageEvent('storage', { key: authStorageKey, storageArea: localStorage }));
    });
    expect(view.result.current.user).toBeNull();
    expect(await view.result.current.getAccessToken()).toBeNull();
  });

  it('keeps durable refresh credentials on a transient server failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    await act(async () => { expect(await view.result.current.getAccessToken()).toBeNull(); });
    expect(view.result.current.user?.id).toBe('alice');
    expect(JSON.parse(localStorage.getItem(authStorageKey)!).refreshToken).toBe('refresh-original');
  });

  it('fences a late login response after choosing another endpoint', async () => {
    let resolveLogin!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveLogin = resolve; })));
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    let login!: Promise<void>;
    act(() => { login = view.result.current.login('alice@example.com', 'synthetic-password'); });
    const rejected = expect(login).rejects.toThrow(/connection changed/i);
    act(() => { view.result.current.setServerUrl('https://another.example'); });
    await act(async () => { resolveLogin(new Response(JSON.stringify({ accessToken: 'late', refreshToken: 'late', user }))); await rejected; });
    expect(view.result.current.user).toBeNull();
    expect(view.result.current.serverUrl).toBe('https://another.example');
  });
});
