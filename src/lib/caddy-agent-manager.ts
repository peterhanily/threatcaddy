/**
 * CaddyAgent Manager — orchestrates multiple agent profiles running
 * in parallel within a single investigation.
 */

import { db } from '../db';
import type { AgentDeployment, AgentMetrics, AgentProfile, Folder, Settings } from '../types';
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

  const activeDeployments = deployments.filter(d => d.status !== 'paused');

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

  // Mark all as running
  for (const { deployment } of deploymentProfiles) {
    await db.agentDeployments.update(deployment.id, { status: 'running' });
  }

  // Run agents with concurrency limit (max 5 parallel to avoid overwhelming LLM providers)
  const MAX_CONCURRENT = 5;
  const allResults: PromiseSettledResult<{ deploymentId: string; result: AgentCycleResult }>[] = [];

  for (let i = 0; i < deploymentProfiles.length; i += MAX_CONCURRENT) {
    const chunk = deploymentProfiles.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ deployment, profile }) => {
      const result = await runAgentCycle(
        folder,
        settings,
        extensionAvailable,
        (status) => onProgress?.(profile.name, status),
        profile,
        deployment,
      );

      // Update deployment status + metrics
      const newStatus = result.error ? 'error'
        : result.proposed.length > 0 ? 'waiting'
        : 'idle';
      const prev = deployment.metrics || { cyclesRun: 0, toolCallsExecuted: 0, toolCallsProposed: 0, tasksCompleted: 0, tasksRejected: 0, tokensUsed: { input: 0, output: 0 }, lastCycleAt: 0 };
      const metrics: AgentMetrics = {
        cyclesRun: prev.cyclesRun + 1,
        toolCallsExecuted: prev.toolCallsExecuted + result.autoExecuted.length,
        toolCallsProposed: prev.toolCallsProposed + result.proposed.length,
        tasksCompleted: prev.tasksCompleted,
        tasksRejected: prev.tasksRejected,
        tokensUsed: prev.tokensUsed, // TODO: add token tracking from LLM response
        lastCycleAt: Date.now(),
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

  // Collect results
  const deploymentResults = new Map<string, AgentCycleResult>();
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      deploymentResults.set(r.value.deploymentId, r.value.result);
      if (r.value.result.error) {
        errors.push(r.value.result.error);
      }
    } else {
      errors.push(String(r.reason));
    }
  }

  return { deploymentResults, errors };
}
