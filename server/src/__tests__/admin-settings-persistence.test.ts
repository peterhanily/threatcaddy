import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: new Map<string, string>(), reads: [] as Array<Array<{ key: string; value: string }>>,
  failKey: '', transactions: 0,
}));
vi.mock('../db/index.js', () => ({ db: {
  select: () => ({ from: () => ({ where: async () => state.reads.shift() ?? [] }) }),
  transaction: async (work: (tx: unknown) => Promise<void>) => {
    state.transactions++;
    const pending = new Map(state.rows);
    await work({ insert: () => ({ values: ({ key, value }: { key: string; value: string }) => ({
      onConflictDoUpdate: async () => {
        if (key === state.failKey) throw new Error('Synthetic storage failure');
        pending.set(key, value);
      },
    }) }) });
    state.rows = pending;
  },
} }));
vi.mock('../services/admin-session-service.js', () => ({ revokeAdminSessions: vi.fn() }));
import { getAiSettings, setAiSettings, setAdminSettings, validateAdminSettings } from '../services/admin-secret.js';
import { decryptSecret, encryptSecret } from '../bots/secret-store.js';

function queueAiRead() {
  state.reads.push(Array.from(state.rows, ([key, value]) => ({ key, value })));
}
beforeEach(() => {
  state.rows = new Map(); state.reads = []; state.failKey = ''; state.transactions = 0;
  vi.stubEnv('BOT_MASTER_KEY', 'e'.repeat(64));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('atomic admin configuration and local credentials', () => {
  it('encrypts explicitly saved local keys and returns the decrypted value only internally', async () => {
    await setAiSettings({ localEndpoint: 'https://local.example.invalid', localApiKey: 'synthetic-local-credential' });
    const stored = state.rows.get('ai_local_api_key');
    expect(stored).toMatch(/^enc2:/);
    expect(stored).not.toContain('synthetic-local-credential');
    expect(decryptSecret(stored ?? '')).toBe('synthetic-local-credential');
    queueAiRead();
    expect(await getAiSettings()).toMatchObject({ localApiKey: 'synthetic-local-credential' });
    expect(state.transactions).toBe(1);
  });

  it('reads legacy plaintext without rewriting it, and encrypts an explicit replacement', async () => {
    state.rows.set('ai_local_api_key', 'synthetic-legacy-key');
    queueAiRead();
    expect(await getAiSettings()).toMatchObject({ localApiKey: 'synthetic-legacy-key' });
    expect(state.transactions).toBe(0);
    await setAiSettings({ temperature: 0.5 });
    expect(state.rows.get('ai_local_api_key')).toBe('synthetic-legacy-key');
    await setAiSettings({ localApiKey: 'synthetic-legacy-key' });
    expect(state.rows.get('ai_local_api_key')).toMatch(/^enc2:/);
  });

  it('fails closed on malformed or authentication-failed encrypted values', async () => {
    const valid = encryptSecret('synthetic-ciphertext-fixture');
    const parts = valid.split(':');
    parts[3] = Buffer.alloc(16).toString('base64');
    for (const ciphertext of ['enc:incomplete', 'enc2:incomplete', parts.join(':')]) {
      state.rows.set('ai_local_api_key', ciphertext);
      queueAiRead();
      await expect(getAiSettings()).rejects.toThrow();
    }
    expect(state.transactions).toBe(0);
  });

  it('allows explicit clearing without storing empty encrypted credentials', async () => {
    state.rows.set('ai_local_api_key', encryptSecret('synthetic-old-key'));
    await setAiSettings({ localApiKey: '' });
    expect(state.rows.get('ai_local_api_key')).toBe('');
  });

  it('does not persist other changes when credential encryption cannot start', async () => {
    vi.stubEnv('BOT_MASTER_KEY', '');
    await expect(setAiSettings({ localEndpoint: 'https://local.example.invalid', localApiKey: 'synthetic-key' }))
      .rejects.toThrow('BOT_MASTER_KEY');
    expect(state.transactions).toBe(0);
    expect(state.rows.size).toBe(0);
  });

  it('rolls back all AI fields if a later write fails', async () => {
    state.rows.set('ai_local_endpoint', 'https://previous.example.invalid');
    state.failKey = 'ai_local_api_key';
    await expect(setAiSettings({ localEndpoint: 'https://next.example.invalid', localApiKey: 'synthetic-key' }))
      .rejects.toThrow('Synthetic storage failure');
    expect(state.transactions).toBe(1);
    expect([...state.rows]).toEqual([['ai_local_endpoint', 'https://previous.example.invalid']]);
  });

  it('stores a fully validated general patch in one transaction, preserving omitted fields', async () => {
    state.rows.set('max_sessions_per_user', '5');
    await setAdminSettings({ serverName: ' Ordinary server ', registrationMode: 'invite', ttlHours: 48 });
    expect(Object.fromEntries(state.rows)).toEqual({
      server_name: 'Ordinary server', registration_mode: 'invite', session_ttl_hours: '48', max_sessions_per_user: '5',
    });
    expect(state.transactions).toBe(1);
  });

  it('rolls back all general settings when a later update fails', async () => {
    state.rows.set('server_name', 'Previous server');
    state.failKey = 'registration_mode';
    await expect(setAdminSettings({ serverName: 'Next server', registrationMode: 'open' }))
      .rejects.toThrow('Synthetic storage failure');
    expect([...state.rows]).toEqual([['server_name', 'Previous server']]);
    expect(state.transactions).toBe(1);
  });

  it.each([NaN, Infinity, -1, 0, 1.5, 8761])('rejects invalid session TTL %s without persistence', async ttlHours => {
    await expect(setAdminSettings({ serverName: 'Next server', ttlHours })).rejects.toThrow('ttlHours');
    expect(state.transactions).toBe(0);
    expect(state.rows.size).toBe(0);
  });

  it('retains zero unlimited sessions and documented upper boundaries', () => {
    expect(validateAdminSettings({ ttlHours: 8760, maxPerUser: 0, notificationRetentionDays: 3650, auditLogRetentionDays: 1 }))
      .toEqual({ ttlHours: 8760, maxPerUser: 0, notificationRetentionDays: 3650, auditLogRetentionDays: 1 });
  });
});
