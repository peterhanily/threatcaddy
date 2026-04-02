import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Play, CheckCheck, Loader2, AlertTriangle, X, Settings as SettingsIcon, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { AgentAction, AgentPolicy, Folder, AgentStatus } from '../../types';
import { DEFAULT_AGENT_POLICY } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { db } from '../../db';
import { executeApprovedAction, rejectAction, bulkApproveActions } from '../../lib/caddy-agent';
import { AgentActionCard } from './AgentActionCard';

interface AgentPanelProps {
  folder: Folder;
  /** From useCaddyAgent hook */
  agentRunning?: boolean;
  agentProgress?: string;
  agentError?: string | null;
  agentStatus?: AgentStatus;
  onRunOnce?: () => Promise<void>;
  onNavigateToChat?: (threadId: string) => void;
  onEntitiesChanged?: () => void;
}

export function AgentPanel({
  folder,
  agentRunning = false, agentProgress = '', agentError = null, agentStatus,
  onRunOnce, onNavigateToChat, onEntitiesChanged,
}: AgentPanelProps) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'executed' | 'rejected'>('all');
  const [showSettings, setShowSettings] = useState(false);

  const error = agentError || localError;

  // Load actions for this investigation
  const loadActions = useCallback(async () => {
    const results = await db.agentActions
      .where('investigationId')
      .equals(folder.id)
      .reverse()
      .sortBy('createdAt');
    setActions(results);
  }, [folder.id]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  // Reload actions when agent finishes a run
  useEffect(() => {
    if (!agentRunning) loadActions();
  }, [agentRunning, loadActions]);

  const handleRunAgent = async () => {
    setLocalError(null);
    if (onRunOnce) {
      await onRunOnce();
    }
    await loadActions();
    onEntitiesChanged?.();
  };

  const handleApprove = async (action: AgentAction) => {
    await executeApprovedAction(action);
    await loadActions();
    onEntitiesChanged?.();
  };

  const handleReject = async (action: AgentAction) => {
    await rejectAction(action.id);
    await loadActions();
  };

  const handleBulkApprove = async () => {
    const result = await bulkApproveActions(folder.id);
    if (result.failed > 0) {
      setLocalError(`Approved ${result.executed}, failed ${result.failed}`);
    }
    await loadActions();
    onEntitiesChanged?.();
  };

  const handleViewReasoning = (threadId: string) => {
    onNavigateToChat?.(threadId);
  };

  const pendingCount = actions.filter(a => a.status === 'pending').length;
  const displayStatus = agentStatus || folder.agentStatus;

  const filteredActions = filter === 'all'
    ? actions
    : actions.filter(a => {
        if (filter === 'executed') return a.status === 'executed';
        if (filter === 'rejected') return a.status === 'rejected' || a.status === 'failed';
        return a.status === filter;
      });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-accent-blue" />
          <h2 className="font-semibold text-sm">CaddyAgent</h2>
          {displayStatus && displayStatus !== 'idle' && (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              displayStatus === 'running' && 'bg-accent-blue/10 text-accent-blue',
              displayStatus === 'waiting' && 'bg-accent-amber/10 text-accent-amber',
              displayStatus === 'error' && 'bg-red-400/10 text-red-400',
              displayStatus === 'paused' && 'bg-surface-raised text-text-muted',
            )}>
              {displayStatus}
            </span>
          )}
          {folder.agentEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green">
              auto
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-text-muted hover:text-text-secondary p-1 rounded transition-colors"
            title="Agent settings"
          >
            <SettingsIcon size={14} />
          </button>
          <button
            onClick={handleRunAgent}
            disabled={agentRunning}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
              agentRunning
                ? 'bg-surface-raised text-text-muted cursor-not-allowed'
                : 'bg-accent-blue text-white hover:bg-accent-blue/90',
            )}
          >
            {agentRunning ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {agentProgress || 'Running...'}
              </>
            ) : (
              <>
                <Play size={12} />
                Run
              </>
            )}
          </button>
        </div>
      </div>

      {/* Policy editor (collapsible) */}
      {showSettings && (
        <PolicyEditor folder={folder} />
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-400/10 text-red-400 text-xs border-b border-red-400/20">
          <AlertTriangle size={12} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setLocalError(null)} className="hover:text-red-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Pending actions bar */}
      {pendingCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent-amber/5 border-b border-accent-amber/20">
          <span className="text-xs text-accent-amber">
            {pendingCount} action{pendingCount !== 1 ? 's' : ''} pending review
          </span>
          <button
            onClick={handleBulkApprove}
            className="flex items-center gap-1 text-xs text-accent-green hover:bg-accent-green/10 px-2 py-1 rounded transition-colors"
          >
            <CheckCheck size={12} />
            Approve All
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-border-subtle">
        {(['all', 'pending', 'executed', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-[11px] px-2 py-1 rounded transition-colors capitalize',
              filter === f
                ? 'bg-surface-raised text-text-primary font-medium'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised/50',
            )}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 text-accent-amber">({pendingCount})</span>
            )}
          </button>
        ))}
      </div>

      {/* Actions list */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
        {filteredActions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Bot size={32} className="mb-2 opacity-30" />
            <p className="text-sm">
              {actions.length === 0
                ? 'No agent activity yet. Click "Run" to start.'
                : `No ${filter} actions.`
              }
            </p>
            {actions.length === 0 && folder.agentLastRunAt && (
              <p className="text-xs mt-1">Last run: {formatDate(folder.agentLastRunAt)}</p>
            )}
          </div>
        ) : (
          filteredActions.map((action) => (
            <AgentActionCard
              key={action.id}
              action={action}
              onApprove={action.status === 'pending' ? handleApprove : undefined}
              onReject={action.status === 'pending' ? handleReject : undefined}
              onViewReasoning={handleViewReasoning}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Policy Editor ────────────────────────────────────────────────────────

function PolicyEditor({ folder }: { folder: Folder }) {
  const policy: AgentPolicy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
  const [focusText, setFocusText] = useState(policy.focusAreas?.join(', ') ?? '');
  const [showFocus, setShowFocus] = useState(!!policy.focusAreas?.length);

  const updatePolicy = async (updates: Partial<AgentPolicy>) => {
    const newPolicy = { ...policy, ...updates };
    await db.folders.update(folder.id, { agentPolicy: newPolicy });
  };

  const saveFocusAreas = async () => {
    const areas = focusText.split(',').map(s => s.trim()).filter(Boolean);
    await updatePolicy({ focusAreas: areas.length > 0 ? areas : undefined });
  };

  const toggles: { key: keyof AgentPolicy; label: string; description: string }[] = [
    { key: 'autoApproveReads', label: 'Reads', description: 'Search, list, read entities' },
    { key: 'autoApproveEnrich', label: 'Enrich', description: 'Fetch URLs, extract IOCs' },
    { key: 'autoApproveCreate', label: 'Create', description: 'New notes, tasks, IOCs' },
    { key: 'autoApproveModify', label: 'Modify', description: 'Update existing entities' },
  ];

  return (
    <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised/50 space-y-3">
      <div className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Auto-approve Policy</div>

      <div className="grid grid-cols-2 gap-2">
        {toggles.map(({ key, label, description }) => (
          <button
            key={key}
            onClick={() => updatePolicy({ [key]: !policy[key] })}
            className={cn(
              'flex items-center gap-2 text-left px-2 py-1.5 rounded border transition-colors',
              policy[key]
                ? 'border-accent-green/30 bg-accent-green/5'
                : 'border-border-subtle bg-surface',
            )}
          >
            <div className={cn(
              'w-3 h-3 rounded-sm border flex items-center justify-center shrink-0',
              policy[key]
                ? 'bg-accent-green border-accent-green text-white'
                : 'border-border-medium',
            )}>
              {policy[key] && <span className="text-[8px]">✓</span>}
            </div>
            <div>
              <div className="text-xs text-text-primary">{label}</div>
              <div className="text-[10px] text-text-muted">{description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Interval */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-text-muted shrink-0">Interval</label>
        <input
          type="range"
          min={1}
          max={30}
          value={policy.intervalMinutes || 5}
          onChange={(e) => updatePolicy({ intervalMinutes: parseInt(e.target.value) })}
          className="flex-1 h-1 accent-accent-blue"
        />
        <span className="text-xs text-text-secondary w-12 text-right">{policy.intervalMinutes || 5}m</span>
      </div>

      {/* Focus areas */}
      <div>
        <button
          onClick={() => setShowFocus(!showFocus)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showFocus ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Focus areas
        </button>
        {showFocus && (
          <div className="mt-1.5">
            <textarea
              value={focusText}
              onChange={(e) => setFocusText(e.target.value)}
              onBlur={saveFocusAreas}
              placeholder="e.g. enrich IOCs, build timeline, look for lateral movement"
              rows={2}
              className="w-full text-xs bg-surface border border-border-subtle rounded px-2 py-1.5 text-text-primary placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-blue/50"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Comma-separated areas the agent should focus on</p>
          </div>
        )}
      </div>
    </div>
  );
}
