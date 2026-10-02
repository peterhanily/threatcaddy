/**
 * CaddyAgent Bridge — converts client-side AgentProfile + AgentDeployment
 * into disabled server-side metadata. This is not an execution transport.
 */

import type { BotConfig, BotTriggerConfig } from './types';
import { nanoid } from 'nanoid';
import { HANDOFF_UNAVAILABLE } from './handoff-policy.js';

// ── Client types (subset needed for conversion) ─────────────────

interface AgentProfileInput {
  id: string;
  name: string;
  description?: string;
  role: 'executive' | 'lead' | 'specialist' | 'observer';
  systemPrompt: string;
  allowedTools?: string[];
  readOnlyEntityTypes?: string[];
  policy: {
    autoApproveReads: boolean;
    autoApproveEnrich: boolean;
    autoApproveFetch: boolean;
    autoApproveCreate: boolean;
    autoApproveModify: boolean;
    intervalMinutes: number;
    model?: string;
  };
  model?: string;
}

interface AgentDeploymentInput {
  id: string;
  investigationId: string;
  profileId: string;
  policyOverrides?: Partial<AgentProfileInput['policy']>;
  order: number;
}

/** Convert intervalMinutes to a cron expression. */
function intervalToCron(minutes: number): string {
  if (minutes <= 0) minutes = 5;
  if (minutes >= 60) return `0 */${Math.round(minutes / 60)} * * *`;
  return `*/${minutes} * * * *`;
}

// ── Main Conversion ─────────────────────────────────────────────

export interface ConvertedBotConfig {
  /** Partial BotConfig to insert into bot_configs table */
  botConfig: Omit<BotConfig, 'userId' | 'lastRunAt' | 'lastError' | 'runCount' | 'errorCount' | 'createdAt' | 'updatedAt'> & {
    sourceType: 'caddy-agent';
    sourceDeploymentId: string;
  };
}

/**
 * Convert an AgentProfile + AgentDeployment into a server BotConfig.
 */
export function convertProfileToBotConfig(
  profile: AgentProfileInput,
  deployment: AgentDeploymentInput,
): ConvertedBotConfig {
  const mergedPolicy = { ...profile.policy, ...deployment.policyOverrides };

  const triggers: BotTriggerConfig = {
    schedule: intervalToCron(mergedPolicy.intervalMinutes || 5),
    // Also trigger on entity changes in this investigation
    events: ['entity.created', 'entity.updated'],
    eventFilters: {
      folderIds: [deployment.investigationId],
    },
  };

  const capabilities: BotConfig['capabilities'] = [];

  const config: Record<string, unknown> = {
    systemPrompt: profile.systemPrompt.substring(0, 10_000),
    agentRole: profile.role,
    agentPolicy: mergedPolicy,
    allowedTools: profile.allowedTools ?? [],
    handoffDisabledReason: HANDOFF_UNAVAILABLE,
    readOnlyEntityTypes: profile.readOnlyEntityTypes,
    llmModel: profile.model || mergedPolicy.model,
    maxIterations: 6,
    // Store the profile ID for reference
    sourceProfileId: profile.id,
  };

  return {
    botConfig: {
      id: nanoid(),
      type: 'ai-agent',
      name: `AgentCaddy: ${profile.name}`,
      description: profile.description || `Server-side agent from profile: ${profile.name}`,
      enabled: false, // Execution is intentionally unavailable; heartbeat cannot enable it.
      triggers,
      config,
      capabilities,
      allowedDomains: [], // Deny outbound access by default
      scopeType: 'investigation',
      scopeFolderIds: [deployment.investigationId],
      rateLimitPerHour: 30,
      rateLimitPerDay: 200,
      createdBy: '',  // Filled by the route handler
      sourceType: 'caddy-agent',
      sourceDeploymentId: deployment.id,
    },
  };
}
