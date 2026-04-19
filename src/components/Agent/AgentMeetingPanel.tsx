/**
 * AgentMeetingPanel — trigger meetings and view meeting history.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Play, Loader2, FileText, ChevronRight, Inbox, X } from 'lucide-react';
import type { AgentDeployment, AgentMeeting, Folder, Note, Settings, MeetingPurpose } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { db } from '../../db';
import { runAgentMeeting, runHandoffCall } from '../../lib/caddy-agent-meeting';

/** Valid meeting purposes surfaced in the UI. Kept in sync with MeetingPurpose.
 *  Labels/hints resolved at render time via i18n so all 21 locales work. */
const PURPOSE_KEYS: { value: MeetingPurpose; labelKey: string; hintKey: string }[] = [
  { value: 'redTeamReview',    labelKey: 'meeting.purposeRedTeamReview',    hintKey: 'meeting.purposeRedTeamReviewHint' },
  { value: 'dissentSynthesis', labelKey: 'meeting.purposeDissentSynthesis', hintKey: 'meeting.purposeDissentSynthesisHint' },
  { value: 'signOff',          labelKey: 'meeting.purposeSignOff',          hintKey: 'meeting.purposeSignOffHint' },
  { value: 'freeform',         labelKey: 'meeting.purposeFreeform',         hintKey: 'meeting.purposeFreeformHint' },
];

/** Parse the purpose tag ("meeting-purpose:X") from a meeting-request note. */
function parsePurposeFromNote(note: Note): MeetingPurpose {
  const tag = (note.tags || []).find(t => t.startsWith('meeting-purpose:'));
  const raw = tag ? tag.split(':')[1] : 'freeform';
  const valid = PURPOSE_KEYS.map(p => p.value) as string[];
  return (valid.includes(raw) ? raw : 'freeform') as MeetingPurpose;
}

/** Extract the agenda body from the structured "Meeting Request" note content. */
function parseAgendaFromNote(note: Note): string {
  const match = note.content.match(/\*\*Agenda:\*\*\s*(.+)/);
  return match ? match[1].trim().substring(0, 500) : note.title.replace(/^Meeting Request:\s*/, '');
}

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
  const { t } = useTranslation('agent');
  const [meetings, setMeetings] = useState<AgentMeeting[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Note[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [agenda, setAgenda] = useState('');
  const [maxRounds, setMaxRounds] = useState(2);
  const [purpose, setPurpose] = useState<MeetingPurpose>('redTeamReview');

  // Load past meetings + pending agent-authored meeting requests in parallel.
  // Requests come from the call_meeting tool; they carry the purpose as a tag
  // and an agenda in the note body. The UI lets the analyst run them in one click.
  const reload = useCallback(async () => {
    const [ms, reqs] = await Promise.all([
      db.agentMeetings
        .where('[investigationId+createdAt]')
        .between([folder.id, -Infinity], [folder.id, Infinity])
        .reverse().limit(10).toArray(),
      db.notes
        .where('folderId').equals(folder.id)
        .filter(n => !n.trashed && !!n.tags?.includes('meeting-request'))
        .toArray(),
    ]);
    setMeetings(ms);
    // Newest requests first — agents may have stacked several.
    setPendingRequests(reqs.sort((a, b) => b.createdAt - a.createdAt));
  }, [folder.id]);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload, running]);

  const handleStartMeeting = async () => {
    if (!agenda.trim() || deployments.length < 2) return;
    setRunning(true);
    setShowNewMeeting(false);

    await runAgentMeeting(
      folder, deployments, settings, extensionAvailable,
      agenda.trim(), maxRounds,
      (speaker, status) => setProgress(`${speaker}: ${status}`),
      purpose,
    );

    setRunning(false);
    setProgress('');
    setAgenda('');
    onEntitiesChanged?.();
  };

  const handleRunRequest = async (req: Note) => {
    if (deployments.length < 2) return;
    const reqPurpose = parsePurposeFromNote(req);
    const reqAgenda = parseAgendaFromNote(req);
    setRunning(true);
    try {
      await runAgentMeeting(
        folder, deployments, settings, extensionAvailable,
        reqAgenda, undefined,
        (speaker, status) => setProgress(`${speaker}: ${status}`),
        reqPurpose,
      );
      // Trash the request note so it doesn't linger as pending.
      await db.notes.update(req.id, { trashed: true, trashedAt: Date.now(), updatedAt: Date.now() });
    } catch (err) {
      console.error('[meeting-panel] run request failed:', err);
    } finally {
      setRunning(false);
      setProgress('');
      onEntitiesChanged?.();
    }
  };

  const handleDismissRequest = async (req: Note) => {
    await db.notes.update(req.id, { trashed: true, trashedAt: Date.now(), updatedAt: Date.now() });
    await reload();
  };

  const canMeet = deployments.length >= 2;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-primary">{t('meeting.agentMeetings')}</span>
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
              title={t('meeting.shiftHandoffTitle')}
            >{t('meeting.shiftHandoff')}</button>
            <button
              onClick={() => setShowNewMeeting(!showNewMeeting)}
              className="text-xs px-2 py-1 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
            >
              {showNewMeeting ? t('common:cancel') : t('meeting.startMeeting')}
            </button>
          </div>
        )}
      </div>

      {/* Pending agent-authored meeting requests */}
      {pendingRequests.length > 0 && !running && (
        <div className="border border-accent-amber/30 rounded-lg bg-accent-amber/5 p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-accent-amber font-medium">
            <Inbox size={11} />
            <span>{t('meeting.pendingRequests', { count: pendingRequests.length })}</span>
          </div>
          {pendingRequests.slice(0, 3).map(req => {
            const reqPurpose = parsePurposeFromNote(req);
            const reqAgenda = parseAgendaFromNote(req);
            return (
              <div key={req.id} className="flex items-center gap-2 text-[10px] py-1 px-1.5 rounded hover:bg-surface group">
                <span className="shrink-0 uppercase tracking-wide text-text-muted px-1 py-0.5 rounded bg-surface-raised text-[9px]">{reqPurpose}</span>
                <span className="flex-1 min-w-0 truncate text-text-secondary" title={reqAgenda}>{reqAgenda}</span>
                <button
                  onClick={() => handleRunRequest(req)}
                  disabled={!canMeet}
                  className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50"
                  title={t('meeting.runThisMeeting')}
                >{t('meeting.run')}</button>
                <button
                  onClick={() => handleDismissRequest(req)}
                  className="shrink-0 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('meeting.dismissRequest')}
                ><X size={10} /></button>
              </div>
            );
          })}
          {pendingRequests.length > 3 && (
            <div className="text-[9px] text-text-muted ps-1">{t('meeting.moreCount', { count: pendingRequests.length - 3 })}</div>
          )}
        </div>
      )}

      {/* New meeting form */}
      {showNewMeeting && (
        <div className="border border-border-subtle rounded-lg p-3 bg-surface-raised/50 space-y-2">
          <textarea
            maxLength={2000}
            value={agenda}
            onChange={e => setAgenda(e.target.value)}
            placeholder={t('meeting.meetingAgendaPlaceholder')}
            rows={2}
            className="w-full text-xs bg-surface border border-border-subtle rounded px-2 py-1.5 text-text-primary placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-blue/50"
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-text-muted shrink-0">{t('meeting.purpose')}</label>
            <select
              value={purpose}
              onChange={e => setPurpose(e.target.value as MeetingPurpose)}
              className="flex-1 text-[10px] bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
              title={t(PURPOSE_KEYS.find(p => p.value === purpose)?.hintKey || '')}
            >
              {PURPOSE_KEYS.map(p => <option key={p.value} value={p.value}>{t(p.labelKey)}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-text-muted">{t('meeting.rounds')}</label>
              <select
                value={maxRounds}
                onChange={e => setMaxRounds(parseInt(e.target.value))}
                className="text-[10px] bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
              >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              {purpose !== 'freeform' && maxRounds > 2 && (
                <span className="text-[9px] text-accent-amber" title={t('meeting.cappedTo2Title')}>{t('meeting.cappedTo2')}</span>
              )}
            </div>
            <button
              onClick={handleStartMeeting}
              disabled={!agenda.trim()}
              className="flex items-center gap-1 text-xs bg-accent-blue text-white px-3 py-1 rounded disabled:opacity-50"
            >
              <Play size={10} />
              {t('meeting.start')}
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            {t('meeting.participationInfo', { count: deployments.length, rounds: maxRounds })}
          </p>
        </div>
      )}

      {/* Running indicator */}
      {running && (
        <div className="flex items-center gap-2 text-xs text-accent-blue">
          <Loader2 size={12} className="animate-spin" />
          {progress || t('meeting.meetingInProgress')}
        </div>
      )}

      {/* Meeting history */}
      {!canMeet && (
        <p className="text-xs text-text-muted">{t('meeting.deploy2Plus')}</p>
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
                  {t('meeting.roundsCompleted', { count: m.roundsCompleted, suffix: m.roundsCompleted !== 1 ? 's' : '' })} — {formatDate(m.createdAt)}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                {m.minutesNoteId && (
                  <button
                    onClick={() => onNavigateToNote?.(m.minutesNoteId!)}
                    className="text-text-muted hover:text-accent-blue p-0.5"
                    title={t('meeting.viewMinutes')}
                  >
                    <FileText size={11} />
                  </button>
                )}
                <button
                  onClick={() => onNavigateToChat?.(m.threadId)}
                  className="text-text-muted hover:text-accent-blue p-0.5"
                  title={t('meeting.viewDiscussion')}
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
