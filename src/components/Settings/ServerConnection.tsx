import { useState } from 'react';
import { Server, LogIn, LogOut, UserPlus, CheckCircle, XCircle, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface ServerConnectionProps {
  settings: { serverUrl?: string; serverDisplayName?: string };
  onUpdateSettings: (updates: { serverUrl?: string; serverDisplayName?: string }) => void;
}

export function ServerConnection({ settings, onUpdateSettings }: ServerConnectionProps) {
  const { user, connected, serverUrl, login, register, logout, setServerUrl } = useAuth();
  const [mode, setMode] = useState<'connect' | 'login' | 'register'>('connect');
  const [url, setUrl] = useState(settings.serverUrl || '');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await logout();
    setServerUrl(null);
    onUpdateSettings({ serverUrl: undefined, serverDisplayName: undefined });
    setMode('connect');
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
          Team Server
        </div>

        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-sm text-green-500 font-medium">Connected</span>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Server</span>
              <span className="text-[var(--text-secondary)] font-mono text-xs">{serverUrl}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">User</span>
              <span className="text-[var(--text-secondary)]">{user.displayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Email</span>
              <span className="text-[var(--text-secondary)]">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-tertiary)]">Role</span>
              <span className="text-[var(--text-secondary)] capitalize">{user.role}</span>
            </div>
          </div>

          <button
            onClick={handleDisconnect}
            className="w-full mt-4 px-3 py-2 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-sm flex items-center justify-center gap-2 hover:bg-red-600/30 transition-colors"
          >
            <LogOut size={14} /> Disconnect & Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <Server size={16} />
        Team Server
      </div>

      {mode === 'connect' && (
        <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-secondary)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <WifiOff size={14} className="text-[var(--text-tertiary)]" />
            <span className="text-sm text-[var(--text-tertiary)]">Not connected</span>
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
            placeholder="Password"
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
