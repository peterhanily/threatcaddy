import { useState, useCallback } from 'react';
import { Lock, Unlock, Copy, Check } from 'lucide-react';
import { Modal } from '../Common/Modal';
import type { SharePayload } from '../../lib/share';
import { encodeSharePayload, buildShareUrl, MAX_URL_LENGTH } from '../../lib/share';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
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

export function ShareDialog({ open, onClose, payload }: ShareDialogProps) {
  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<ShareState>({ step: 'configure' });
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!payload) return;
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
  }, [payload, encrypt, password]);

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleClose = useCallback(() => {
    setState({ step: 'configure' });
    setPassword('');
    setCopied(false);
    onClose();
  }, [onClose]);

  if (!payload) return null;

  const title = getPayloadTitle(payload);
  const scopeLabel = SCOPE_LABELS[payload.s] ?? payload.s;

  return (
    <Modal open={open} onClose={handleClose} title="Share">
      <div className="flex flex-col gap-4">
        {/* Preview */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-1 rounded">{scopeLabel}</span>
          <span className="text-sm font-medium text-gray-100 truncate">{title}</span>
        </div>

        {state.step === 'configure' || state.step === 'generating' ? (
          <>
            {/* Encrypt toggle */}
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
      </div>
    </Modal>
  );
}
