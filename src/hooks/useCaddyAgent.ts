/**
 * useCaddyAgent — React hook managing the auto-repeating agent loop.
 *
 * Lifecycle:
 * - When `agentEnabled` is true on the selected folder, starts an interval timer
 * - Each tick calls `runAgentCycle` (from caddy-agent.ts)
 * - Adaptive intervals: base interval from policy, doubles when agent proposes (waiting)
 * - Stops when disabled, folder changes, or component unmounts
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Folder, Settings, AgentStatus } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { db } from '../db';
import { runAgentCycle } from '../lib/caddy-agent';
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
  /** Manually trigger a single agent cycle */
  runOnce: () => Promise<void>;
  /** Toggle agent on/off for the current investigation */
  toggleAgent: () => Promise<void>;
  /** Current agent status */
  agentStatus: AgentStatus | undefined;
}

export function useCaddyAgent({ folder, settings, onEntitiesChanged }: UseCaddyAgentOptions): UseCaddyAgentResult {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
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
  const runningRef = useRef(false);
  const folderRef = useRef(folder);
  const settingsRef = useRef(settings);

  // Keep refs current
  folderRef.current = folder;
  settingsRef.current = settings;

  // Sync agentStatus from folder prop
  useEffect(() => {
    setAgentStatus(folder?.agentStatus);
  }, [folder?.agentStatus]);

  const executeCycle = useCallback(async () => {
    const currentFolder = folderRef.current;
    if (!currentFolder || runningRef.current) return;

    runningRef.current = true;
    setRunning(true);
    setError(null);

    try {
      // Re-read the folder to get latest state
      const freshFolder = await db.folders.get(currentFolder.id);
      if (!freshFolder) {
        runningRef.current = false;
        setRunning(false);
        return;
      }

      const result = await runAgentCycle(freshFolder, settingsRef.current, extensionAvailable, (status) => {
        setProgress(status);
      });

      if (result.error) {
        setError(result.error);
        setAgentStatus('error');
      } else if (result.proposed.length > 0) {
        setAgentStatus('waiting');
      } else {
        setAgentStatus('idle');
      }

      // Generate working memory summary if we had any activity
      if (result.autoExecuted.length > 0 || result.proposed.length > 0) {
        await updateWorkingMemory(result.threadId, result.autoExecuted.length, result.proposed.length);
      }

      onEntitiesChanged?.();
    } catch (err) {
      setError(String((err as Error).message || err));
      setAgentStatus('error');
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress('');
    }
  }, [extensionAvailable, onEntitiesChanged]);

  const runOnce = useCallback(async () => {
    await executeCycle();
  }, [executeCycle]);

  const toggleAgent = useCallback(async () => {
    if (!folder) return;
    const newEnabled = !folder.agentEnabled;
    await db.folders.update(folder.id, {
      agentEnabled: newEnabled,
      agentStatus: newEnabled ? 'idle' : undefined,
    });
    setAgentStatus(newEnabled ? 'idle' : undefined);
  }, [folder]);

  // Auto-repeat loop: schedule next cycle after completion
  useEffect(() => {
    if (!folder?.agentEnabled || !folder.id) {
      // Clear any pending timer when disabled
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const policy = folder.agentPolicy ?? DEFAULT_AGENT_POLICY;
    const baseIntervalMs = (policy.intervalMinutes || 5) * 60 * 1000;

    const scheduleNext = () => {
      // Adaptive: double interval when waiting for approvals
      const currentStatus = agentStatus;
      const multiplier = currentStatus === 'waiting' ? 2 : 1;
      const intervalMs = baseIntervalMs * multiplier;

      intervalRef.current = setTimeout(async () => {
        // Re-check that agent is still enabled
        const freshFolder = await db.folders.get(folder.id);
        if (!freshFolder?.agentEnabled) return;

        // Don't run if there are pending actions awaiting approval
        const pendingCount = await db.agentActions
          .where('[investigationId+status]')
          .equals([folder.id, 'pending'])
          .count();

        if (pendingCount > 0) {
          // Still waiting — schedule again with longer interval
          scheduleNext();
          return;
        }

        await executeCycle();
        scheduleNext();
      }, intervalMs);
    };

    // Run first cycle after a short delay (3s) to let UI settle
    const initialTimer = setTimeout(() => {
      executeCycle().then(scheduleNext);
    }, 3000);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // Only re-run when folder id or enabled state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id, folder?.agentEnabled]);

  return {
    running,
    progress,
    error,
    runOnce,
    toggleAgent,
    agentStatus,
  };
}

/**
 * Update the working memory on the agent's audit trail thread.
 * Stores a brief summary of the cycle's activity.
 */
async function updateWorkingMemory(threadId: string, executed: number, proposed: number): Promise<void> {
  const now = new Date().toISOString();
  const summary = `[Cycle ${now}] Executed: ${executed} actions, Proposed: ${proposed} actions for review.`;

  await db.chatThreads.where('id').equals(threadId).modify((thread: { contextSummary?: string }) => {
    const existing = thread.contextSummary || '';
    // Keep last 5 cycle summaries to avoid unbounded growth
    const lines = existing.split('\n').filter(Boolean);
    lines.push(summary);
    thread.contextSummary = lines.slice(-5).join('\n');
  });
}
