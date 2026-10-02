/** Phase 1 containment. Durable approvals and exact policy parity are not implemented. */
export const HANDOFF_UNAVAILABLE = 'Server-side AgentCaddy execution is unavailable until tool restrictions, read-only policies and durable approvals are enforced.';

export function hasUnsupportedAgentPolicy(bot: { sourceType?: unknown; config: Record<string, unknown> }): boolean {
  return bot.sourceType === 'caddy-agent'
    || ['agentPolicy', 'allowedTools', 'readOnlyEntityTypes', 'sourceProfileId'].some(key => Object.hasOwn(bot.config, key));
}

export function assertSupportedAgentPolicy(bot: { sourceType?: unknown; config: Record<string, unknown> }): void {
  if (hasUnsupportedAgentPolicy(bot)) throw new Error(HANDOFF_UNAVAILABLE);
}
