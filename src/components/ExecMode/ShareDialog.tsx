import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, Copy, Check, Trash2, UserPlus, Users, RefreshCw } from 'lucide-react';
import { Modal } from '../Common/Modal';
import type { SharePayload } from '../../lib/share';
import { encodeSharePayload, buildShareUrl, MAX_URL_LENGTH } from '../../lib/share';
import { useAuth } from '../../contexts/AuthContext';
import type { InvestigationMember } from '../../types';
import {
  fetchInvestigationMembers,
  inviteByEmail,
  removeInvestigationMember,
  updateMemberRole,
} from '../../lib/server-api';
import { syncEngine } from '../../lib/sync-engine';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
  folderId?: string;
}

type ShareState =
  | { step: 'configure' }
  | { step: 'generating' }
  | { step: 'result'; url?: string; code?: string }
  | { step: 'error'; message: string };

function getPayloadTitle(payload: SharePayload): string {
  const d = payload.d;
  if ('name' in d && typeof d.name === 'string') return d.name;
  if ('title' in d && typeof d.title === 'string') return d.title;
  if ('value' in d && typeof d.value === 'string') return d.value;
  if ('folder' in d && typeof d.folder === 'object' && 'name' in d.folder) return d.folder.name;
  return 'Untitled';
}

const SCOPE_LABELS: Record<string, string> = {
  note: 'Note',
  task: 'Task',
  event: 'Event',
  whiteboard: 'Whiteboard',
  ioc: 'IOC',
  investigation: 'Investigation',
  chat: 'Chat',
};

function ShareLinkTab({
  payload,
  encrypt,
  setEncrypt,
  password,
  setPassword,
  state,
  setState,
  copied,
  handleCopy,
}: {
  payload: SharePayload;
  encrypt: boolean;
  setEncrypt: (v: boolean) => void;
  password: string;
  setPassword: (v: string) => void;
  state: ShareState;
  setState: (s: ShareState) => void;
  copied: boolean;
  handleCopy: (text: string) => void;
}) {
  const handleGenerate = useCallback(async () => {
    if (encrypt && !password) return;
    setState({ step: 'generating' });
    try {
      const encoded = await encodeSharePayload(payload, encrypt ? password : undefined);
      const url = buildShareUrl(encoded);
      if (url.length <= MAX_URL_LENGTH) {
        setState({ step: 'result', url });
      } else {
        setState({ step: 'result', code: encoded });
      }
    } catch (err) {
      setState({ step: 'error', message: err instanceof Error ? err.message : 'Failed to generate share link' });
    }
  }, [payload, encrypt, password, setState]);

  return (
    <>
      {state.step === 'configure' || state.step === 'generating' ? (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {encrypt ? <Lock size={14} className="text-green-400" /> : <Unlock size={14} className="text-gray-400" />}
              <span className="text-sm text-gray-200">Encrypt with password</span>
            </div>
            <button
              onClick={() => setEncrypt(!encrypt)}
              className={`w-10 h-5 rounded-full transition-colors ${encrypt ? 'bg-green-500' : 'bg-gray-600'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${encrypt ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {encrypt && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password..."
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
            />
          )}

          <button
            onClick={handleGenerate}
            disabled={state.step === 'generating' || (encrypt && !password)}
            className="bg-accent text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity"
          >
            {state.step === 'generating' ? 'Generating...' : 'Generate Share Link'}
          </button>
        </>
      ) : state.step === 'result' ? (
        <>
          {state.url ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-400">Share this URL:</p>
              <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-200 font-mono break-all max-h-24 overflow-y-auto">
                {state.url}
              </div>
              <button
                onClick={() => { if (state.step === 'result' && state.url) handleCopy(state.url); }}
                className="flex items-center justify-center gap-2 bg-gray-700 text-gray-100 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : state.code ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-yellow-400">Payload too large for URL. Copy the share code below and send it to the recipient. They can paste it into the import dialog.</p>
              <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-200 font-mono break-all max-h-32 overflow-y-auto select-all">
                {state.code}
              </div>
              <button
                onClick={() => { if (state.step === 'result' && state.code) handleCopy(state.code); }}
                className="flex items-center justify-center gap-2 bg-gray-700 text-gray-100 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>
          ) : null}
        </>
      ) : state.step === 'error' ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <p className="text-sm text-red-400">{state.message}</p>
        </div>
      ) : null}
    </>
  );
}

function TeamTab({ folderId }: { folderId: string }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<InvestigationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [error, setError] = useState<string | null>(null);
  const [notSynced, setNotSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [inviting, setInviting] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const data = await fetchInvestigationMembers(folderId);
      setMembers(data);
      setNotSynced(false);
    } catch (err) {
      if (err instanceof Error && err.message === 'not_synced') {
        setNotSynced(true);
      } else {
        setError('Failed to load members');
      }
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncEngine.syncFolder(folderId);
      await loadMembers();
    } catch {
      setError('Sync failed — please try again');
    } finally {
      setSyncing(false);
    }
  }, [folderId, loadMembers]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const currentUserRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwner = currentUserRole === 'owner';

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await inviteByEmail(folderId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  }, [folderId, inviteEmail, inviteRole, loadMembers]);

  const handleRemove = useCallback(async (userId: string) => {
    try {
      await removeInvestigationMember(folderId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  }, [folderId]);

  const handleRoleChange = useCallback(async (userId: string, role: InvestigationMember['role']) => {
    try {
      await updateMemberRole(folderId, userId, role);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  }, [folderId]);

  if (loading) {
    return <p className="text-sm text-gray-400 py-4 text-center">Loading members...</p>;
  }

  if (notSynced) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-gray-400 text-center">
          This investigation hasn&apos;t been synced to the server yet.
          Sync it first to manage team members.
        </p>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isOwner && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
              placeholder="Email address..."
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="flex items-center gap-1.5 bg-accent text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              <UserPlus size={14} />
              {inviting ? '...' : 'Invite'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex flex-col divide-y divide-gray-700/50 max-h-60 overflow-y-auto">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-300 shrink-0">
                {m.displayName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-100 truncate">{m.displayName}</p>
                <p className="text-xs text-gray-500 truncate">{m.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isOwner && m.userId !== user?.id ? (
                <>
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.userId, e.target.value as InvestigationMember['role'])}
                    className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    onClick={() => handleRemove(m.userId)}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-0.5">
                  {m.role}{m.userId === user?.id ? ' (you)' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShareDialog({ open, onClose, payload, folderId }: ShareDialogProps) {
  const { t } = useTranslation('exec');
  const { connected } = useAuth();
  const showTeamTab = !!folderId && connected && payload?.s === 'investigation';
  const [tab, setTab] = useState<'link' | 'team'>('link');
  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<ShareState>({ step: 'configure' });
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleClose = useCallback(() => {
    setState({ step: 'configure' });
    setPassword('');
    setCopied(false);
    setTab('link');
    onClose();
  }, [onClose]);

  if (!payload) return null;

  const title = getPayloadTitle(payload);
  const scopeLabel = SCOPE_LABELS[payload.s] ?? payload.s;

  return (
    <Modal open={open} onClose={handleClose} title={t('share.title')}>
      <div className="flex flex-col gap-4">
        {/* Preview */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-1 rounded">{scopeLabel}</span>
          <span className="text-sm font-medium text-gray-100 truncate">{title}</span>
        </div>

        {/* Tab bar — only when team tab is available */}
        {showTeamTab && (
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setTab('link')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                tab === 'link'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Copy size={14} />
              Share Link
            </button>
            <button
              onClick={() => setTab('team')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                tab === 'team'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Users size={14} />
              Team
            </button>
          </div>
        )}

        {tab === 'link' || !showTeamTab ? (
          <ShareLinkTab
            payload={payload}
            encrypt={encrypt}
            setEncrypt={setEncrypt}
            password={password}
            setPassword={setPassword}
            state={state}
            setState={setState}
            copied={copied}
            handleCopy={handleCopy}
          />
        ) : (
          <TeamTab folderId={folderId!} />
        )}
      </div>
    </Modal>
  );
}
