/**
 * CaddyAgent Manager — orchestrates multiple agent profiles running
 * in parallel within a single investigation.
 */

import { db } from '../db';
import type { AgentCycleOutcome, AgentDeployment, AgentMetrics, AgentProfile, Folder, Settings } from '../types';
import { runAgentCycle, type AgentCycleResult } from './caddy-agent';
import { BUILTIN_AGENT_PROFILES } from './builtin-agent-profiles';

export interface MultiAgentCycleResult {
  deploymentResults: Map<string, AgentCycleResult>;
  errors: string[];
}

/** Resolve a profile by ID from user DB or builtins. */
async function resolveProfile(profileId: string): Promise<AgentProfile | undefined> {
  const userProfile = await db.agentProfiles.get(profileId);
  if (userProfile) return userProfile;
  return BUILTIN_AGENT_PROFILES.find(p => p.id === profileId);
}

/**
 * Run a single cycle for all deployed agents in an investigation.
 * Agents run concurrently via Promise.allSettled.
 */
export async function runMultiAgentCycle(
  folder: Folder,
  settings: Settings,
  extensionAvailable: boolean,
  onProgress?: (agentName: string, status: string) => void,
): Promise<MultiAgentCycleResult> {
  // Load all active deployments
  const deployments = await db.agentDeployments
    .where('[investigationId+order]')
    .between([folder.id, -Infinity], [folder.id, Infinity])
    .toArray();

  const activeDeployments = deployments.filter(d => d.status !== 'paused' && d.shift !== 'resting');

  if (activeDeployments.length === 0) {
    return { deploymentResults: new Map(), errors: ['No active agent deployments'] };
  }

  // Resolve profiles for all deployments
  const deploymentProfiles: { deployment: AgentDeployment; profile: AgentProfile }[] = [];
  for (const d of activeDeployments) {
    const profile = await resolveProfile(d.profileId);
    if (profile) {
      deploymentProfiles.push({ deployment: d, profile });
    }
  }

  // Run agents with concurrency limit — use 1 for local LLMs (serial), 5 for cloud
  const isLocal = (settings.llmDefaultProvider === 'local') || (!settings.llmAnthropicApiKey && !settings.llmOpenAIApiKey && !settings.llmGeminiApiKey && !settings.llmMistralApiKey && settings.llmLocalEndpoint);
  const MAX_CONCURRENT = isLocal ? 1 : 5;
  const allResults: PromiseSettledResult<{ deploymentId: string; result: AgentCycleResult }>[] = [];

  for (let i = 0; i < deploymentProfiles.length; i += MAX_CONCURRENT) {
    const chunk = deploymentProfiles.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ deployment, profile }) => {
      // Mark running just before execution (not upfront) so failures revert cleanly
      await db.agentDeployments.update(deployment.id, { status: 'running' });

      let result: AgentCycleResult;
      try {
        result = await runAgentCycle(
          folder,
          settings,
          extensionAvailable,
          (status) => onProgress?.(profile.name, status),
          profile,
          deployment,
        );
      } catch (err) {
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

      // Merge cycle histograms into cumulative deployment histograms
      const mergeHist = (base: Record<string, number> | undefined, delta: Record<string, number> | undefined): Record<string, number> => {
        const out: Record<string, number> = { ...(base || {}) };
        if (delta) for (const [k, v] of Object.entries(delta)) out[k] = (out[k] || 0) + v;
        return out;
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
              input: prev.tokensUsed.input + summary.tokens.input,
              output: prev.tokensUsed.output + summary.tokens.output,
            }
          : prev.tokensUsed,
        lastCycleAt: Date.now(),
        costUSD: (prev.costUSD || 0) + (summary?.costUSD || 0),
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

  return { deploymentResults, errors };
}
