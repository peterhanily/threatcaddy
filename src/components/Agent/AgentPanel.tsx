import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Play, CheckCheck, Loader2, AlertTriangle, X, Settings as SettingsIcon, ChevronDown, ChevronRight, Key, Puzzle,
} from 'lucide-react';
import type { AgentAction, AgentPolicy, AgentProfile, AgentDeployment, Folder, AgentStatus, Settings } from '../../types';
import { DEFAULT_AGENT_POLICY } from '../../types';
import { cn, formatDate, postMessageOrigin } from '../../lib/utils';
import { db } from '../../db';
import { executeApprovedAction, rejectAction, bulkApproveActions } from '../../lib/caddy-agent';
import { AgentActionCard } from './AgentActionCard';
import { AgentProfilePicker } from './AgentProfilePicker';
import { AgentMeetingPanel } from './AgentMeetingPanel';
import { MODELS } from '../../lib/models';
import { BUILTIN_AGENT_PROFILES } from '../../lib/builtin-agent-profiles';

const ACTION_PAGE_SIZE = 100;

interface AgentPanelProps {
  folder: Folder;
  settings: Settings;
  /** From useCaddyAgent hook */
  agentRunning?: boolean;
  agentProgress?: string;
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
}

export function AgentPanel({
  folder, settings,
  agentRunning = false, agentProgress = '', agentError = null, agentStatus,
  onRunOnce, onNavigateToChat, onNavigateToNote, onEntitiesChanged, onOpenSettings, onFolderChanged,
  profiles = [], deployments = [], onDeployProfile, onRemoveDeployment,
}: AgentPanelProps) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'executed' | 'rejected'>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [showProfilePicker, setShowProfilePicker] = useState(false);

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
  const isReady = (extensionAvailable || hasServerProxy) && (hasApiKey || hasServerProxy);

  // Load actions for this investigation (paginated)
  const loadActions = useCallback(async () => {
    const results = await db.agentActions
      .where('[investigationId+createdAt]')
      .between([folder.id, -Infinity], [folder.id, Infinity])
      .reverse()
      .limit(ACTION_PAGE_SIZE + 1)
      .toArray();

    setHasMore(results.length > ACTION_PAGE_SIZE);
    setActions(results.slice(0, ACTION_PAGE_SIZE));
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
    try {
      await executeApprovedAction(action);
      await loadActions();
      onEntitiesChanged?.();
    } catch (err) {
      setLocalError(`Approve failed: ${(err as Error).message}`);
    }
  };

  const handleReject = async (action: AgentAction) => {
    try {
      await rejectAction(action.id);
      await loadActions();
    } catch (err) {
      setLocalError(`Reject failed: ${(err as Error).message}`);
    }
  };

  const handleBulkApprove = async () => {
    setConfirmBulk(false);
    try {
      const result = await bulkApproveActions(folder.id);
      if (result.failed > 0) {
        setLocalError(`Approved ${result.executed}, failed ${result.failed}`);
      }
      await loadActions();
      onEntitiesChanged?.();
    } catch (err) {
      setLocalError(`Bulk approve failed: ${(err as Error).message}`);
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
          <h2 className="font-semibold text-sm">AgentCaddy</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">Set up AgentCaddy</h3>
            {!hasApiKey && !hasServerProxy && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-accent-blue/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Key size={14} className="text-accent-blue" />
                </div>
                <div>
                  <p className="text-xs font-medium text-text-primary">Configure an API key</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Add an API key in Settings &gt; AI/LLM for Anthropic, OpenAI, Gemini, Mistral, or a local LLM.
                  </p>
                  {onOpenSettings && (
                    <button
                      onClick={() => onOpenSettings('ai')}
                      className="text-[11px] text-accent-blue hover:underline mt-1"
                    >
                      Open AI Settings
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
                  <p className="text-xs font-medium text-text-primary">Install the browser extension</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    AgentCaddy requires the ThreatCaddy browser extension to proxy API requests, or a connected team server.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-accent-blue" />
          <h2 className="font-semibold text-sm">AgentCaddy</h2>
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
            aria-label="Toggle agent settings"
          >
            <SettingsIcon size={14} />
          </button>
          <button
            onClick={handleRunAgent}
            disabled={agentRunning}
            aria-label={agentRunning ? 'Agent is running' : 'Run agent cycle'}
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
                Run Agent
              </>
            )}
          </button>
        </div>
      </div>

      {/* Policy editor (collapsible) */}
      {showSettings && (
        <PolicyEditor folder={folder} settings={settings} onFolderChanged={onFolderChanged} />
      )}

      {/* Deployed agents section */}
      {deployments.length > 0 && (
        <div className="px-4 py-2 border-b border-border-subtle space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Deployed Agents</span>
            <button
              onClick={() => setShowProfilePicker(true)}
              className="text-[10px] text-accent-blue hover:underline"
            >
              + Add
            </button>
          </div>
          {deployments.map(d => {
            const p = profiles.find(pr => pr.id === d.profileId) || BUILTIN_AGENT_PROFILES.find(pr => pr.id === d.profileId);
            if (!p) return null;
            return (
              <div key={d.id} className="flex items-center gap-2 py-1 group">
                <span className="text-xs">{p.icon || '🤖'}</span>
                <span className="text-[11px] text-text-primary flex-1 truncate">{p.name}</span>
                <span className={cn('text-[9px] px-1 py-px rounded',
                  d.status === 'running' && 'bg-accent-blue/10 text-accent-blue',
                  d.status === 'idle' && 'bg-surface-raised text-text-muted',
                  d.status === 'waiting' && 'bg-accent-amber/10 text-accent-amber',
                  d.status === 'error' && 'bg-red-400/10 text-red-400',
                )}>
                  {d.status}
                </span>
                {onRemoveDeployment && (
                  <button
                    onClick={() => onRemoveDeployment(d.id)}
                    className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove deployment"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deploy profiles button (when no deployments yet) */}
      {deployments.length === 0 && onDeployProfile && (
        <div className="px-4 py-2 border-b border-border-subtle">
          <button
            onClick={() => setShowProfilePicker(true)}
            className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline"
          >
            <Bot size={12} />
            Deploy Agent Profiles
          </button>
          <p className="text-[10px] text-text-muted mt-0.5">
            Assign specialized agents (IOC Enricher, Timeline Builder, etc.) to work this case in parallel.
          </p>
        </div>
      )}

      {/* Meeting panel (when 2+ agents deployed) */}
      {deployments.length >= 2 && (
        <div className="px-4 py-2 border-b border-border-subtle">
          <AgentMeetingPanel
            folder={folder}
            deployments={deployments}
            settings={settings}
            extensionAvailable={extensionAvailable}
            onNavigateToChat={onNavigateToChat}
            onNavigateToNote={onNavigateToNote}
            onEntitiesChanged={onEntitiesChanged}
          />
        </div>
      )}

      {/* Profile picker modal */}
      {showProfilePicker && onDeployProfile && (
        <AgentProfilePicker
          profiles={profiles.length > 0 ? profiles : BUILTIN_AGENT_PROFILES}
          deployments={deployments}
          onDeploy={(profile) => { onDeployProfile(profile); setShowProfilePicker(false); }}
          onCreateProfile={() => { setShowProfilePicker(false); onOpenSettings?.('templates'); }}
          onClose={() => setShowProfilePicker(false)}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-400/10 text-red-400 text-xs border-b border-red-400/20" role="alert">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{error}</span>
            {(error.includes('API key') || error.includes('timed out') || error.includes('No API key')) && onOpenSettings && (
              <button onClick={() => onOpenSettings('ai')} className="block text-accent-blue hover:underline mt-0.5">
                Open AI Settings
              </button>
            )}
          </div>
          <button onClick={() => setLocalError(null)} className="hover:text-red-300 shrink-0" aria-label="Dismiss error">
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
          {confirmBulk ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted">Execute {pendingCount} actions?</span>
              <button onClick={handleBulkApprove} className="text-[10px] text-accent-green hover:bg-accent-green/10 px-1.5 py-0.5 rounded">Yes</button>
              <button onClick={() => setConfirmBulk(false)} className="text-[10px] text-text-muted hover:bg-surface-raised px-1.5 py-0.5 rounded">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmBulk(true)}
              className="flex items-center gap-1 text-xs text-accent-green hover:bg-accent-green/10 px-2 py-1 rounded transition-colors"
              aria-label={`Approve all ${pendingCount} pending actions`}
            >
              <CheckCheck size={12} />
              Approve All
            </button>
          )}
        </div>
      )}

      {/* Two-column layout: left = agents & meetings, right = actions */}
      <div className="flex-1 flex min-h-0">
        {/* Left column — agents + meetings */}
        {deployments.length > 0 && (
          <div className="w-64 shrink-0 border-r border-border-subtle overflow-y-auto">
            {/* Deployed agents */}
            <div className="px-3 py-2 space-y-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Agents</span>
              {deployments.map(d => {
                const p = profiles.find(pr => pr.id === d.profileId) || BUILTIN_AGENT_PROFILES.find(pr => pr.id === d.profileId);
                if (!p) return null;
                const supervisor = d.supervisorDeploymentId
                  ? deployments.find(s => s.id === d.supervisorDeploymentId)
                  : undefined;
                return (
                  <div key={d.id} className="flex items-center gap-1.5 py-1 group text-[11px]">
                    <span>{p.icon || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-text-primary truncate">{p.name}</div>
                      {supervisor && (
                        <div className="text-[9px] text-text-muted">supervised</div>
                      )}
                    </div>
                    <span className={cn('text-[8px] px-1 py-px rounded',
                      d.status === 'running' && 'bg-accent-blue/10 text-accent-blue',
                      d.status === 'idle' && 'bg-surface-raised text-text-muted',
                      d.status === 'waiting' && 'bg-accent-amber/10 text-accent-amber',
                      d.status === 'error' && 'bg-red-400/10 text-red-400',
                    )}>{d.status}</span>
                    {onRemoveDeployment && (
                      <button onClick={() => onRemoveDeployment(d.id)} className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100" title="Remove">
                        <X size={9} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button onClick={() => setShowProfilePicker(true)} className="text-[10px] text-accent-blue hover:underline mt-1">+ Deploy</button>
            </div>

            {/* Meetings */}
            {deployments.length >= 2 && (
              <div className="px-3 py-2 border-t border-border-subtle">
                <AgentMeetingPanel
                  folder={folder}
                  deployments={deployments}
                  settings={settings}
                  extensionAvailable={extensionAvailable}
                  onNavigateToChat={onNavigateToChat}
                  onNavigateToNote={onNavigateToNote}
                  onEntitiesChanged={onEntitiesChanged}
                />
              </div>
            )}
          </div>
        )}

        {/* Right column — actions */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Filter tabs */}
          <div className="flex gap-1 px-4 py-2 border-b border-border-subtle shrink-0" role="tablist">
            {(['all', 'pending', 'executed', 'rejected'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
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
          <div className="flex-1 overflow-auto px-4 py-3 space-y-2" role="tabpanel">
            {filteredActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <Bot size={32} className="mb-2 opacity-30" />
                <p className="text-sm">
                  {actions.length === 0
                    ? 'No agent activity yet. Click "Run Agent" to start.'
                    : `No ${filter} actions.`
                  }
                </p>
                {actions.length === 0 && folder.agentLastRunAt && (
                  <p className="text-xs mt-1">Last run: {formatDate(folder.agentLastRunAt)}</p>
                )}
              </div>
            ) : (
              <>
                {filteredActions.map((action) => (
                  <AgentActionCard
                    key={action.id}
                    action={action}
                    onApprove={action.status === 'pending' ? handleApprove : undefined}
                    onReject={action.status === 'pending' ? handleReject : undefined}
                    onViewReasoning={handleViewReasoning}
                  />
                ))}
                {hasMore && (
                  <p className="text-center text-[10px] text-text-muted py-2">
                    Showing latest {ACTION_PAGE_SIZE} actions
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Policy Editor ────────────────────────────────────────────────────────

function PolicyEditor({ folder, settings, onFolderChanged }: { folder: Folder; settings: Settings; onFolderChanged?: () => void }) {
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
      <div className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Auto-approve Policy</div>

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
