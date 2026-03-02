import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { TeamUser } from '../types';

interface AuthState {
  user: TeamUser | null;
  connected: boolean;
  serverUrl: string | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, displayName: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  setServerUrl(url: string | null): void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  connected: false,
  serverUrl: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  getAccessToken: async () => null,
  setServerUrl: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  return useContext(AuthContext);
}

const STORAGE_KEY = 'threatcaddy-auth';

interface StoredAuth {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  user: TeamUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [connected, setConnected] = useState(false);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const auth: StoredAuth = JSON.parse(stored);
        setServerUrlState(auth.serverUrl);
        setUser(auth.user);
        accessTokenRef.current = auth.accessToken;
        refreshTokenRef.current = auth.refreshToken;
        setConnected(true);
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  const persist = useCallback((url: string, token: string, refresh: string, u: TeamUser) => {
    accessTokenRef.current = token;
    refreshTokenRef.current = refresh;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      serverUrl: url,
      accessToken: token,
      refreshToken: refresh,
      user: u,
    }));
  }, []);

  const setServerUrl = useCallback((url: string | null) => {
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

  const login = useCallback(async (email: string, password: string) => {
    if (!serverUrl) throw new Error('No server URL configured');

    const resp = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await resp.json();
    const teamUser: TeamUser = {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.displayName,
      avatarUrl: data.user.avatarUrl,
      role: data.user.role,
    };

    setUser(teamUser);
    setConnected(true);
    persist(serverUrl, data.accessToken, data.refreshToken, teamUser);
  }, [serverUrl, persist]);

  const register = useCallback(async (email: string, displayName: string, password: string) => {
    if (!serverUrl) throw new Error('No server URL configured');

    const resp = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName, password }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await resp.json();
    const teamUser: TeamUser = {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.displayName,
      avatarUrl: data.user.avatarUrl,
      role: data.user.role,
    };

    setUser(teamUser);
    setConnected(true);
    persist(serverUrl, data.accessToken, data.refreshToken, teamUser);
  }, [serverUrl, persist]);

  const logout = useCallback(async () => {
    if (serverUrl && refreshTokenRef.current && accessTokenRef.current) {
      try {
        await fetch(`${serverUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessTokenRef.current}`,
          },
          body: JSON.stringify({ refreshToken: refreshTokenRef.current }),
        });
      } catch { /* best effort */ }
    }

    setUser(null);
    setConnected(false);
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
  }, [serverUrl]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!serverUrl || !refreshTokenRef.current) return null;

    // If we have a token, return it (rely on 401 to trigger refresh in API wrapper)
    if (accessTokenRef.current) return accessTokenRef.current;

    // Try to refresh
    try {
      const resp = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshTokenRef.current }),
      });

      if (!resp.ok) {
        // Refresh failed — logged out
        setUser(null);
        setConnected(false);
        accessTokenRef.current = null;
        refreshTokenRef.current = null;
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      const data = await resp.json();
      accessTokenRef.current = data.accessToken;
      refreshTokenRef.current = data.refreshToken;

      if (user) {
        persist(serverUrl, data.accessToken, data.refreshToken, user);
      }

      return data.accessToken;
    } catch {
      setConnected(false);
      return null;
    }
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
      setServerUrl,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
