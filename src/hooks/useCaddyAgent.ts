/**
 * useCaddyAgent — React hook managing the auto-repeating agent loop.
 *
 * Lifecycle:
 * - When `agentEnabled` is true on the selected folder, starts an interval timer
 * - Each tick calls `runAgentCycle` (from caddy-agent.ts)
 * - Adaptive intervals: base interval from policy, doubles when agent proposes (waiting)
 * - Stops when disabled, folder changes, or component unmounts
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { Folder, Settings, AgentStatus } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { db } from '../db';
import { runAgentCycle } from '../lib/caddy-agent';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { runSupervisorCycle, sendEscalationNotification } from '../lib/caddy-agent-supervisor';
import { postMessageOrigin } from '../lib/utils';

interface UseCaddyAgentOptions {
  folder?: Folder;
  settings: Settings;
  onEntitiesChanged?: () => void;
}

interface UseCaddyAgentResult {
  /** Whether the agent loop is currently running */
  running: boolean;
  /** Current status text (for UI display) */
  progress: string;
  /** Last error message, if any */
  error: string | null;
  /** Live streaming text from the agent's current LLM call */
  streamingContent: string;
  /** Manually trigger a single agent cycle */
  runOnce: () => Promise<void>;
  /** Toggle agent on/off for the current investigation */
  toggleAgent: () => Promise<void>;
  /** Current agent status */
  agentStatus: AgentStatus | undefined;
}

/** Max character length for working memory to prevent unbounded growth. */
const MAX_WORKING_MEMORY_CHARS = 10_000;
/** After an error, wait this many ms before retrying (doubles each retry, max 3 retries). */
const ERROR_RETRY_BASE_MS = 60_000;
const MAX_ERROR_RETRIES = 3;

export function useCaddyAgent({ folder, settings, onEntitiesChanged }: UseCaddyAgentOptions): UseCaddyAgentResult {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | undefined>(folder?.agentStatus);

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

  // Refs for the interval loop
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleMutex = useRef(false);  // Atomic-ish guard for concurrent cycles
  const agentStatusRef = useRef(agentStatus);
  const folderRef = useRef(folder);
  const settingsRef = useRef(settings);
  const mountedRef = useRef(true);
  const errorRetryCount = useRef(0);
  const cycleController = useRef<AbortController | null>(null);
  const supervisorController = useRef<AbortController | null>(null);
  const supervisorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ extensionAvailable, onEntitiesChanged });
  const cycleScope = useMemo(() => ({ folderId: folder?.id, enabled: folder?.agentEnabled }), [folder?.id, folder?.agentEnabled]);
  const activeCycleScope = useRef<typeof cycleScope | null>(null);

  // External loop callbacks may observe only committed props, never an abandoned render.
  useLayoutEffect(() => {
    folderRef.current = folder;
    settingsRef.current = settings;
    callbacks.current = { extensionAvailable, onEntitiesChanged };
  }, [folder, settings, extensionAvailable, onEntitiesChanged]);
  useLayoutEffect(() => {
    activeCycleScope.current = cycleScope;
    errorRetryCount.current = 0;
    return () => {
      activeCycleScope.current = null;
      cycleController.current?.abort();
    };
  }, [cycleScope]);

  // Track mount state
  useEffect(() => {
    mountedRef.current = true;
    const stop = () => {
      mountedRef.current = false;
      cycleController.current?.abort();
      supervisorController.current?.abort();
      if (intervalRef.current) clearTimeout(intervalRef.current);
      if (supervisorRef.current) clearTimeout(supervisorRef.current);
    };
    window.addEventListener('workspace-will-switch', stop);
    return () => {
      stop();
      window.removeEventListener('workspace-will-switch', stop);
    };
  }, []);

  const updateAgentStatus = useCallback((status: AgentStatus | undefined) => {
    setAgentStatus(status);
    agentStatusRef.current = status;
  }, []);

  // Sync agentStatus from folder prop
  useEffect(() => {
    updateAgentStatus(folder?.agentStatus);
  }, [folder?.id, folder?.agentStatus, updateAgentStatus]);

  const executeCycle = useCallback(async (requireEnabled = false) => {
    const currentFolder = folderRef.current;
    const scope = activeCycleScope.current;
    // Mutex guard — if already running, skip
    if (!currentFolder || !scope || !mountedRef.current || cycleMutex.current) return;
    cycleMutex.current = true;
    const controller = new AbortController();
    cycleController.current = controller;
    const current = () => mountedRef.current && activeCycleScope.current === scope && !controller.signal.aborted;

    if (mountedRef.current) {
      setRunning(true);
      setError(null);
    }

    try {
      // Re-read the folder to get latest state
      const freshFolder = await db.folders.get(currentFolder.id);
      if (!current() || !freshFolder || (requireEnabled && !freshFolder.agentEnabled)) {
        return;
      }

      // Check if multi-agent mode (deployments exist)
      const deploymentCount = await db.agentDeployments
        .where('investigationId')
        .equals(freshFolder.id)
        .count();
      if (!current()) return;

      if (deploymentCount > 0) {
        // Multi-agent mode
        const multiResult = await runMultiAgentCycle(freshFolder, settingsRef.current, callbacks.current.extensionAvailable, (agentName, status) => {
          if (current()) setProgress(`${agentName}: ${status}`);
        }, controller.signal);

        if (!current()) return;

        // Per-agent status: determine folder-level status from individual results
        const results = Array.from(multiResult.deploymentResults.values());
        const succeeded = results.filter(r => !r.error);
        const anyWaiting = results.some(r => r.proposed.length > 0);
        const allFailed = results.length > 0 && succeeded.length === 0;

        if (multiResult.errors.length > 0) {
          setError(multiResult.errors.join('; '));
        }

        if (allFailed) {
          updateAgentStatus('error');
        } else {
          errorRetryCount.current = 0;
          updateAgentStatus(anyWaiting ? 'waiting' : 'idle');
        }

        // Update working memory for each deployment that had activity
        for (const [, result] of multiResult.deploymentResults) {
          if (!current()) return;
          if ((result.autoExecuted.length > 0 || result.proposed.length > 0) && result.threadId) {
            await updateWorkingMemory(result.threadId, result.autoExecuted.length, result.proposed.length, controller.signal);
          }
        }
      } else {
        // Legacy single-agent mode
        setStreamingContent('');
        const result = await runAgentCycle(freshFolder, settingsRef.current, callbacks.current.extensionAvailable, (status) => {
          if (current()) setProgress(status);
        }, undefined, undefined, (text) => {
          if (current()) setStreamingContent(prev => prev + text);
        }, controller.signal);

        if (!current()) return;

        if (result.error) {
          setError(result.error);
          updateAgentStatus('error');
        } else {
          errorRetryCount.current = 0;
          if (result.proposed.length > 0) {
            updateAgentStatus('waiting');
          } else {
            updateAgentStatus('idle');
          }
        }

        if (result.autoExecuted.length > 0 || result.proposed.length > 0) {
          await updateWorkingMemory(result.threadId, result.autoExecuted.length, result.proposed.length, controller.signal);
        }
      }

      if (current()) callbacks.current.onEntitiesChanged?.();
    } catch (err) {
      if (current()) {
        setError(String((err as Error).message || err));
        updateAgentStatus('error');
      }
    } finally {
      cycleMutex.current = false;
      if (cycleController.current === controller) cycleController.current = null;
      if (mountedRef.current) {
        setRunning(false);
        setProgress('');
      }
    }
  }, [updateAgentStatus]);

  const runOnce = useCallback(async () => {
    await executeCycle();
  }, [executeCycle]);

  // Listen for run_agent_cycle tool calls from CaddyAI chat
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (activeCycleScope.current === cycleScope && detail?.folderId === folder?.id) {
        executeCycle().catch((err) => console.error('[AgentCaddy] chat-triggered cycle failed:', err));
      }
    };
    window.addEventListener('tc-run-agent-cycle', handler);
    return () => window.removeEventListener('tc-run-agent-cycle', handler);
  }, [folder?.id, executeCycle, cycleScope]);

  const toggleAgent = useCallback(async () => {
    if (!folder || activeCycleScope.current !== cycleScope) return;
    const newEnabled = !folder.agentEnabled;
    if (!newEnabled) cycleController.current?.abort();
    await db.folders.update(folder.id, {
      agentEnabled: newEnabled,
      agentStatus: newEnabled ? 'idle' : undefined,
    });
    if (activeCycleScope.current !== cycleScope) return;
    updateAgentStatus(newEnabled ? 'idle' : undefined);
    errorRetryCount.current = 0;
  }, [folder, updateAgentStatus, cycleScope]);

  // Auto-repeat loop: schedule next cycle after completion
  const intervalMinutes = folder?.agentPolicy?.intervalMinutes ?? DEFAULT_AGENT_POLICY.intervalMinutes;
  useEffect(() => {
    const { folderId, enabled } = cycleScope;
    if (!enabled || !folderId) {
      // Clear any pending timer when disabled
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let active = true;
    const current = () => active && mountedRef.current && activeCycleScope.current === cycleScope;
    const baseIntervalMs = (intervalMinutes || 5) * 60 * 1000;

    const scheduleNext = async () => {
      if (!current()) return;
      // Adaptive: double interval when waiting for approvals (use ref to avoid stale closure)
      const currentStatus = agentStatusRef.current;
      const multiplier = currentStatus === 'waiting' ? 2 : 1;
      let intervalMs = baseIntervalMs * multiplier;

      // Error backoff: double interval for each consecutive error, up to max retries
      if (currentStatus === 'error') {
        if (errorRetryCount.current >= MAX_ERROR_RETRIES) {
          return;
        }
        errorRetryCount.current++;
        intervalMs = ERROR_RETRY_BASE_MS * Math.pow(2, errorRetryCount.current - 1);
      }

      // Adaptive scheduling based on agent metrics (multi-agent mode)
      try {
        const deployments = await db.agentDeployments.where('investigationId').equals(folderId).toArray();
        if (!current()) return;
        if (deployments.length > 0) {
          const totalProposed = deployments.reduce((s, d) => s + (d.metrics?.toolCallsProposed || 0), 0);
          const totalExecuted = deployments.reduce((s, d) => s + (d.metrics?.toolCallsExecuted || 0), 0);
          const total = totalProposed + totalExecuted;
          if (total > 10) {
            const successRate = totalExecuted / total;
            if (successRate > 0.9) intervalMs = Math.max(60_000, intervalMs * 0.5); // boost
            else if (successRate < 0.5) intervalMs *= 2; // throttle
          }
        }
      } catch { /* non-critical */ }
      if (!current()) return;

      intervalRef.current = setTimeout(() => { void tick(); }, intervalMs);
    };

    const tick = async () => {
      if (!current()) return;
      try {
        // Re-check persisted enablement and pending approvals after each wait.
        const freshFolder = await db.folders.get(folderId);
        if (!current() || !freshFolder?.agentEnabled) return;
        const pendingCount = await db.agentActions.where('[investigationId+status]').equals([folderId, 'pending']).count();
        if (!current()) return;
        if (pendingCount === 0) await executeCycle(true);
      } catch (err) {
        if (current()) console.error('[AgentCaddy] cycle failed:', err);
      }
      if (current()) await scheduleNext();
    };

    // Run first cycle after a short delay (3s) to let UI settle.
    intervalRef.current = setTimeout(() => { void tick(); }, 3000);

    return () => {
      active = false;
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cycleScope, intervalMinutes, executeCycle]);

  // ── Supervisor loop (global, not per-investigation) ──────────────────

  const supervisorMutex = useRef(false);

  useEffect(() => {
    if (!settings.agentSupervisorEnabled) {
      if (supervisorRef.current) {
        clearTimeout(supervisorRef.current);
        supervisorRef.current = null;
      }
      return;
    }

    const intervalMs = (settings.agentSupervisorIntervalMinutes || 30) * 60 * 1000;
    let active = true;
    const current = () => active && mountedRef.current && settingsRef.current.agentSupervisorEnabled;

    const runSupervisor = async () => {
      if (!current() || supervisorMutex.current) return;
      supervisorMutex.current = true;
      const controller = new AbortController();
      supervisorController.current = controller;
      try {
        const result = await runSupervisorCycle(settingsRef.current, callbacks.current.extensionAvailable, undefined, controller.signal);
        if (!current() || controller.signal.aborted) return;
        // Fire desktop notifications for escalations
        for (const escalation of result.escalations) {
          sendEscalationNotification(escalation, controller.signal);
        }
      } catch (err) {
        if (current() && !controller.signal.aborted) console.error('Supervisor cycle error:', err);
      } finally {
        supervisorMutex.current = false;
        if (supervisorController.current === controller) supervisorController.current = null;
      }
    };

    const scheduleNext = () => {
      if (!current()) return;
      supervisorRef.current = setTimeout(async () => {
        if (!current()) return;
        await runSupervisor();
        scheduleNext();
      }, intervalMs);
    };

    // First run after 10s delay
    const initialTimer = setTimeout(() => {
      if (!current()) return;
      runSupervisor().then(scheduleNext).catch((err) => { console.error('[AgentCaddy] supervisor failed:', err); scheduleNext(); });
    }, 10000);

    return () => {
      active = false;
      supervisorController.current?.abort();
      clearTimeout(initialTimer);
      if (supervisorRef.current) {
        clearTimeout(supervisorRef.current);
        supervisorRef.current = null;
      }
    };
  }, [settings.agentSupervisorEnabled, settings.agentSupervisorIntervalMinutes]);

  return {
    running,
    progress,
    error,
    streamingContent,
    runOnce,
    toggleAgent,
    agentStatus,
  };
}

/**
 * Update the working memory on the agent's audit trail thread.
 * Stores a brief summary of the cycle's activity, capped to prevent unbounded growth.
 */
async function updateWorkingMemory(threadId: string, executed: number, proposed: number, signal: AbortSignal): Promise<void> {
  const now = new Date().toISOString();
  const summary = `[Cycle ${now}] Executed: ${executed} actions, Proposed: ${proposed} actions for review.`;

  try {
    await db.chatThreads.where('id').equals(threadId).modify((thread: { contextSummary?: string }) => {
      signal.throwIfAborted();
      const existing = thread.contextSummary || '';
      // Keep last 5 cycle summaries and cap total length
      const lines = existing.split('\n').filter(Boolean);
      lines.push(summary);
      let result = lines.slice(-5).join('\n');
      if (result.length > MAX_WORKING_MEMORY_CHARS) {
        result = result.slice(-MAX_WORKING_MEMORY_CHARS);
      }
      thread.contextSummary = result;
    });
  } catch (err) {
    if (!signal.aborted) console.error('Failed to update working memory:', err);
  }
}
