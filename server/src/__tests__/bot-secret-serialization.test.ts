import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ results: [] as unknown[][], updates: [] as Record<string, unknown>[], reload: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: {
  select: () => {
    const rows = mocks.results.shift() ?? [];
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, leftJoin: () => chain, limit: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return chain;
  },
  update: () => ({ set: (updates: Record<string, unknown>) => { mocks.updates.push(updates); return { where: () => ({ returning: async () => [{ id: 'bot-a', ...updates }] }) }; } }),
} }));
vi.mock('../bots/bot-manager.js', () => ({ botManager: { reloadBot: mocks.reload }, validateCronExpression: vi.fn() }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn() }));
import { getBot, getBotDetail, listBots, listBotsWithCreator, mergeSentinelSecrets, updateBot, enableBot, triggerBot } from '../services/bot-service.js';
import { decryptConfigSecrets } from '../bots/secret-store.js';

const config = { hosts: [{ hostname: 'host.example.invalid', privateKey: 'synthetic-stored-pem', passphrase: 'synthetic-stored-passphrase' }], token: 'synthetic-stored-token' };
const row = { id: 'bot-a', name: 'Synthetic bot', sourceType: 'manual', config };
beforeEach(() => { vi.clearAllMocks(); mocks.results.length = 0; mocks.updates.length = 0; process.env.BOT_MASTER_KEY = 'd'.repeat(64); });

describe('bot configuration response boundaries', () => {
  it.each([
    ['analyst list', () => listBots()], ['administrator list', () => listBotsWithCreator()],
    ['analyst detail', () => getBot('bot-a')], ['administrator detail', () => getBotDetail('bot-a')],
  ] as const)('redacts every supported credential in %s serialization', async (_name, read) => {
    mocks.results.push([row], [], []);
    const serialized = JSON.stringify(await read());
    expect(serialized).not.toContain('synthetic-stored');
    expect(serialized).toContain('***configured***');
    expect(serialized).toContain('host.example.invalid');
  });

  it('preserves nested array sentinels while encrypting previously missed stored plaintext during update', async () => {
    mocks.results.push([row]);
    const redactedConfig = { hosts: [{ hostname: 'host.example.invalid', privateKey: '***configured***', passphrase: '***configured***' }], token: '***configured***' };
    expect(mergeSentinelSecrets(redactedConfig, config)).toEqual(config);
    await updateBot('bot-a', { config: redactedConfig });
    expect(JSON.stringify(mocks.updates[0].config)).not.toContain('synthetic-stored');
    expect(decryptConfigSecrets(mocks.updates[0].config as Record<string, unknown>)).toEqual(config);
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('binds retained array credentials to connection identity after reordering and rejects changed targets', () => {
    const existing = { hosts: [{ host: 'first.example.invalid', privateKey: 'first-synthetic-key' }, { host: 'second.example.invalid', privateKey: 'second-synthetic-key' }] };
    const reordered = { hosts: [{ host: 'second.example.invalid', privateKey: '***configured***' }, { host: 'first.example.invalid', privateKey: '***configured***' }] };
    expect(mergeSentinelSecrets(reordered, existing)).toEqual({ hosts: [...existing.hosts].reverse() });
    expect(() => mergeSentinelSecrets({ hosts: [{ host: 'changed.example.invalid', privateKey: '***configured***' }] }, existing)).toThrow('Re-enter its credentials');
  });

  it('returns a truthful unavailable result when enabling or manually triggering restricted handoff', async () => {
    mocks.results.push([{ ...row, sourceType: 'caddy-agent', enabled: true }]);
    expect(await enableBot('bot-a')).toHaveProperty('error');
    mocks.results.push([{ ...row, sourceType: 'caddy-agent', enabled: true }]);
    expect(await triggerBot('bot-a')).toHaveProperty('error');
    expect(mocks.updates).toEqual([]);
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});
