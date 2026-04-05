/**
 * AgentMeetingPanel — trigger meetings and view meeting history.
 */

import { useState, useEffect } from 'react';
import { MessageSquare, Play, Loader2, FileText, ChevronRight } from 'lucide-react';
import type { AgentDeployment, AgentMeeting, Folder, Settings } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { db } from '../../db';
import { runAgentMeeting, runHandoffCall } from '../../lib/caddy-agent-meeting';

interface AgentMeetingPanelProps {
  folder: Folder;
  deployments: AgentDeployment[];
  settings: Settings;
  extensionAvailable: boolean;
  onNavigateToChat?: (threadId: string) => void;
  onNavigateToNote?: (noteId: string) => void;
  onEntitiesChanged?: () => void;
}

export function AgentMeetingPanel({
  folder, deployments, settings, extensionAvailable,
  onNavigateToChat, onNavigateToNote, onEntitiesChanged,
}: AgentMeetingPanelProps) {
  const [meetings, setMeetings] = useState<AgentMeeting[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [agenda, setAgenda] = useState('');
  const [maxRounds, setMaxRounds] = useState(3);

  useEffect(() => {
    db.agentMeetings
      .where('[investigationId+createdAt]')
      .between([folder.id, -Infinity], [folder.id, Infinity])
      .reverse()
      .limit(10)
      .toArray()
      .then(setMeetings);
  }, [folder.id, running]);

  const handleStartMeeting = async () => {
    if (!agenda.trim() || deployments.length < 2) return;
    setRunning(true);
    setShowNewMeeting(false);

    await runAgentMeeting(
      folder, deployments, settings, extensionAvailable,
      agenda.trim(), maxRounds,
      (speaker, status) => setProgress(`${speaker}: ${status}`),
    );

    setRunning(false);
    setProgress('');
    setAgenda('');
    onEntitiesChanged?.();
  };

  const canMeet = deployments.length >= 2;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-primary">Agent Meetings</span>
        </div>
        {canMeet && !running && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setRunning(true);
                const active = deployments.filter(d => d.shift !== 'resting');
                const resting = deployments.filter(d => d.shift === 'resting');
                if (active.length > 0 && resting.length > 0) {
                  await runHandoffCall(folder, active, resting, settings, extensionAvailable, (s, st) => setProgress(`${s}: ${st}`));
                  setRunning(false);
                  onEntitiesChanged?.();
                } else {
                  setRunning(false);
                }
              }}
              className="text-xs px-2 py-1 rounded bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20 transition-colors"
              title="Outgoing agents brief incoming agents, then swap shift states"
            >Shift Handoff</button>
            <button
              onClick={() => setShowNewMeeting(!showNewMeeting)}
              className="text-xs px-2 py-1 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
            >
              {showNewMeeting ? 'Cancel' : 'Start Meeting'}
            </button>
          </div>
        )}
      </div>

      {/* New meeting form */}
      {showNewMeeting && (
        <div className="border border-border-subtle rounded-lg p-3 bg-surface-raised/50 space-y-2">
          <textarea
            value={agenda}
            onChange={e => setAgenda(e.target.value)}
            placeholder="Meeting agenda — what should the agents discuss?"
            rows={2}
            className="w-full text-xs bg-surface border border-border-subtle rounded px-2 py-1.5 text-text-primary placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-blue/50"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-text-muted">Rounds:</label>
              <select
                value={maxRounds}
                onChange={e => setMaxRounds(parseInt(e.target.value))}
                className="text-[10px] bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
              >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button
              onClick={handleStartMeeting}
              disabled={!agenda.trim()}
              className="flex items-center gap-1 text-xs bg-accent-blue text-white px-3 py-1 rounded disabled:opacity-50"
            >
              <Play size={10} />
              Start
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            {deployments.length} agents will participate. Each gets {maxRounds} round(s) to contribute. Minutes are saved as a note.
          </p>
        </div>
      )}

      {/* Running indicator */}
      {running && (
        <div className="flex items-center gap-2 text-xs text-accent-blue">
          <Loader2 size={12} className="animate-spin" />
          {progress || 'Meeting in progress...'}
        </div>
      )}

      {/* Meeting history */}
      {!canMeet && (
        <p className="text-xs text-text-muted">Deploy 2+ agent profiles to start a meeting.</p>
      )}

      {meetings.length > 0 && (
        <div className="space-y-1">
          {meetings.map(m => (
            <div
              key={m.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-raised transition-colors group"
            >
              <MessageSquare size={11} className={cn(
                m.status === 'completed' ? 'text-accent-green' : m.status === 'failed' ? 'text-red-400' : 'text-accent-amber',
              )} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-text-primary truncate">{m.agenda.substring(0, 60)}</div>
                <div className="text-[9px] text-text-muted">
                  {m.roundsCompleted} round{m.roundsCompleted !== 1 ? 's' : ''} — {formatDate(m.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                {m.minutesNoteId && (
                  <button
                    onClick={() => onNavigateToNote?.(m.minutesNoteId!)}
                    className="text-text-muted hover:text-accent-blue p-0.5"
                    title="View minutes"
                  >
                    <FileText size={11} />
                  </button>
                )}
                <button
                  onClick={() => onNavigateToChat?.(m.threadId)}
                  className="text-text-muted hover:text-accent-blue p-0.5"
                  title="View discussion"
                >
                  <ChevronRight size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
