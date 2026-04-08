/**
 * CaddyAgent Bridge — converts client-side AgentProfile + AgentDeployment
 * into a server-side BotConfig for the BotManager to execute.
 */

import type { BotCapability, BotConfig, BotTriggerConfig } from './types';
import { nanoid } from 'nanoid';

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

// ── Tool → Capability mapping ───────────────────────────────────

const TOOL_CAPABILITY_MAP: Record<string, BotCapability> = {
  // Read tools
  search_notes: 'read_entities', search_all: 'read_entities', read_note: 'read_entities',
  read_task: 'read_entities', read_ioc: 'read_entities', read_timeline_event: 'read_entities',
  list_tasks: 'read_entities', list_iocs: 'read_entities', list_timeline_events: 'read_entities',
  get_investigation_summary: 'read_entities', analyze_graph: 'read_entities',
  // Create tools
  create_note: 'create_entities', create_task: 'create_entities', create_ioc: 'create_entities',
  bulk_create_iocs: 'create_entities', create_timeline_event: 'create_entities',
  generate_report: 'create_entities', create_in_investigation: 'create_entities', link_entities: 'create_entities',
  // Update tools
  update_note: 'update_entities', update_task: 'update_entities', update_ioc: 'update_entities',
  update_timeline_event: 'update_entities',
  // External
  fetch_url: 'call_external_apis', enrich_ioc: 'call_external_apis', extract_iocs: 'read_entities',
  // Cross-investigation
  list_investigations: 'cross_investigation', get_investigation_details: 'cross_investigation',
  search_across_investigations: 'cross_investigation', compare_investigations: 'cross_investigation',
  // Delegation
  delegate_task: 'create_entities', review_completed_task: 'update_entities',
  list_agent_activity: 'read_entities', list_integrations: 'read_entities',
};

/** Derive the minimal set of BotCapabilities from a list of allowed tools. */
function deriveCapabilities(allowedTools?: string[]): BotCapability[] {
  if (!allowedTools || allowedTools.length === 0) {
    // All tools → all standard capabilities
    return ['read_entities', 'create_entities', 'update_entities', 'call_external_apis', 'cross_investigation'];
  }
  const caps = new Set<BotCapability>();
  for (const tool of allowedTools) {
    const cap = TOOL_CAPABILITY_MAP[tool];
    if (cap) caps.add(cap);
  }
  return Array.from(caps);
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

  const capabilities = deriveCapabilities(profile.allowedTools);

  const config: Record<string, unknown> = {
    systemPrompt: profile.systemPrompt.substring(0, 10_000),
    agentRole: profile.role,
    agentPolicy: mergedPolicy,
    allowedTools: profile.allowedTools,
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
      enabled: false, // Start disabled — HeartbeatManager enables when client goes away
      triggers,
      config,
      capabilities,
      allowedDomains: [], // No domain restriction for agent bots
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
