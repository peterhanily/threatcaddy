import { describe, expect, it, vi } from 'vitest';
import { assertBotRuntimeAvailable, botRuntimeAvailability, INTEGRATION_RUNTIME_UNAVAILABLE } from '../bots/runtime-availability.js';
import { IntegrationExecutor } from '../services/integration-executor.js';
import type { IntegrationTemplate, InstalledIntegration } from '../types/integration-types.js';

describe('server integration containment', () => {
  it('distinguishes stored enabled state from runtime availability without mutation', () => {
    const config = { type: 'integration', enabled: true, config: { retained: 'definition' } };
    expect(botRuntimeAvailability(config)).toEqual({ runtimeAvailable: false, unavailableReason: INTEGRATION_RUNTIME_UNAVAILABLE });
    expect(config).toEqual({ type: 'integration', enabled: true, config: { retained: 'definition' } });
    expect(() => assertBotRuntimeAvailable(config)).toThrow(INTEGRATION_RUNTIME_UNAVAILABLE);
  });
  it('keeps existing handoff restrictions and supported nonintegration types', () => {
    expect(botRuntimeAvailability({ type: 'monitor', config: {} })).toEqual({ runtimeAvailable: true });
    expect(botRuntimeAvailability({ type: 'ai-agent', sourceType: 'caddy-agent', config: {} }).runtimeAvailable).toBe(false);
  });
  it('rejects direct access to the archived server interpreter before any callback', async () => {
    const callbacks = { fetchFn: vi.fn(), onCreateEntity: vi.fn(), onNotify: vi.fn(), onLog: vi.fn() };
    await expect(new IntegrationExecutor().run({} as IntegrationTemplate, {} as InstalledIntegration, {}, callbacks)).rejects.toThrow(INTEGRATION_RUNTIME_UNAVAILABLE);
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });
});
