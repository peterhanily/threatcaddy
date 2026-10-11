import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], execute: vi.fn(), update: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {
  select: () => {
    const query = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
      then: (resolve: (rows: Record<string, unknown>[]) => unknown) => Promise.resolve(state.rows).then(resolve),
    };
    return query;
  }, update: state.update,
} }));
vi.mock('../bots/bot-manager.js', () => ({ botManager: { executeBot: state.execute }, validateCronExpression: () => null }));
vi.mock('../bots/secret-store.js', () => ({ encryptConfigSecrets: (value: unknown) => value, redactConfigSecrets: () => ({ apiKey: '***configured***' }) }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn() }));
import { getBot, getBotDetail, listBots, listBotsWithCreator, triggerBot, validateBotCreate, validateBotUpdate } from '../services/bot-service.js';
import { INTEGRATION_RUNTIME_UNAVAILABLE } from '../bots/runtime-availability.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [{ id: 'legacy', name: 'Retained integration', type: 'integration', enabled: true, config: { apiKey: 'fictional-not-a-real-secret' } }];
});
describe('bot availability projections', () => {
  it('reports unavailable without hiding stored enabled state or rewriting records', async () => {
    const expected = { id: 'legacy', enabled: true, runtimeAvailable: false, unavailableReason: INTEGRATION_RUNTIME_UNAVAILABLE, config: { apiKey: '***configured***' } };
    expect(await getBot('legacy')).toMatchObject(expected);
    expect((await listBots())[0]).toMatchObject(expected);
    expect((await listBotsWithCreator())[0]).toMatchObject(expected);
    expect((await getBotDetail('legacy'))?.bot).toMatchObject(expected);
    expect(state.update).not.toHaveBeenCalled();
  });
  it('rejects manual activation without a fabricated successful run', async () => {
    expect(await triggerBot('legacy')).toEqual({ error: INTEGRATION_RUNTIME_UNAVAILABLE });
    expect(state.execute).not.toHaveBeenCalled();
    expect(validateBotCreate({ name: 'New', type: 'integration' })).toBe(INTEGRATION_RUNTIME_UNAVAILABLE);
    expect(validateBotUpdate({ type: 'integration' })).toEqual({ error: INTEGRATION_RUNTIME_UNAVAILABLE });
  });
});
