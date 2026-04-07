import { useState, useEffect } from 'react';
import { Server, LogIn, LogOut, UserPlus, CheckCircle, XCircle, Wifi, WifiOff, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ServerProfiles } from './ServerProfiles';
import { upsertServerProfile, type ServerProfile } from '../../lib/server-profiles';

const LAST_SESSION_KEY = 'threatcaddy-last-session';

interface LastSession {
  serverUrl: string;
  email: string;
  displayName: string;
}

function getLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveLastSession(session: LastSession) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session));
}

function clearLastSession() {
  localStorage.removeItem(LAST_SESSION_KEY);
}

interface ServerConnectionProps {
  settings: { serverUrl?: string; serverDisplayName?: string };
  onUpdateSettings: (updates: { serverUrl?: string; serverDisplayName?: string }) => void;
}

export function ServerConnection({ settings, onUpdateSettings }: ServerConnectionProps) {
  const { t } = useTranslation('settings');
  const { user, connected, serverUrl, login, register, logout, setServerUrl } = useAuth();
  const { addToast } = useToast();
  const [mode, setMode] = useState<'connect' | 'login' | 'register' | 'reconnect'>('connect');
  const [url, setUrl] = useState(settings.serverUrl || '');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastSession, setLastSession] = useState<LastSession | null>(null);

  // Check for cached session on mount
  useEffect(() => {
    if (!connected) {
      const session = getLastSession();
      if (session) {
        setLastSession(session);
        setMode('reconnect');
      }
    }
  }, [connected]);

  // Save session info when connected
  useEffect(() => {
    if (connected && user && serverUrl) {
      saveLastSession({ serverUrl, email: user.email, displayName: user.displayName });
      upsertServerProfile(serverUrl, user.email, user.displayName);
    }
  }, [connected, user, serverUrl]);

  const handleConnect = () => {
    if (!url.trim()) return;
    const cleanUrl = url.replace(/\/+$/, '');
    setServerUrl(cleanUrl);
    onUpdateSettings({ serverUrl: cleanUrl });
    setMode('login');
  };

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      setPassword('');
      addToast('success', t('server.connectedToast'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError('');
    setLoading(true);
    try {
      await register(email, displayName, password);
      setPassword('');
      addToast('success', t('server.accountCreated'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async () => {
    if (!lastSession || !password) return;
    setError('');
    setLoading(true);
    try {
      await login(lastSession.email, password, lastSession.serverUrl);
      onUpdateSettings({ serverUrl: lastSession.serverUrl });
      setPassword('');
      addToast('success', t('server.reconnectedToast'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearSession = () => {
    clearLastSession();
    setLastSession(null);
    setMode('connect');
    setPassword('');
    setError('');
  };

  const handleSelectProfile = (profile: ServerProfile) => {
    const cleanUrl = profile.url.replace(/\/+$/, '');
    setServerUrl(cleanUrl);
    onUpdateSettings({ serverUrl: cleanUrl });
    setUrl(cleanUrl);
    setEmail(profile.email);
    setDisplayName(profile.displayName);
    setMode('login');
    setError('');
    setPassword('');
  };

  const handleDisconnect = async () => {
    // Session details already saved via the useEffect above
    await logout();
    setServerUrl(null);
    onUpdateSettings({ serverUrl: undefined, serverDisplayName: undefined });
    addToast('info', t('server.disconnectedToast'));
    // Reload last session for reconnect
    const session = getLastSession();
    if (session) {
      setLastSession(session);
      setMode('reconnect');
    } else {
      setMode('connect');
    }
    setUrl('');
    setEmail('');
    setPassword('');
    setDisplayName('');
  };

  // Connected state
  if (connected && user) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Server size={16} />
          {t('server.teamServer')}
        </div>

        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-sm text-green-500 font-medium">{t('server.connected')}</span>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.serverLabel')}</span>
              <span className="text-[var(--text-secondary)] font-mono text-xs">{serverUrl}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.userLabel')}</span>
              <span className="text-[var(--text-secondary)]">{user.displayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.emailLabel')}</span>
              <span className="text-[var(--text-secondary)]">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.roleLabel')}</span>
              <span className="text-[var(--text-secondary)] capitalize">{user.role}</span>
            </div>
          </div>

          <button
            onClick={handleDisconnect}
            className="w-full mt-4 px-3 py-2 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm flex items-center justify-center gap-2 hover:bg-red-600/30 transition-colors"
          >
            <LogOut size={14} /> {t('server.disconnectLogout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <Server size={16} />
        {t('server.teamServer')}
      </div>

      {/* Saved server profiles */}
      <ServerProfiles onSelectProfile={handleSelectProfile} currentUrl={serverUrl || undefined} />

      {/* Quick Reconnect — shown when we have a cached session */}
      {mode === 'reconnect' && lastSession && (
        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCw size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-[var(--text-primary)]">{t('server.quickReconnect')}</span>
            </div>
            <button
              onClick={handleClearSession}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title={t('server.clearSavedSession')}
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.serverLabel')}</span>
              <span className="text-[var(--text-secondary)] font-mono">{lastSession.serverUrl}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">{t('server.userLabel')}</span>
              <span className="text-[var(--text-secondary)]">{lastSession.displayName} ({lastSession.email})</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">
              <XCircle size={14} /> {error}
            </div>
          )}

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('server.passwordPlaceholder')}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleReconnect(); }}
          />

          <button
            onClick={handleReconnect}
            disabled={loading || !password}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-blue-500 transition-colors"
          >
            {loading ? t('server.connecting') : <><RotateCw size={14} /> {t('server.reconnect')}</>}
          </button>

          <button
            onClick={() => { setMode('connect'); setError(''); }}
            className="w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {t('server.useDifferent')}
          </button>
        </div>
      )}

      {mode === 'connect' && (
        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <WifiOff size={14} className="text-[var(--text-tertiary)]" />
            <span className="text-sm text-[var(--text-tertiary)]">{t('server.notConnected')}</span>
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            Connect to a ThreatCaddy team server to collaborate with other investigators.
            The app works fully offline without a server.
          </p>
          <label className="block text-xs text-[var(--text-tertiary)]">Server URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-server.example.com:3001"
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm"
          />
          <button
            onClick={handleConnect}
            disabled={!url.trim()}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Wifi size={14} /> Connect
          </button>

          {/* Show option to return to quick reconnect if session is cached */}
          {lastSession && (
            <button
              onClick={() => { setMode('reconnect'); setError(''); }}
              className="w-full text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Reconnect as {lastSession.displayName}
            </button>
          )}
        </div>
      )}

      {(mode === 'login' || mode === 'register') && (
        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Server size={14} className="text-blue-400" />
            <span className="text-xs text-[var(--text-tertiary)] font-mono">{serverUrl}</span>
          </div>

          {/* Tab toggle */}
          <div className="flex bg-[var(--bg-primary)] rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 px-3 py-1.5 text-sm flex items-center justify-center gap-1 ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-[var(--text-tertiary)]'}`}
            >
              <LogIn size={14} /> Login
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 px-3 py-1.5 text-sm flex items-center justify-center gap-1 ${mode === 'register' ? 'bg-blue-600 text-white' : 'text-[var(--text-tertiary)]'}`}
            >
              <UserPlus size={14} /> Register
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">
              <XCircle size={14} /> {error}
            </div>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm"
          />

          {mode === 'register' && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display Name"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm"
            />
          )}

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('server.passwordPlaceholder')}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (mode === 'login') { handleLogin(); } else { handleRegister(); }
              }
            }}
          />

          <button
            onClick={mode === 'login' ? handleLogin : handleRegister}
            disabled={loading || !email || !password || (mode === 'register' && !displayName)}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Connecting...' : mode === 'login' ? 'Login' : 'Register'}
          </button>

          <button
            onClick={() => { setMode('connect'); setServerUrl(null); }}
            className="w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Change server
          </button>
        </div>
      )}
    </div>
  );
}
