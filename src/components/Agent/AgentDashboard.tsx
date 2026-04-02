/**
 * AgentDashboard — global view when AgentCaddy is opened without an investigation selected.
 * Shows all agent activity across all investigations + supervisor updates.
 */

import { useState, useEffect } from 'react';
import {
  Bot, ChevronRight, AlertTriangle, Check, Clock, X, Shield,
} from 'lucide-react';
import type { AgentAction, Folder, Note } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { db } from '../../db';
import { getToolActionClass } from '../../lib/caddy-agent-policy';

const SUPERVISOR_FOLDER_NAME = 'CaddyAgent Supervisor';
const RECENT_LIMIT = 50;

interface AgentDashboardProps {
  folders: Folder[];
  onOpenInvestigation: (folderId: string) => void;
  onOpenSettings?: (tab?: string) => void;
}

interface AgentFolderSummary {
  folder: Folder;
  pendingCount: number;
  recentActions: AgentAction[];
}

const STATUS_ICON: Record<string, typeof Check> = {
  pending: Clock,
  executed: Check,
  rejected: X,
  failed: AlertTriangle,
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-accent-amber',
  executed: 'text-accent-green',
  rejected: 'text-text-muted',
  failed: 'text-red-400',
};

export function AgentDashboard({ folders, onOpenInvestigation, onOpenSettings }: AgentDashboardProps) {
  const [agentFolders, setAgentFolders] = useState<AgentFolderSummary[]>([]);
  const [recentGlobal, setRecentGlobal] = useState<(AgentAction & { folderName: string })[]>([]);
  const [supervisorNotes, setSupervisorNotes] = useState<Note[]>([]);
  const [supervisorFolderId, setSupervisorFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Find folders with agent activity
      const folderMap = new Map(folders.map(f => [f.id, f]));

      // Get all recent agent actions across all investigations
      const allActions = await db.agentActions
        .orderBy('createdAt')
        .reverse()
        .limit(RECENT_LIMIT)
        .toArray();

      // Group by investigation
      const byFolder = new Map<string, AgentAction[]>();
      for (const a of allActions) {
        const list = byFolder.get(a.investigationId) || [];
        list.push(a);
        byFolder.set(a.investigationId, list);
      }

      // Build per-investigation summaries
      const summaries: AgentFolderSummary[] = [];
      for (const [folderId, actions] of byFolder) {
        const folder = folderMap.get(folderId);
        if (!folder || folder.name === SUPERVISOR_FOLDER_NAME) continue;
        const pendingCount = actions.filter(a => a.status === 'pending').length;
        summaries.push({ folder, pendingCount, recentActions: actions.slice(0, 5) });
      }
      // Sort: pending first, then by most recent activity
      summaries.sort((a, b) => {
        if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
        if (b.pendingCount > 0 && a.pendingCount === 0) return 1;
        const aTime = a.recentActions[0]?.createdAt ?? 0;
        const bTime = b.recentActions[0]?.createdAt ?? 0;
        return bTime - aTime;
      });
      setAgentFolders(summaries);

      // Global recent feed with folder names
      const globalFeed = allActions
        .filter(a => {
          const f = folderMap.get(a.investigationId);
          return f && f.name !== SUPERVISOR_FOLDER_NAME;
        })
        .slice(0, 20)
        .map(a => ({ ...a, folderName: folderMap.get(a.investigationId)?.name || 'Unknown' }));
      setRecentGlobal(globalFeed);

      // Supervisor notes
      const supFolder = folders.find(f => f.name === SUPERVISOR_FOLDER_NAME);
      if (supFolder) {
        setSupervisorFolderId(supFolder.id);
        const notes = await db.notes
          .where('[folderId+updatedAt]')
          .between([supFolder.id, -Infinity], [supFolder.id, Infinity])
          .reverse()
          .limit(5)
          .toArray();
        setSupervisorNotes(notes);
      }

      setLoading(false);
    })();
  }, [folders]);

  const totalPending = agentFolders.reduce((sum, f) => sum + f.pendingCount, 0);
  const activeAgents = folders.filter(f => f.agentEnabled && f.name !== SUPERVISOR_FOLDER_NAME).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Bot size={24} className="animate-pulse opacity-30" />
      </div>
    );
  }

  const hasAnyActivity = agentFolders.length > 0 || supervisorNotes.length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Bot size={22} className="text-accent-blue" />
            <div>
              <h1 className="text-lg font-bold text-text-primary">AgentCaddy</h1>
              <p className="text-xs text-text-muted">
                {activeAgents > 0 ? `${activeAgents} active agent${activeAgents !== 1 ? 's' : ''}` : 'No active agents'}
                {totalPending > 0 && <span className="text-accent-amber ml-2">{totalPending} pending</span>}
              </p>
            </div>
          </div>
        </div>

        {!hasAnyActivity ? (
          <div className="text-center py-16 text-text-muted">
            <Bot size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm mb-2">No agent activity yet</p>
            <p className="text-xs">Select an investigation and click "Run Agent" to get started, or enable the supervisor in{' '}
              {onOpenSettings ? (
                <button onClick={() => onOpenSettings('ai')} className="text-accent-blue hover:underline">
                  Settings &gt; AI
                </button>
              ) : 'Settings > AI'}.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Supervisor Section */}
            {supervisorNotes.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={14} className="text-accent-blue" />
                  <h2 className="text-sm font-semibold text-text-primary">Supervisor Briefings</h2>
                </div>
                <div className="space-y-2">
                  {supervisorNotes.map(note => (
                    <button
                      key={note.id}
                      onClick={() => supervisorFolderId && onOpenInvestigation(supervisorFolderId)}
                      className="w-full text-left rounded-lg border border-border-subtle bg-surface hover:bg-surface-raised transition-colors p-3 group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text-primary truncate flex-1">{note.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-text-muted">{formatDate(note.createdAt)}</span>
                          <ChevronRight size={12} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <p className="text-[11px] text-text-muted line-clamp-2">
                        {note.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\n+/g, ' ').trim().substring(0, 200)}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Per-Investigation Agent Cards */}
            {agentFolders.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-text-primary mb-3">Investigations with Agent Activity</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {agentFolders.map(({ folder, pendingCount, recentActions }) => (
                    <button
                      key={folder.id}
                      onClick={() => onOpenInvestigation(folder.id)}
                      className="text-left rounded-lg border border-border-subtle bg-surface hover:bg-surface-raised transition-colors p-3 group"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {folder.color && (
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: folder.color }} />
                          )}
                          <span className="text-xs font-medium text-text-primary truncate">{folder.name}</span>
                          {folder.agentEnabled && (
                            <span className="text-[9px] px-1 py-px rounded bg-accent-green/10 text-accent-green shrink-0">auto</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {pendingCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber">
                              {pendingCount} pending
                            </span>
                          )}
                          <ChevronRight size={12} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      {/* Recent actions mini-feed */}
                      <div className="space-y-0.5">
                        {recentActions.slice(0, 3).map(action => {
                          const Icon = STATUS_ICON[action.status] || Clock;
                          const color = STATUS_COLOR[action.status] || 'text-text-muted';
                          return (
                            <div key={action.id} className="flex items-center gap-1.5 text-[10px]">
                              <Icon size={9} className={color} />
                              <code className="text-text-muted font-mono">{action.toolName}</code>
                              <span className="text-text-muted truncate flex-1">
                                {getToolActionClass(action.toolName)}
                              </span>
                              <span className="text-text-muted shrink-0">{formatDate(action.createdAt)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Global Activity Feed */}
            {recentGlobal.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-text-primary mb-3">Recent Agent Activity</h2>
                <div className="space-y-1">
                  {recentGlobal.map(action => {
                    const Icon = STATUS_ICON[action.status] || Clock;
                    const color = STATUS_COLOR[action.status] || 'text-text-muted';
                    return (
                      <button
                        key={action.id}
                        onClick={() => onOpenInvestigation(action.investigationId)}
                        className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-surface-raised transition-colors group"
                      >
                        <Icon size={11} className={cn(color, 'shrink-0')} />
                        <code className="text-[10px] text-text-primary font-mono shrink-0">{action.toolName}</code>
                        <span className="text-[10px] text-text-muted truncate flex-1">{action.folderName}</span>
                        <span className="text-[10px] text-text-muted shrink-0">{formatDate(action.createdAt)}</span>
                        <ChevronRight size={10} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
