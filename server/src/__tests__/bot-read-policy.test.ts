import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotContext } from '../bots/types.js';

const state = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: { transaction: state.transaction } }));
import { withBotReadPolicy } from '../services/bot-read-policy.js';

describe('bot read transaction result ownership', () => {
  beforeEach(() => { state.transaction.mockReset(); });
  it('discards results if cancellation arrives during read-only transaction completion', async () => {
    const controller = new AbortController();
    const context: BotContext = { signal: controller.signal, botUserId: 'reader', runId: 'fixture-run', trigger: 'manual',
      entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [], botConfig: {
        id: 'fixture', userId: 'reader', name: 'Fictional reader', description: '', type: 'enrichment', enabled: true,
        capabilities: ['read_entities'], scopeType: 'global', scopeFolderIds: [], triggers: {}, config: {}, allowedDomains: [],
        rateLimitPerHour: 10, rateLimitPerDay: 100, lastRunAt: null, lastError: null, runCount: 0, errorCount: 0,
        createdBy: 'owner', createdAt: new Date(), updatedAt: new Date(),
      } };
    const rows = [[{ active: true }], [{ userId: 'reader', enabled: true, capabilities: ['read_entities'], scopeType: 'global' }]];
    const tx = { execute: async () => [{ id: 1 }], select: () => ({ from: () => ({ where: () => ({ for: async () => rows.shift() }) }) }) };
    let release: (() => void) | undefined;
    const completion = new Promise<void>(resolve => { release = resolve; });
    const callbackFinished = vi.fn();
    state.transaction.mockImplementation(async callback => {
      const result = await callback(tx);
      callbackFinished();
      await completion;
      return result;
    });
    const pending = withBotReadPolicy(context, 'read_entities', async () => ['Fictional result']);
    await vi.waitFor(() => expect(callbackFinished).toHaveBeenCalledOnce());
    controller.abort(); release?.();
    await expect(pending).rejects.toThrow(/abort/i);
  });
});
