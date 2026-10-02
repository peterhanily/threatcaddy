import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { authStorageKey } from '../lib/auth-storage';
import type { TeamUser } from '../types';

const user: TeamUser = { id: 'alice', email: 'alice@example.com', displayName: 'Alice', role: 'user' };
const auth = { serverUrl: 'https://team.example', accessToken: 'access-original', refreshToken: 'refresh-original', user };
const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
let lockRequest: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem(authStorageKey, JSON.stringify(auth));
  let pending: Promise<unknown> = Promise.resolve();
  lockRequest = vi.fn((_name: string, operation: () => Promise<unknown>) => {
    const result = pending.then(operation);
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
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRefresh = resolve; })).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderHook(useAuth, { wrapper: AuthProvider });
    act(() => view.result.current.invalidateAccessToken());
    let refreshing!: Promise<string | null>;
    await act(async () => { refreshing = view.result.current.getAccessToken(); await Promise.resolve(); });
    await act(async () => { await view.result.current.logout(); });
    let token: string | null = 'unexpected';
    await act(async () => { resolveRefresh(new Response(JSON.stringify({ accessToken: 'late-access', refreshToken: 'late-refresh' }))); token = await refreshing; });
    expect(token).toBeNull();
    expect(view.result.current.user).toBeNull();
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
