/**
 * CaddyAgent Manager — orchestrates multiple agent profiles running
 * in parallel within a single investigation.
 */

import { db } from '../db';
import type { AgentCycleOutcome, AgentDeployment, AgentMetrics, AgentProfile, Folder, Settings } from '../types';
import { runAgentCycle, type AgentCycleResult } from './caddy-agent';
import { listAgentProfiles } from './agent-profile-resolver';
import { shouldBlockNewCycle } from './agent-handoff';
import { cancellableRequest } from './request-cancellation';
import { tokenCount } from './model-pricing';

export interface MultiAgentCycleResult {
  deploymentResults: Map<string, AgentCycleResult>;
  errors: string[];
  /** Profiles with a proposal awaiting review. A timed cycle skips them; a manual one runs them too. */
  waitingForReview: string[];
}

/**
 * Run a single cycle for all deployed agents in an investigation.
 * Agents run concurrently via Promise.allSettled. `manual` is a person's run
 * (Run, or an approved chat run_agent_cycle).
 */
export async function runMultiAgentCycle(
  folder: Folder,
  settings: Settings,
  extensionAvailable: boolean,
  onProgress?: (agentName: string, status: string) => void,
  signal?: AbortSignal,
  options: { manual?: boolean } = {},
): Promise<MultiAgentCycleResult> {
  const lifecycle = cancellableRequest(signal);
  try {
    return await runMultiAgentCycleInner(folder, settings, extensionAvailable, onProgress, lifecycle.signal, options.manual === true);
  } finally {
    lifecycle.dispose();
  }
}

async function runMultiAgentCycleInner(
  folder: Folder,
  settings: Settings,
  extensionAvailable: boolean,
  onProgress: ((agentName: string, status: string) => void) | undefined,
  signal: AbortSignal,
  manual: boolean,
): Promise<MultiAgentCycleResult> {
  signal.throwIfAborted();
  // Load all active deployments
  const deployments = await db.agentDeployments
    .where('[investigationId+order]')
    .between([folder.id, -Infinity], [folder.id, Infinity])
    .toArray();
  signal.throwIfAborted();

  // Only the agent whose proposal awaits review pauses. Legacy rows (no
  // profile) and supervisor rows match no deployment, so they pause none.
  const awaitingReview = new Set((await db.agentActions
    .where('[investigationId+status]').equals([folder.id, 'pending'])
    .toArray()).map(action => action.agentConfigId));
  signal.throwIfAborted();

  // Skip deployments the server owns or that haven't finished reconciling after
  // a handoff — starting a cycle on those would race against the server or act
  // on stale local state.
  const runnable = deployments.filter(
    d => d.status !== 'paused' && d.shift !== 'resting' && !shouldBlockNewCycle(d),
  );
  const waitingForReview = [...new Set(runnable.filter(d => awaitingReview.has(d.profileId)).map(d => d.profileId))];
  // A manual run runs waiting agents too, as 2.0.2 did. queueAgentAction answers
  // a repeat of a pending proposal with the pending row instead of a second one.
  const activeDeployments = manual ? runnable : runnable.filter(d => !awaitingReview.has(d.profileId));

  if (activeDeployments.length === 0) {
    if (waitingForReview.length > 0) {
      await db.folders.update(folder.id, { agentStatus: 'waiting' });
      return { deploymentResults: new Map(), errors: [], waitingForReview };
    }
    return { deploymentResults: new Map(), errors: ['No active agent deployments'], waitingForReview };
  }

  // Resolve profiles for all deployments. Builtins come from code; a stored
  // builtin row contributes only its soul.
  const profiles = new Map((await listAgentProfiles()).map(profile => [profile.id, profile]));
  signal.throwIfAborted();
  const deploymentProfiles: { deployment: AgentDeployment; profile: AgentProfile }[] = [];
  for (const d of activeDeployments) {
    const profile = profiles.get(d.profileId);
    if (profile) {
      deploymentProfiles.push({ deployment: d, profile });
    }
  }

  // Run agents with concurrency limit — use 1 for local LLMs (serial), 5 for cloud
  const isLocal = (settings.llmDefaultProvider === 'local') || (!settings.llmAnthropicApiKey && !settings.llmOpenAIApiKey && !settings.llmGeminiApiKey && !settings.llmMistralApiKey && settings.llmLocalEndpoint);
  const MAX_CONCURRENT = isLocal ? 1 : 5;
  const allResults: PromiseSettledResult<{ deploymentId: string; result: AgentCycleResult }>[] = [];

  for (let i = 0; i < deploymentProfiles.length; i += MAX_CONCURRENT) {
    signal.throwIfAborted();
    const chunk = deploymentProfiles.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ deployment, profile }) => {
      signal.throwIfAborted();
      // Mark running just before execution (not upfront) so failures revert cleanly
      await db.agentDeployments.update(deployment.id, { status: 'running' });

      let result: AgentCycleResult;
      try {
        signal.throwIfAborted();
        result = await runAgentCycle(
          folder,
          settings,
          extensionAvailable,
          (status) => { if (!signal.aborted) onProgress?.(profile.name, status); },
          profile,
          deployment,
          undefined,
          signal,
        );
        signal.throwIfAborted();
      } catch (err) {
        if (signal.aborted) {
          // Settle this attempt without overwriting a pause applied while the
          // provider was stopping. No metrics or later deployment is advanced.
          await db.agentDeployments.where('id').equals(deployment.id).modify(current => {
            if (current.status === 'running' && current.updatedAt === deployment.updatedAt
              && current.lastRunAt === deployment.lastRunAt && !shouldBlockNewCycle(current)) current.status = 'idle';
          });
          throw err;
        }
        // Revert to error status on unexpected crash
        await db.agentDeployments.update(deployment.id, { status: 'error', lastRunAt: Date.now() });
        throw err;
      }

      // Update deployment status + metrics
      const newStatus = result.error ? 'error'
        : result.proposed.length > 0 ? 'waiting'
        : 'idle';
      const prev = deployment.metrics || {
        cyclesRun: 0, toolCallsExecuted: 0, toolCallsProposed: 0,
        tasksCompleted: 0, tasksRejected: 0,
        tokensUsed: { input: 0, output: 0 }, lastCycleAt: 0,
      };
      const summary = result.summary;

      // Merge cycle histograms into cumulative deployment histograms.
      // Defensive cap: dynamic host:*/local:* skill names can proliferate when a
      // user reconfigures skills; keep at most HIST_MAX_KEYS, dropping
      // lowest-count keys when over the cap.
      const HIST_MAX_KEYS = 100;
      const mergeHist = (base: Record<string, number> | undefined, delta: Record<string, number> | undefined): Record<string, number> => {
        const out: Record<string, number> = { ...(base || {}) };
        if (delta) for (const [k, v] of Object.entries(delta)) out[k] = (out[k] || 0) + v;
        const keys = Object.keys(out);
        if (keys.length <= HIST_MAX_KEYS) return out;
        const sorted = keys.sort((a, b) => out[b] - out[a]).slice(0, HIST_MAX_KEYS);
        const trimmed: Record<string, number> = {};
        for (const k of sorted) trimmed[k] = out[k];
        return trimmed;
      };

      const prevByOutcome: Record<AgentCycleOutcome, number> = {
        success: 0, timeout: 0, error: 0, policyDenied: 0,
        ...(prev.cyclesByOutcome || {}),
      };
      if (summary) {
        prevByOutcome[summary.outcome] = (prevByOutcome[summary.outcome] || 0) + 1;
      }

      const metrics: AgentMetrics = {
        cyclesRun: prev.cyclesRun + 1,
        toolCallsExecuted: prev.toolCallsExecuted + result.autoExecuted.length,
        toolCallsProposed: prev.toolCallsProposed + result.proposed.length,
        tasksCompleted: prev.tasksCompleted,
        tasksRejected: prev.tasksRejected,
        tokensUsed: summary
          ? {
              input: tokenCount(prev.tokensUsed.input) + tokenCount(summary.tokens.input),
              output: tokenCount(prev.tokensUsed.output) + tokenCount(summary.tokens.output),
            }
          : prev.tokensUsed,
        lastCycleAt: Date.now(),
        costUSD: tokenCount(prev.costUSD) + tokenCount(summary?.costUSD),
        toolCallHistogram: mergeHist(prev.toolCallHistogram, summary?.toolHistogram),
        errorHistogram: mergeHist(prev.errorHistogram, summary?.errorHistogram),
        cyclesByOutcome: prevByOutcome,
        tasksEscalated: (prev.tasksEscalated || 0) + (summary?.tasksEscalated || 0),
      };
      await db.agentDeployments.update(deployment.id, {
        status: newStatus,
        lastRunAt: Date.now(),
        metrics,
      });

      return { deploymentId: deployment.id, result };
    })
    );
    allResults.push(...chunkResults);
    signal.throwIfAborted();
  }

  const results = allResults;

  // Collect results — include agent name in errors for visibility
  const deploymentResults = new Map<string, AgentCycleResult>();
  const errors: string[] = [];
  const profileNames = new Map(deploymentProfiles.map(({ deployment, profile }) => [deployment.id, profile.name]));

  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    if (r.status === 'fulfilled') {
      deploymentResults.set(r.value.deploymentId, r.value.result);
      if (r.value.result.error) {
        const name = profileNames.get(r.value.deploymentId) || 'Unknown';
        errors.push(`[${name}] ${r.value.result.error}`);
      }
    } else {
      const deploymentId = deploymentProfiles[idx]?.deployment.id;
      const name = deploymentId ? profileNames.get(deploymentId) || 'Unknown' : 'Unknown';
      errors.push(`[${name}] ${String(r.reason)}`);
    }
  }

  // Each run wrote its own status, so the last one to finish could leave the
  // investigation idle while a proposal waits. Use the hook's rule instead.
  const ran = [...deploymentResults.values()];
  const allFailed = ran.length > 0 && ran.every(result => result.error);
  if (!allFailed && (waitingForReview.length > 0 || ran.some(result => result.proposed.length > 0))) {
    await db.folders.update(folder.id, { agentStatus: 'waiting' });
  }

  return { deploymentResults, errors, waitingForReview };
}
