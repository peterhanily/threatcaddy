import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Shield, Lock, X, AlertCircle, Download, Check } from 'lucide-react';
import { isEncryptedShare, decodeSharePayload } from '../../lib/share';
import type { SharePayload } from '../../lib/share';
import type { Note, Task, TimelineEvent, ChatThread } from '../../types';
import type { InvestigationBundle } from '../../lib/share';
import { renderMarkdown } from '../../lib/markdown';
import { ExecNoteView } from './ExecNoteView';
import { ExecTaskView } from './ExecTaskView';
import { ExecEventView } from './ExecEventView';
import { ExecEntityList } from './ExecEntityList';
import { cn } from '../../lib/utils';

interface ShareReceiverProps {
  encodedData: string;
  theme: 'dark' | 'light';
  onDismiss: () => void;
  onSave?: (payload: SharePayload) => Promise<void>;
}

type ReceiverState =
  | { phase: 'password-prompt' }
  | { phase: 'decoding' }
  | { phase: 'display'; payload: SharePayload }
  | { phase: 'error'; message: string };

type BundleDrill =
  | null
  | { screen: 'noteList' }
  | { screen: 'noteDetail'; noteId: string }
  | { screen: 'taskList' }
  | { screen: 'taskDetail'; taskId: string }
  | { screen: 'eventList' }
  | { screen: 'eventDetail'; eventId: string }
  | { screen: 'whiteboardList' }
  | { screen: 'iocList' };

const SCOPE_LABELS: Record<string, string> = {
  note: 'Note',
  task: 'Task',
  event: 'Event',
  whiteboard: 'Whiteboard',
  ioc: 'IOC',
  investigation: 'Investigation',
  chat: 'Chat',
};

export function ShareReceiver({ encodedData, theme, onDismiss, onSave }: ShareReceiverProps) {
  const encrypted = useMemo(() => isEncryptedShare(encodedData), [encodedData]);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<ReceiverState>(
    encrypted ? { phase: 'password-prompt' } : { phase: 'decoding' },
  );
  const [bundleDrill, setBundleDrill] = useState<BundleDrill>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Auto-decode unencrypted shares on mount
  const decodedRef = useRef(false);
  useEffect(() => {
    if (!encrypted && !decodedRef.current) {
      decodedRef.current = true;
      decodeSharePayload(encodedData)
        .then((payload) => setState({ phase: 'display', payload }))
        .catch((err) => setState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to decode' }));
    }
  }, [encrypted, encodedData]);

  const handleDecrypt = useCallback(async () => {
    if (!password) return;
    setState({ phase: 'decoding' });
    try {
      const payload = await decodeSharePayload(encodedData, password);
      setState({ phase: 'display', payload });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Decryption failed. Wrong password?' });
    }
  }, [encodedData, password]);

  const handleSave = useCallback(async () => {
    if (!onSave || state.phase !== 'display' || saveState !== 'idle') return;
    setSaveState('saving');
    try {
      await onSave(state.payload);
      setSaveState('saved');
    } catch {
      setSaveState('idle');
    }
  }, [onSave, state, saveState]);

  const renderPayload = (payload: SharePayload) => {
    // Investigation bundle with drill-down
    if (payload.s === 'investigation') {
      const bundle = payload.d as InvestigationBundle;

      if (bundleDrill) {
        switch (bundleDrill.screen) {
          case 'noteList':
            return (
              <ExecEntityList
                mode="notes"
                folderId={bundle.folder.id}
                folderName={bundle.folder.name}
                allNotes={bundle.notes}
                allTasks={bundle.tasks}
                allEvents={bundle.events}
                allWhiteboards={bundle.whiteboards}
                allIOCs={bundle.iocs}
                onBack={() => setBundleDrill(null)}
                onSelectNote={(id) => setBundleDrill({ screen: 'noteDetail', noteId: id })}
              />
            );
          case 'noteDetail': {
            const note = bundle.notes.find((n) => n.id === bundleDrill.noteId);
            return note ? (
              <ExecNoteView note={note} allNotes={bundle.notes} onBack={() => setBundleDrill({ screen: 'noteList' })} />
            ) : null;
          }
          case 'taskList':
            return (
              <ExecEntityList
                mode="tasks"
                folderId={bundle.folder.id}
                folderName={bundle.folder.name}
                allNotes={bundle.notes}
                allTasks={bundle.tasks}
                allEvents={bundle.events}
                allWhiteboards={bundle.whiteboards}
                allIOCs={bundle.iocs}
                onBack={() => setBundleDrill(null)}
                onSelectTask={(id) => setBundleDrill({ screen: 'taskDetail', taskId: id })}
              />
            );
          case 'taskDetail': {
            const task = bundle.tasks.find((t) => t.id === bundleDrill.taskId);
            return task ? <ExecTaskView task={task} onBack={() => setBundleDrill({ screen: 'taskList' })} /> : null;
          }
          case 'eventList':
            return (
              <ExecEntityList
                mode="events"
                folderId={bundle.folder.id}
                folderName={bundle.folder.name}
                allNotes={bundle.notes}
                allTasks={bundle.tasks}
                allEvents={bundle.events}
                allWhiteboards={bundle.whiteboards}
                allIOCs={bundle.iocs}
                onBack={() => setBundleDrill(null)}
                onSelectEvent={(id) => setBundleDrill({ screen: 'eventDetail', eventId: id })}
              />
            );
          case 'eventDetail': {
            const event = bundle.events.find((e) => e.id === bundleDrill.eventId);
            return event ? <ExecEventView event={event} onBack={() => setBundleDrill({ screen: 'eventList' })} /> : null;
          }
          case 'whiteboardList':
            return (
              <ExecEntityList
                mode="whiteboards"
                folderId={bundle.folder.id}
                folderName={bundle.folder.name}
                allNotes={bundle.notes}
                allTasks={bundle.tasks}
                allEvents={bundle.events}
                allWhiteboards={bundle.whiteboards}
                allIOCs={bundle.iocs}
                onBack={() => setBundleDrill(null)}
              />
            );
          case 'iocList':
            return (
              <ExecEntityList
                mode="iocs"
                folderId={bundle.folder.id}
                folderName={bundle.folder.name}
                allNotes={bundle.notes}
                allTasks={bundle.tasks}
                allEvents={bundle.events}
                allWhiteboards={bundle.whiteboards}
                allIOCs={bundle.iocs}
                onBack={() => setBundleDrill(null)}
              />
            );
        }
      }

      // Investigation overview: metric buttons
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-text-primary">{bundle.folder.name}</h2>
          {bundle.folder.description && (
            <p className="text-sm text-text-secondary">{bundle.folder.description}</p>
          )}
          <div className="grid grid-cols-5 gap-1 bg-bg-raised rounded-xl p-3">
            {[
              { label: 'Notes', count: bundle.notes.length, onTap: () => setBundleDrill({ screen: 'noteList' }) },
              { label: 'Tasks', count: bundle.tasks.length, onTap: () => setBundleDrill({ screen: 'taskList' }) },
              { label: 'Events', count: bundle.events.length, onTap: () => setBundleDrill({ screen: 'eventList' }) },
              { label: 'Boards', count: bundle.whiteboards.length, onTap: () => setBundleDrill({ screen: 'whiteboardList' }) },
              { label: 'IOCs', count: bundle.iocs.length, onTap: () => setBundleDrill({ screen: 'iocList' }) },
            ].map((m) => (
              <button key={m.label} onClick={m.onTap} className="flex flex-col items-center py-2 rounded-lg active:bg-bg-hover transition-colors">
                <span className="text-lg font-bold text-text-primary">{m.count}</span>
                <span className="text-[8px] font-medium text-text-muted uppercase tracking-wide">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Single entity views — Back dismisses the share view
    switch (payload.s) {
      case 'note':
        return <ExecNoteView note={payload.d as Note} allNotes={[]} onBack={onDismiss} />;
      case 'task':
        return <ExecTaskView task={payload.d as Task} onBack={onDismiss} />;
      case 'event':
        return <ExecEventView event={payload.d as TimelineEvent} onBack={onDismiss} />;
      case 'chat': {
        const thread = payload.d as ChatThread;
        return (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">
            <div>
              <h2 className="text-lg font-bold text-text-primary">{thread.title}</h2>
              <p className="text-xs text-text-muted mt-1">{thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex flex-col gap-3">
              {thread.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded-xl px-4 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-purple/20 text-text-primary ml-8'
                      : 'bg-bg-raised text-text-primary mr-8 border border-border-subtle'
                  )}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </span>
                  {msg.role === 'assistant' ? (
                    <div
                      className="markdown-preview text-sm"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }
      default:
        return <p className="text-sm text-text-muted">Unsupported share type: {payload.s}</p>;
    }
  };

  return (
    <div className={cn('h-screen flex flex-col bg-bg-deep', theme)}>
      {/* Gradient top accent */}
      <div className="h-0.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-accent" />
          <span className="font-bold text-text-primary text-sm">ThreatCaddy</span>
          <span className="text-[10px] font-semibold tracking-widest text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded">
            SHARED
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onSave && state.phase === 'display' && (
            <button
              onClick={handleSave}
              disabled={saveState !== 'idle'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                saveState === 'saved'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-accent/10 text-accent active:bg-accent/20 disabled:opacity-50',
              )}
            >
              {saveState === 'saved' ? <Check size={14} /> : <Download size={14} />}
              {saveState === 'idle' ? 'Save to ThreatCaddy' : saveState === 'saving' ? 'Saving...' : 'Saved'}
            </button>
          )}
          <button onClick={onDismiss} className="p-2 rounded-lg text-text-muted active:bg-bg-hover" title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {state.phase === 'password-prompt' && (
          <div className="flex flex-col items-center justify-center gap-4 mt-12">
            <Lock size={32} className="text-accent-amber" />
            <h2 className="text-lg font-bold text-text-primary">Encrypted Content</h2>
            <p className="text-sm text-text-muted text-center">This shared content is protected with a password.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password..."
              className="w-full max-w-xs bg-bg-raised border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              onKeyDown={(e) => { if (e.key === 'Enter') handleDecrypt(); }}
            />
            <button
              onClick={handleDecrypt}
              disabled={!password}
              className="bg-accent text-white rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              Decrypt
            </button>
          </div>
        )}

        {state.phase === 'decoding' && (
          <div className="flex flex-col items-center justify-center gap-3 mt-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-text-muted">Decoding...</p>
          </div>
        )}

        {state.phase === 'display' && (
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs text-text-muted">
              <span className="font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded">{SCOPE_LABELS[state.payload.s] ?? state.payload.s}</span>
              <span>Shared {new Date(state.payload.t).toLocaleDateString()}</span>
            </div>
            {renderPayload(state.payload)}
          </div>
        )}

        {state.phase === 'error' && (
          <div className="flex flex-col items-center justify-center gap-3 mt-12">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm text-red-400 text-center">{state.message}</p>
            {encrypted && (
              <button
                onClick={() => { setState({ phase: 'password-prompt' }); setPassword(''); }}
                className="text-sm text-accent font-medium"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
