import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot, Play, CheckCheck, Loader2, AlertTriangle, X, Settings as SettingsIcon, ChevronDown, ChevronRight, Key, Puzzle, Plus, Server,
} from 'lucide-react';
import type { AgentAction, AgentPolicy, AgentProfile, AgentDeployment, Folder, AgentStatus, Settings, Task } from '../../types';
import { DEFAULT_AGENT_POLICY } from '../../types';
import { cn, formatDate, postMessageOrigin } from '../../lib/utils';
import { db } from '../../db';
import { executeApprovedAction, rejectAction, bulkApproveActions } from '../../lib/caddy-agent';
import { acknowledgeReconciliation } from '../../lib/agent-handoff';
import { AgentActionCard } from './AgentActionCard';
import { AgentProfilePicker } from './AgentProfilePicker';
import { AgentMeetingPanel } from './AgentMeetingPanel';
import { MODELS } from '../../lib/models';
import { BUILTIN_AGENT_PROFILES } from '../../lib/builtin-agent-profiles';
import { formatUSD } from '../../lib/model-pricing';

const ACTION_PAGE_SIZE = 100;

interface AgentPanelProps {
  folder: Folder;
  settings: Settings;
  /** From useCaddyAgent hook */
  agentRunning?: boolean;
  agentProgress?: string;
  agentStreamingContent?: string;
  agentError?: string | null;
  agentStatus?: AgentStatus;
  onRunOnce?: () => Promise<void>;
  onNavigateToChat?: (threadId: string) => void;
  onNavigateToNote?: (noteId: string) => void;
  onEntitiesChanged?: () => void;
  onOpenSettings?: (tab?: string) => void;
  onFolderChanged?: () => void;
  /** Multi-agent support */
  profiles?: AgentProfile[];
  deployments?: AgentDeployment[];
  onDeployProfile?: (profile: AgentProfile) => void;
  onRemoveDeployment?: (deploymentId: string) => void;
  /** Server-side agent support */
  serverConnected?: boolean;
  serverRegistered?: boolean;
  serverRunning?: boolean;
  onRegisterServer?: () => Promise<void>;
  onUnregisterServer?: () => Promise<void>;
}

export function AgentPanel({
  folder, settings,
  agentRunning = false, agentProgress = '', agentStreamingContent = '', agentError = null, agentStatus,
  onRunOnce, onNavigateToChat, onNavigateToNote, onEntitiesChanged, onOpenSettings, onFolderChanged,
  profiles = [], deployments = [], onDeployProfile, onRemoveDeployment,
  serverConnected, serverRegistered, serverRunning, onRegisterServer, onUnregisterServer,
}: AgentPanelProps) {
  const { t } = useTranslation('agent');
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'executed' | 'rejected'>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbox' | 'agents' | 'tasks' | 'logs'>('inbox');
  /** Client-side set of deployment IDs where the analyst has dismissed the
   *  handoff-reconciliation banner. Persisted via acknowledgeReconciliation()
   *  on the deployment, but tracked here for instant UI feedback before the
   *  parent re-fetches deployments. */
  const [dismissedReconciliations, setDismissedReconciliations] = useState<Set<string>>(new Set());

  const handleDismissReconciliation = async (deploymentId: string) => {
    setDismissedReconciliations(prev => new Set([...prev, deploymentId]));
    try {
      await acknowledgeReconciliation(deploymentId);
      onFolderChanged?.();
    } catch (err) {
      console.warn('[AgentPanel] acknowledgeReconciliation failed:', err);
      // Revert optimistic dismissal so the user can retry. Without this, client
      // shows dismissed while server still has the reconciliation unacknowledged.
      setDismissedReconciliations(prev => {
        const next = new Set(prev);
        next.delete(deploymentId);
        return next;
      });
    }
  };

  // Detect extension availability
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source === window && event.data?.type === 'TC_EXTENSION_READY') {
        setExtensionAvailable(true);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'TC_EXTENSION_PING' }, postMessageOrigin());
    return () => window.removeEventListener('message', handler);
  }, []);

  const error = agentError || localError;

  // Check if LLM is configured
  const hasApiKey = !!(
    settings.llmAnthropicApiKey?.trim() ||
    settings.llmOpenAIApiKey?.trim() ||
    settings.llmGeminiApiKey?.trim() ||
    settings.llmMistralApiKey?.trim() ||
    settings.llmLocalEndpoint?.trim()
  );
  const hasServerProxy = !!settings.serverUrl;
  const hasLocalLLM = !!settings.llmLocalEndpoint?.trim();
  const isReady = (extensionAvailable || hasServerProxy || hasLocalLLM) && (hasApiKey || hasServerProxy);

  // Load actions for this investigation (paginated)
  const [agentTasks, setAgentTasks] = useState<Task[]>([]);

  const loadActions = useCallback(async () => {
    const results = await db.agentActions
      .where('[investigationId+createdAt]')
      .between([folder.id, -Infinity], [folder.id, Infinity])
      .reverse()
      .limit(ACTION_PAGE_SIZE + 1)
      .toArray();

    setHasMore(results.length > ACTION_PAGE_SIZE);
    setActions(results.slice(0, ACTION_PAGE_SIZE));

    // Also load agent-related tasks
    const allTasks = await db.tasks.where('folderId').equals(folder.id).toArray();
    const tasks = allTasks.filter(t => !t.trashed && (t.tags?.includes('agent-delegated') || t.createdBy?.startsWith('agent:')));
    setAgentTasks(tasks.sort((a, b) => {
      // Sort: todo first, then in-progress, then done
      const order: Record<string, number> = { 'todo': 0, 'in-progress': 1, 'done': 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    }));
  }, [folder.id]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  // Reload actions when agent finishes a run
  useEffect(() => {
    if (!agentRunning) loadActions();
  }, [agentRunning, loadActions]);

  // Periodic refresh while agents are running
  useEffect(() => {
    if (!agentRunning) return;
    const timer = setInterval(loadActions, 5_000);
    return () => clearInterval(timer);
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
    try {
      await executeApprovedAction(action);
      await loadActions();
      onEntitiesChanged?.();
    } catch (err) {
      setLocalError(t('panel.approveFailed', { message: (err as Error).message }));
    }
  };

  const handleEditApprove = async (action: AgentAction, modifiedInput: Record<string, unknown>) => {
    try {
      // Update the action's toolInput, then execute
      await db.agentActions.update(action.id, { toolInput: modifiedInput });
      await executeApprovedAction({ ...action, toolInput: modifiedInput });
      await loadActions();
      onEntitiesChanged?.();
    } catch (err) {
      setLocalError(t('panel.executeWithEditsFailed', { message: (err as Error).message }));
    }
  };

  const handleReject = async (action: AgentAction) => {
    try {
      await rejectAction(action.id);
      await loadActions();
    } catch (err) {
      setLocalError(t('panel.rejectFailed', { message: (err as Error).message }));
    }
  };

  const handleBulkApprove = async () => {
    setConfirmBulk(false);
    try {
      const result = await bulkApproveActions(folder.id);
      if (result.failed > 0) {
        setLocalError(t('panel.bulkApproveResult', { executed: result.executed, failed: result.failed }));
      }
      await loadActions();
      onEntitiesChanged?.();
    } catch (err) {
      setLocalError(t('panel.bulkApproveFailed', { message: (err as Error).message }));
    }
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

  // ── Setup banner (no extension / no API key) ──
  if (!isReady) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Bot size={18} className="text-accent-blue" />
          <h2 className="font-semibold text-sm">{t('panel.agentCaddy')}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">{t('panel.setupAgentCaddy')}</h3>
            {!hasApiKey && !hasServerProxy && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-accent-blue/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Key size={14} className="text-accent-blue" />
                </div>
                <div>
                  <p className="text-xs font-medium text-text-primary">{t('panel.configureApiKey')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t('panel.configureApiKeyDesc')}
                  </p>
                  {onOpenSettings && (
                    <button
                      onClick={() => onOpenSettings('ai')}
                      className="text-[11px] text-accent-blue hover:underline mt-1"
                    >
                      {t('panel.openAISettings')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {!extensionAvailable && !hasServerProxy && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-accent-blue/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Puzzle size={14} className="text-accent-blue" />
                </div>
                <div>
                  <p className="text-xs font-medium text-text-primary">{t('panel.installExtension')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t('panel.installExtensionDesc')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const todoCount = agentTasks.filter(t => t.status === 'todo').length;
  const inProgressCount = agentTasks.filter(t => t.status === 'in-progress').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-accent-blue" />
          <h2 className="font-semibold text-sm">{t('panel.agentCaddy')}</h2>
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
              {t('panel.auto')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-text-muted hover:text-text-secondary p-1 rounded transition-colors"
            title={t('panel.agentSettings')}
            aria-label={t('panel.toggleAgentSettings')}
          >
            <SettingsIcon size={14} />
          </button>
          <button
            onClick={handleRunAgent}
            disabled={agentRunning}
            aria-label={agentRunning ? t('panel.agentRunning') : t('panel.runAgentCycle')}
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
                {agentProgress || t('panel.running')}
              </>
            ) : (
              <>
                <Play size={12} />
                <span className="hidden sm:inline">{t('panel.runAgent')}</span><span className="sm:hidden">{t('panel.run')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Policy editor (collapsible) */}
      {showSettings && (
        <PolicyEditor folder={folder} settings={settings} onFolderChanged={onFolderChanged} />
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-400/10 text-red-400 text-xs border-b border-red-400/20 shrink-0" role="alert">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{error}</span>
            {(error.includes('API key') || error.includes('timed out') || error.includes('No API key')) && onOpenSettings && (
              <button onClick={() => onOpenSettings('ai')} className="block text-accent-blue hover:underline mt-0.5">{t('panel.openAISettingsLink')}</button>
            )}
          </div>
          <button onClick={() => setLocalError(null)} className="hover:text-red-300 shrink-0" aria-label={t('panel.dismissError')}><X size={12} /></button>
        </div>
      )}

      {/* Tab bar — fixed, scrollable on small screens */}
      <div className="flex items-center gap-1 px-3 sm:px-4 py-1.5 border-b border-border-subtle shrink-0 overflow-x-auto">
        {([
          { key: 'inbox' as const, label: t('panel.inbox'), badge: pendingCount },
          { key: 'agents' as const, label: t('panel.agents'), badge: deployments.length },
          { key: 'tasks' as const, label: t('panel.tasks'), badge: todoCount + inProgressCount },
          { key: 'logs' as const, label: t('panel.logs'), badge: 0 },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn('text-xs px-3 py-1.5 rounded-md transition-colors',
              activeTab === tab.key ? 'bg-surface-raised text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised/50',
            )}
          >
            {tab.label}
            {tab.badge > 0 && <span className={cn('ml-1 text-[10px]', tab.key === 'inbox' ? 'text-accent-amber' : 'text-text-muted')}>({tab.badge})</span>}
          </button>
        ))}
      </div>

      {/* Profile picker modal */}
      {showProfilePicker && onDeployProfile && (
        <AgentProfilePicker profiles={profiles.length > 0 ? profiles : BUILTIN_AGENT_PROFILES} deployments={deployments}
          onDeployMultiple={(selections) => {
            for (const { profile, count } of selections) {
              for (let i = 0; i < count; i++) onDeployProfile?.(profile);
            }
            setShowProfilePicker(false);
          }}
          onCreateProfile={() => { setShowProfilePicker(false); onOpenSettings?.('templates'); }}
          onClose={() => setShowProfilePicker(false)} />
      )}

      {/* ═══ TAB: Inbox ═══ */}
      {activeTab === 'inbox' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Live streaming display */}
          {agentRunning && agentStreamingContent && (
            <div className="px-4 py-2 border-b border-accent-blue/20 bg-accent-blue/5 max-h-32 overflow-auto shrink-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Loader2 size={10} className="animate-spin text-accent-blue" />
                <span className="text-[10px] text-accent-blue font-medium">{t('panel.live')}</span>
              </div>
              <pre className="text-[10px] text-text-secondary font-mono whitespace-pre-wrap leading-relaxed">
                {agentStreamingContent.length > 2000 ? '...' + agentStreamingContent.slice(-2000) : agentStreamingContent}
              </pre>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-border-subtle shrink-0">
            <div className="flex gap-1" role="tablist">
              {(['all', 'pending', 'executed', 'rejected'] as const).map(f => (
                <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                  className={cn('text-[10px] px-1.5 py-0.5 rounded capitalize', filter === f ? 'bg-surface-raised text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary')}
                >{f}{f === 'pending' && pendingCount > 0 && <span className="ml-0.5 text-accent-amber">({pendingCount})</span>}</button>
              ))}
            </div>
            {pendingCount > 0 && (confirmBulk ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-text-muted">Execute {pendingCount}?</span>
                <button onClick={handleBulkApprove} className="text-[9px] text-accent-green px-1 rounded hover:bg-accent-green/10">Yes</button>
                <button onClick={() => setConfirmBulk(false)} className="text-[9px] text-text-muted px-1 rounded hover:bg-surface-raised">No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmBulk(true)} className="flex items-center gap-1 text-[10px] text-accent-green hover:bg-accent-green/10 px-1.5 py-0.5 rounded">
                <CheckCheck size={10} /> {t('panel.approveAll')}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto px-4 py-2 space-y-2">
            {filteredActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-text-muted">
                <Bot size={24} className="mb-1 opacity-30" />
                <p className="text-xs">{actions.length === 0 ? t('panel.noActivityYet') : t('panel.noFilteredActions', { filter })}</p>
              </div>
            ) : filteredActions.map(action => (
              <AgentActionCard key={action.id} action={action}
                onApprove={action.status === 'pending' ? handleApprove : undefined}
                onEditApprove={action.status === 'pending' ? handleEditApprove : undefined}
                onReject={action.status === 'pending' ? handleReject : undefined}
                onViewReasoning={handleViewReasoning} />
            ))}
            {hasMore && <p className="text-center text-[10px] text-text-muted py-1">{t('panel.showingLatest', { count: ACTION_PAGE_SIZE })}</p>}
          </div>
        </div>
      )}

      {/* ═══ TAB: Agents ═══ */}
      {activeTab === 'agents' && (
        <div className="flex-1 overflow-auto">
          <div className="px-4 py-3 space-y-2">
            {deployments.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <Bot size={24} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs mb-1">{t('panel.noAgentsDeployed')}</p>
                <p className="text-[10px] text-text-muted mb-2">{t('panel.deployHint')}</p>
                <button onClick={() => setShowProfilePicker(true)} className="text-xs text-accent-blue hover:underline">{t('panel.deployAgentProfiles')}</button>
              </div>
            ) : (
              <>
                {deployments.map(d => {
                  const p = profiles.find(pr => pr.id === d.profileId) || BUILTIN_AGENT_PROFILES.find(pr => pr.id === d.profileId);
                  if (!p) return null;
                  return (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg border border-border-subtle bg-surface group">
                      <span className="text-lg">{p.icon || '🤖'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary">{p.name}</div>
                        <div className="text-[10px] text-text-muted">{p.role}{d.supervisorDeploymentId ? ' · supervised' : ''}</div>
                        {d.metrics && d.metrics.cyclesRun > 0 && (() => {
                          const m = d.metrics;
                          const topTool = m.toolCallHistogram
                            ? Object.entries(m.toolCallHistogram).sort((a, b) => b[1] - a[1])[0]
                            : undefined;
                          const totalTokens = m.tokensUsed.input + m.tokensUsed.output;
                          return (
                            <>
                              <div className="text-[9px] text-text-muted flex gap-2 mt-0.5">
                                <span>{m.cyclesRun} cycles</span>
                                <span>{m.toolCallsExecuted} exec</span>
                                <span>{m.toolCallsProposed} proposed</span>
                              </div>
                              {(m.costUSD || totalTokens > 0 || topTool) && (
                                <div className="text-[9px] text-text-muted flex gap-2 mt-0.5">
                                  {m.costUSD != null && m.costUSD > 0 && (
                                    <span title={`${m.tokensUsed.input.toLocaleString()} in / ${m.tokensUsed.output.toLocaleString()} out`}>
                                      {formatUSD(m.costUSD)}
                                    </span>
                                  )}
                                  {totalTokens > 0 && (
                                    <span>{totalTokens >= 1000 ? `${Math.round(totalTokens / 1000)}k` : totalTokens} tok</span>
                                  )}
                                  {topTool && <span title="Most-used tool">{topTool[0]} ×{topTool[1]}</span>}
                                </div>
                              )}
                              {m.tasksEscalated != null && m.tasksEscalated > 0 && (
                                <div className="text-[9px] text-accent-amber flex gap-1 mt-0.5" title="Tasks this agent auto-escalated to a human after 3 rejections — needs analyst review.">
                                  <AlertTriangle size={10} /> {m.tasksEscalated} escalated to human
                                </div>
                              )}
                              {(() => {
                                const r = d.lastHandoffReconciliation;
                                if (!r || r.acknowledged || dismissedReconciliations.has(d.id)) return null;
                                const topTool = Object.entries(r.toolHistogram).sort((a, b) => b[1] - a[1])[0];
                                const count = r.serverActionCount;
                                const topToolSuffix = topTool ? t('panel.topToolSuffix', { name: topTool[0], count: topTool[1] }) : '';
                                const title = t('panel.serverRanActionsTitle', { count, topToolSuffix });
                                return (
                                  <div
                                    className="text-[9px] text-accent-blue flex items-center gap-1 mt-0.5"
                                    title={title}
                                  >
                                    <Server size={10} />
                                    <span>
                                      {t('panel.serverRanActions', { count })}
                                      {topTool && ` (${topTool[0]}×${topTool[1]})`}
                                    </span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void handleDismissReconciliation(d.id); }}
                                      className="ml-auto text-text-muted hover:text-text-primary"
                                      aria-label={t('panel.dismissHandoffSummary')}
                                    >
                                      <X size={10} />
                                    </button>
                                  </div>
                                );
                              })()}
                            </>
                          );
                        })()}
                      </div>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded',
                        d.status === 'running' && 'bg-accent-blue/10 text-accent-blue',
                        d.status === 'idle' && 'bg-surface-raised text-text-muted',
                        d.status === 'waiting' && 'bg-accent-amber/10 text-accent-amber',
                        d.status === 'error' && 'bg-red-400/10 text-red-400',
                      )}>{d.status}</span>
                      {onRemoveDeployment && (
                        <button onClick={() => onRemoveDeployment(d.id)} className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" title="Remove"><X size={12} /></button>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => setShowProfilePicker(true)} className="flex items-center gap-1 text-xs text-accent-blue hover:underline"><Plus size={12} /> {t('panel.deployAnother')}</button>
              </>
            )}
          </div>
          {deployments.length >= 2 && (
            <div className="px-4 py-3 border-t border-border-subtle">
              <AgentMeetingPanel folder={folder} deployments={deployments} settings={settings} extensionAvailable={extensionAvailable}
                onNavigateToChat={onNavigateToChat} onNavigateToNote={onNavigateToNote} onEntitiesChanged={onEntitiesChanged} />
            </div>
          )}

          {/* Server-side mode */}
          {serverConnected && deployments.length > 0 && (
            <div className="px-4 py-3 border-t border-border-subtle">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-text-primary">{t('panel.serverSideMode')}</span>
                  <p className="text-[10px] text-text-muted">{t('panel.serverSideModeDesc')}</p>
                </div>
                {serverRegistered ? (
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded',
                      serverRunning ? 'bg-accent-green/10 text-accent-green' : 'bg-surface-raised text-text-muted',
                    )}>
                      {serverRunning ? t('panel.serverActive') : t('panel.registered')}
                    </span>
                    <button onClick={onUnregisterServer} className="text-[10px] text-text-muted hover:text-red-400">{t('panel.disable')}</button>
                  </div>
                ) : (
                  <button onClick={onRegisterServer} className="text-[10px] text-accent-blue hover:underline">{t('panel.enable')}</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: Tasks ═══ */}
      {activeTab === 'tasks' && (
        <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
          {agentTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-muted">
              <p className="text-xs">{t('panel.noAgentTasks')}</p>
            </div>
          ) : agentTasks.map(task => (
            <div key={task.id} className="border border-border-subtle rounded-lg p-2.5 bg-surface">
              <div className="flex items-center gap-2">
                <span className={cn('text-[9px] uppercase font-medium px-1.5 py-0.5 rounded',
                  task.status === 'done' ? 'text-accent-green bg-accent-green/10' : task.status === 'in-progress' ? 'text-accent-blue bg-accent-blue/10' : 'text-accent-amber bg-accent-amber/10',
                )}>{task.status}</span>
                <span className="text-xs text-text-primary flex-1 truncate">{task.title}</span>
                {task.priority && <span className={cn('text-[9px]', task.priority === 'high' ? 'text-red-400' : 'text-text-muted')}>{task.priority}</span>}
              </div>
              {task.description && <p className="text-[10px] text-text-muted mt-1 line-clamp-2">{task.description.replace(/\[.*?\]\s*/g, '').substring(0, 150)}</p>}
              <div className="flex items-center gap-2 mt-1 text-[9px] text-text-muted">
                <span>{formatDate(task.createdAt)}</span>
                {task.createdBy?.startsWith('agent:') && <span className="text-accent-blue">agent</span>}
                {task.tags?.includes('agent-delegated') && <span className="text-purple">delegated</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ TAB: Logs ═══ */}
      {activeTab === 'logs' && (
        <div className="flex-1 overflow-auto px-4 py-3 space-y-1">
          {actions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-muted">
              <p className="text-xs">{t('panel.noActivityLogs')}</p>
            </div>
          ) : (
            <>
              {/* Aggregate stats */}
              <div className="flex gap-4 mb-3 text-[10px] text-text-muted">
                <span>Total: {actions.length} actions</span>
                <span className="text-accent-green">{actions.filter(a => a.status === 'executed').length} executed</span>
                <span className="text-accent-amber">{actions.filter(a => a.status === 'pending').length} pending</span>
                <span className="text-red-400">{actions.filter(a => a.status === 'failed').length} failed</span>
              </div>
              {/* Chronological log */}
              {actions.map(action => {
                const profile = action.agentConfigId
                  ? profiles.find(p => p.id === action.agentConfigId) || BUILTIN_AGENT_PROFILES.find(p => p.id === action.agentConfigId)
                  : null;
                return (
                  <div key={action.id} className="flex items-center gap-2 py-1 text-[10px] border-b border-border-subtle/50">
                    <span className="text-text-muted w-20 shrink-0 font-mono">{formatDate(action.createdAt)}</span>
                    {profile && <span className="shrink-0">{profile.icon || '🤖'}</span>}
                    <code className="text-text-primary shrink-0">{action.toolName}</code>
                    <span className={cn('shrink-0',
                      action.status === 'executed' ? 'text-accent-green' : action.status === 'pending' ? 'text-accent-amber' : action.status === 'failed' ? 'text-red-400' : 'text-text-muted',
                    )}>{action.status}</span>
                    <span className="text-text-muted truncate flex-1">{action.rationale.substring(0, 60)}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Policy Editor ────────────────────────────────────────────────────────

function PolicyEditor({ folder, settings, onFolderChanged }: { folder: Folder; settings: Settings; onFolderChanged?: () => void }) {
  const { t } = useTranslation('agent');
  // Local state for immediate visual feedback
  const [localPolicy, setLocalPolicy] = useState<AgentPolicy>(folder.agentPolicy ?? DEFAULT_AGENT_POLICY);
  const [focusText, setFocusText] = useState(localPolicy.focusAreas?.join(', ') ?? '');
  const [showFocus, setShowFocus] = useState(!!localPolicy.focusAreas?.length);

  // Sync from folder prop when it changes externally
  useEffect(() => {
    setLocalPolicy(folder.agentPolicy ?? DEFAULT_AGENT_POLICY);
  }, [folder.agentPolicy]);

  useEffect(() => {
    setFocusText((folder.agentPolicy ?? DEFAULT_AGENT_POLICY).focusAreas?.join(', ') ?? '');
  }, [folder.agentPolicy]);

  const updatePolicy = async (updates: Partial<AgentPolicy>) => {
    const newPolicy = { ...localPolicy, ...updates };
    // Update local state immediately for visual feedback
    setLocalPolicy(newPolicy);
    try {
      await db.folders.update(folder.id, { agentPolicy: newPolicy });
      onFolderChanged?.();
    } catch (err) {
      console.error('Failed to save agent policy:', err);
      // Revert on failure
      setLocalPolicy(folder.agentPolicy ?? DEFAULT_AGENT_POLICY);
    }
  };

  const saveFocusAreas = async () => {
    const areas = focusText.split(',').map(s => s.trim()).filter(Boolean);
    await updatePolicy({ focusAreas: areas.length > 0 ? areas : undefined });
  };

  const toggles: { key: keyof AgentPolicy; label: string; description: string }[] = [
    { key: 'autoApproveReads', label: 'Reads', description: 'Search, list, read entities' },
    { key: 'autoApproveEnrich', label: 'Enrich', description: 'Extract IOCs, analyze data' },
    { key: 'autoApproveFetch', label: 'Fetch', description: 'Web requests, OSINT lookups' },
    { key: 'autoApproveCreate', label: 'Create', description: 'New notes, tasks, IOCs' },
    { key: 'autoApproveModify', label: 'Modify', description: 'Update existing entities' },
  ];

  return (
    <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised/50 space-y-3">
      <div className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">{t('panel.autoApprovePolicy')}</div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Auto-approve settings">
        {toggles.map(({ key, label, description }) => (
          <button
            key={key}
            role="checkbox"
            aria-checked={!!localPolicy[key]}
            aria-label={`Auto-approve ${label}: ${description}`}
            onClick={() => updatePolicy({ [key]: !localPolicy[key] })}
            className={cn(
              'flex items-center gap-2 text-left px-2 py-1.5 rounded border transition-colors',
              localPolicy[key]
                ? 'border-accent-green/30 bg-accent-green/5'
                : 'border-border-subtle bg-surface',
            )}
          >
            <div className={cn(
              'w-3 h-3 rounded-sm border flex items-center justify-center shrink-0',
              localPolicy[key]
                ? 'bg-accent-green border-accent-green text-white'
                : 'border-border-medium',
            )}>
              {localPolicy[key] && <span className="text-[8px]">✓</span>}
            </div>
            <div>
              <div className="text-xs text-text-primary">{label}</div>
              <div className="text-[10px] text-text-muted">{description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Model selector */}
      <AgentModelSelector settings={settings} policy={localPolicy} onModelChange={(model) => updatePolicy({ model })} />

      {/* Interval */}
      <div className="flex items-center gap-3">
        <label htmlFor="agent-interval" className="text-xs text-text-muted shrink-0">Interval</label>
        <input
          id="agent-interval"
          type="range"
          min={1}
          max={30}
          value={localPolicy.intervalMinutes || 5}
          onChange={(e) => updatePolicy({ intervalMinutes: parseInt(e.target.value) })}
          className="flex-1 h-1 accent-accent-blue"
        />
        <span className="text-xs text-text-secondary w-12 text-right">{localPolicy.intervalMinutes || 5}m</span>
      </div>

      {/* Focus areas */}
      <div>
        <button
          onClick={() => setShowFocus(!showFocus)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
          aria-expanded={showFocus}
        >
          {showFocus ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Focus areas
        </button>
        {showFocus && (
          <div className="mt-1.5">
            <textarea
              maxLength={2000}
              value={focusText}
              onChange={(e) => setFocusText(e.target.value)}
              onBlur={saveFocusAreas}
              placeholder="e.g. enrich IOCs, build timeline, look for lateral movement"
              rows={2}
              aria-label="Agent focus areas (comma-separated)"
              className="w-full text-xs bg-surface border border-border-subtle rounded px-2 py-1.5 text-text-primary placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-blue/50"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Comma-separated areas the agent should focus on</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Model Selector ──────────────────────────────────────────────────────

function AgentModelSelector({ settings, policy, onModelChange }: {
  settings: Settings;
  policy: AgentPolicy;
  onModelChange: (model: string | undefined) => void;
}) {
  // Build list of available models from configured providers
  const configuredProviders = new Set<string>();
  if (settings.llmAnthropicApiKey?.trim()) configuredProviders.add('anthropic');
  if (settings.llmOpenAIApiKey?.trim()) configuredProviders.add('openai');
  if (settings.llmGeminiApiKey?.trim()) configuredProviders.add('gemini');
  if (settings.llmMistralApiKey?.trim()) configuredProviders.add('mistral');
  if (settings.llmLocalEndpoint?.trim()) configuredProviders.add('local');

  const availableModels = MODELS.filter(m => configuredProviders.has(m.provider));
  const hasLocal = configuredProviders.has('local');

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="agent-model" className="text-xs text-text-muted shrink-0">Model</label>
      <select
        id="agent-model"
        value={policy.model || ''}
        onChange={(e) => onModelChange(e.target.value || undefined)}
        className="flex-1 text-xs bg-surface border border-border-subtle rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue/50"
      >
        <option value="">Auto (use default)</option>
        {Array.from(new Set(availableModels.map(m => m.group))).map(group => (
          <optgroup key={group} label={group}>
            {availableModels.filter(m => m.group === group).map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </optgroup>
        ))}
        {hasLocal && settings.llmLocalModelName && (
          <optgroup label="Local">
            <option value={settings.llmLocalModelName}>Local: {settings.llmLocalModelName}</option>
          </optgroup>
        )}
      </select>
    </div>
  );
}
