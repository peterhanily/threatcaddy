import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { TeamUser } from '../types';
import { assertConfiguredConnection } from '../lib/connection-policy';
import { db } from '../db';
import { getActiveWorkspaceId, prepareAuthenticatedWorkspace, preserveEncryptionForNewWorkspace, activateWorkspace, workspaceStorageKey, normalizedWorkspaceIdentity } from '../lib/workspace-profiles';
import { withEntityDraftBarrier, hasPendingEntityDrafts } from '../lib/entity-drafts';
import { syncEngine } from '../lib/sync-engine';
import { authStorageKey as STORAGE_KEY, readStoredAuth, withAuthRefreshLock, type StoredAuth } from '../lib/auth-storage';
import { fetchServerResponse } from '../lib/server-response';

interface AuthState {
  user: TeamUser | null;
  connected: boolean;
  serverUrl: string | null;
  login(email: string, password: string, overrideServerUrl?: string): Promise<void>;
  register(email: string, displayName: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  invalidateAccessToken(): void;
  setServerUrl(url: string | null): void;
  setReachable(reachable: boolean): void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  connected: false,
  serverUrl: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  getAccessToken: async () => null,
  invalidateAccessToken: () => {},
  setServerUrl: () => {},
  setReachable: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [connected, setConnected] = useState(false);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const generationRef = useRef(0);
  const identityRef = useRef<{ serverUrl: string; userId: string } | null>(null);

  // Restore from localStorage on mount
  useEffect(() => {
    const restore = (auth: StoredAuth) => {
        setServerUrlState(auth.serverUrl);
        setUser(auth.user);
        accessTokenRef.current = auth.accessToken;
        refreshTokenRef.current = auth.refreshToken;
        identityRef.current = { serverUrl: auth.serverUrl, userId: auth.user.id };
        setConnected(true);
    };
    const initial = readStoredAuth();
    if (initial) restore(initial);
    const changed = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return;
      const auth = readStoredAuth();
      if (!auth) {
        ++generationRef.current;
        accessTokenRef.current = null;
        refreshTokenRef.current = null;
        refreshPromiseRef.current = null;
        identityRef.current = null;
        setUser(null);
        setConnected(false);
        syncEngine.stop();
      } else if (identityRef.current?.serverUrl === auth.serverUrl && identityRef.current.userId === auth.user.id) {
        restore(auth);
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  const persist = useCallback((url: string, token: string, refresh: string, u: TeamUser) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      serverUrl: url,
      accessToken: token,
      refreshToken: refresh,
      user: u,
    }));
    accessTokenRef.current = token;
    refreshTokenRef.current = refresh;
    identityRef.current = { serverUrl: url, userId: u.id };
  }, []);

  const selectAuthenticatedWorkspace = useCallback(async (url: string, token: string, refresh: string, u: TeamUser, generation: number) => {
    const assertCurrent = () => {
      if (generation !== generationRef.current) throw new Error('Connection changed before sign-in completed.');
    };
    const binding = await db.table('_syncMeta').get('syncWorkspaceIdentityV1');
    assertCurrent();
    let originalIdentity = binding?.value as { serverUrl: string; userId: string } | undefined;
    if (!originalIdentity && getActiveWorkspaceId() === 'default') {
      try {
        const original = JSON.parse(localStorage.getItem('threatcaddy-auth') ?? 'null') as StoredAuth | null;
        if (original?.serverUrl && original.user?.id) originalIdentity = { serverUrl: original.serverUrl, userId: original.user.id };
      } catch { /* Unknown legacy ownership never permits automatic adoption. */ }
    }
    const profile = await prepareAuthenticatedWorkspace(url, u.id, `${u.displayName} — ${url}`, originalIdentity);
    assertCurrent();
    if (profile.id === getActiveWorkspaceId()) return false;
    await withEntityDraftBarrier(async () => {
      assertCurrent();
      if (hasPendingEntityDrafts()) throw new Error('Resolve unsaved drafts before switching workspaces.');
      preserveEncryptionForNewWorkspace(profile.id);
      localStorage.setItem(workspaceStorageKey('threatcaddy-auth', profile.id), JSON.stringify({ serverUrl: profile.serverUrl, accessToken: token, refreshToken: refresh, user: u }));
      window.dispatchEvent(new Event('workspace-will-switch'));
      syncEngine.stop();
      activateWorkspace(profile.id);
      db.close();
      window.location.reload();
    });
    return true;
  }, []);

  const setReachable = useCallback((reachable: boolean) => {
    // Only update connection state if we have stored tokens (i.e. user is logged in)
    if (accessTokenRef.current || refreshTokenRef.current) {
      setConnected(reachable);
    }
  }, []);

  const setServerUrl = useCallback((url: string | null) => {
    if (url) url = normalizedWorkspaceIdentity(url, 'endpoint-validation').serverUrl;
    ++generationRef.current;
    // Choosing another endpoint never reuses the previous endpoint's tokens.
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    refreshPromiseRef.current = null;
    identityRef.current = null;
    setUser(null);
    setConnected(false);
    syncEngine.stop();
    setServerUrlState(url);
    if (!url) {
      // Disconnect
      setUser(null);
      setConnected(false);
      accessTokenRef.current = null;
      refreshTokenRef.current = null;
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback(async (email: string, password: string, overrideServerUrl?: string) => {
    const generation = ++generationRef.current;
    const selectedUrl = overrideServerUrl || serverUrl;
    if (!selectedUrl) throw new Error('No server URL configured');
    const url = normalizedWorkspaceIdentity(selectedUrl, 'endpoint-validation').serverUrl;
    assertConfiguredConnection(url);

    const resp = await fetchServerResponse(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, { current: () => generation === generationRef.current, maxBytes: 1_000_000, timeoutMs: 15_000 });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await resp.json();
    if (generation !== generationRef.current) throw new Error('Connection changed before sign-in completed.');
    const teamUser: TeamUser = {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.displayName,
      avatarUrl: data.user.avatarUrl,
      role: data.user.role,
    };

    if (await selectAuthenticatedWorkspace(url, data.accessToken, data.refreshToken, teamUser, generation)) return;
    if (generation !== generationRef.current) throw new Error('Connection changed before sign-in completed.');

    if (overrideServerUrl) {
      setServerUrlState(url);
    }
    persist(url, data.accessToken, data.refreshToken, teamUser);
    setUser(teamUser);
    setConnected(true);
  }, [serverUrl, persist, selectAuthenticatedWorkspace]);

  const register = useCallback(async (email: string, displayName: string, password: string) => {
    const generation = ++generationRef.current;
    if (!serverUrl) throw new Error('No server URL configured');
    assertConfiguredConnection(serverUrl);

    const resp = await fetchServerResponse(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName, password }),
    }, { current: () => generation === generationRef.current, maxBytes: 1_000_000, timeoutMs: 15_000 });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await resp.json();
    if (generation !== generationRef.current) throw new Error('Connection changed before registration completed.');
    const teamUser: TeamUser = {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.displayName,
      avatarUrl: data.user.avatarUrl,
      role: data.user.role,
    };

    if (await selectAuthenticatedWorkspace(serverUrl, data.accessToken, data.refreshToken, teamUser, generation)) return;
    if (generation !== generationRef.current) throw new Error('Connection changed before registration completed.');

    persist(serverUrl, data.accessToken, data.refreshToken, teamUser);
    setUser(teamUser);
    setConnected(true);
  }, [serverUrl, persist, selectAuthenticatedWorkspace]);

  const logout = useCallback(async () => {
    ++generationRef.current;
    syncEngine.stop();
    const refreshToken = refreshTokenRef.current;
    const accessToken = accessTokenRef.current;
    setUser(null);
    setConnected(false);
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    refreshPromiseRef.current = null;
    identityRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    if (serverUrl && refreshToken && accessToken) {
      const logoutController = new AbortController();
      const timer = setTimeout(() => logoutController.abort(), 5_000);
      try {
        await fetch(`${serverUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ refreshToken }),
          signal: logoutController.signal,
        });
      } catch { /* best effort */ }
      finally { clearTimeout(timer); }
    }
  }, [serverUrl]);

  const invalidateAccessToken = useCallback(() => {
    accessTokenRef.current = null;
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!serverUrl || !refreshTokenRef.current) return null;

    // If we have a token, return it (rely on 401 to trigger refresh in API wrapper)
    if (accessTokenRef.current) return accessTokenRef.current;

    // If a refresh is already in flight, share the same promise
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const generation = generationRef.current;
    const originalRefreshToken = refreshTokenRef.current;

    // Try to refresh
    const refreshPromise = (async () => {
      try {
        return await withAuthRefreshLock(async () => {
        if (generation !== generationRef.current) return null;
        const stored = readStoredAuth();
        if (!stored || stored.serverUrl !== serverUrl || stored.user.id !== user?.id) return null;
        // Another tab has already rotated this family while we waited.
        if (stored.refreshToken !== originalRefreshToken) {
          accessTokenRef.current = stored.accessToken;
          refreshTokenRef.current = stored.refreshToken;
          return stored.accessToken;
        }
        const stillCurrent = () => generation === generationRef.current && readStoredAuth()?.refreshToken === stored.refreshToken;
        const resp = await fetchServerResponse(`${serverUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
        }, { current: stillCurrent, maxBytes: 1_000_000, timeoutMs: 10_000 });
        if (!stillCurrent()) return null;

        if (!resp.ok) {
          void resp.body?.cancel().catch(() => {});
          // A transient server failure is not an authentication rejection.
          if (resp.status !== 401 && resp.status !== 403) return null;
          // Refresh failed — logged out
          setUser(null);
          setConnected(false);
          accessTokenRef.current = null;
          refreshTokenRef.current = null;
          identityRef.current = null;
          localStorage.removeItem(STORAGE_KEY);
          syncEngine.stop();
          return null;
        }

        const data = await resp.json();
        if (!stillCurrent()) return null;
        if (typeof data.accessToken !== 'string' || !data.accessToken || typeof data.refreshToken !== 'string' || !data.refreshToken) return null;

        if (user) {
          persist(serverUrl, data.accessToken, data.refreshToken, user);
        }

        return data.accessToken as string | null;
        });
      } catch {
        // Network error during refresh — don't set connected=false.
        // The WS client will handle reconnection and restore reachability.
        return null;
      } finally {
        if (generation === generationRef.current) refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [serverUrl, user, persist]);

  return (
    <AuthContext.Provider value={{
      user,
      connected,
      serverUrl,
      login,
      register,
      logout,
      getAccessToken,
      invalidateAccessToken,
      setServerUrl,
      setReachable,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
