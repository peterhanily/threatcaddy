import { HANDOFF_UNAVAILABLE, hasUnsupportedAgentPolicy } from './handoff-policy.js';

export const INTEGRATION_RUNTIME_UNAVAILABLE = 'Server-side declarative integration execution is unavailable. Saved definitions and run history are retained; supported integrations can be run manually in the client.';

type RuntimeConfig = { type?: unknown; sourceType?: unknown; config: Record<string, unknown> };

/** Availability is independent of stored enabled state; never activate a legacy runner. */
export function getBotRuntimeUnavailableReason(config: RuntimeConfig): string | undefined {
  if (config.type === 'integration') return INTEGRATION_RUNTIME_UNAVAILABLE;
  if (hasUnsupportedAgentPolicy(config)) return HANDOFF_UNAVAILABLE;
  return undefined;
}

export function assertBotRuntimeAvailable(config: RuntimeConfig): void {
  const reason = getBotRuntimeUnavailableReason(config);
  if (reason) throw new Error(reason);
}

export function botRuntimeAvailability(config: RuntimeConfig) {
  const unavailableReason = getBotRuntimeUnavailableReason(config);
  return { runtimeAvailable: !unavailableReason, ...(unavailableReason ? { unavailableReason } : {}) };
}
