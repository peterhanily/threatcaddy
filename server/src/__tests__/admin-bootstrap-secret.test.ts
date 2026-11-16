import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  selects: 0,
  transactions: 0,
  hold: undefined as Promise<void> | undefined,
  warn: vi.fn(),
  info: vi.fn(),
  hash: vi.fn(async () => 'synthetic-hash'),
  verify: vi.fn(async () => false),
}));
vi.mock('../db/index.js', () => {
  const chain = () => {
    const query: Record<string, unknown> = {};
    for (const key of ['from', 'where', 'limit', 'for']) query[key] = () => query;
    query.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
      state.selects++;
      const rows = state.rows.shift() ?? [];
      return (state.hold ?? Promise.resolve()).then(() => rows).then(resolve, reject);
    };
    return query;
  };
  const write = () => {
    const query: Record<string, unknown> = { values: () => query, set: () => query, where: () => query, onConflictDoNothing: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve) };
    return query;
  };
  return { db: { select: chain, insert: write, update: write,
    transaction: async () => { state.transactions++; throw new Error('Bootstrap must not open a transaction here'); } } };
});
vi.mock('argon2', () => ({ argon2id: 2, hash: state.hash, verify: state.verify }));
vi.mock('../lib/logger.js', () => ({ logger: { warn: state.warn, info: state.info, error: vi.fn() } }));

import { initAdminSecret } from '../services/admin-secret.js';
import { bootstrapAdminUser } from '../services/admin-session-service.js';
import { getAdminHtml } from '../routes/admin-html/index.js';

const original = process.env.ADMIN_SECRET;
beforeEach(() => {
  state.rows.length = 0; state.selects = 0; state.transactions = 0; state.hold = undefined;
  state.warn.mockClear(); state.info.mockClear(); state.hash.mockClear(); state.verify.mockClear();
});
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_SECRET; else process.env.ADMIN_SECRET = original;
});

describe('ADMIN_SECRET startup', () => {
  it('warns about a short configured secret without logging it, and still applies it', async () => {
    const secret = 'short-synthetic-secret';
    process.env.ADMIN_SECRET = secret;
    await initAdminSecret();
    expect(state.hash).toHaveBeenCalledWith(secret, expect.anything());
    expect(state.warn).toHaveBeenCalledTimes(1);
    expect(state.warn.mock.calls[0][0]).toMatch(/ADMIN_SECRET is shorter than 24 characters/);
    expect(JSON.stringify([...state.warn.mock.calls, ...state.info.mock.calls])).not.toContain(secret);
  });

  it('does not warn for a long configured secret', async () => {
    process.env.ADMIN_SECRET = 'x'.repeat(24);
    await initAdminSecret();
    expect(state.warn).not.toHaveBeenCalled();
  });

  it('tells administrators that a configured ADMIN_SECRET replaces a changed secret at restart', () => {
    const section = getAdminHtml('nonce-fixture').match(/<h2>Change Bootstrap Secret<\/h2>\s*<p[^>]*>([^<]*)<\/p>/);
    expect(section?.[1]).toMatch(/ADMIN_SECRET environment variable is set, it replaces this secret at every server restart/);
  });
});

describe('bootstrap ordering', () => {
  it('rejects concurrent work as busy before touching the database', async () => {
    let release!: () => void;
    state.hold = new Promise(resolve => { release = resolve; });
    state.rows.push([]);
    const first = bootstrapAdminUser('secret', 'admin', 'Admin', 'password-fixture');
    await Promise.resolve();
    const selectsBefore = state.selects;
    await expect(bootstrapAdminUser('secret', 'admin', 'Admin', 'password-fixture')).resolves.toEqual({ error: 'busy' });
    expect(state.selects).toBe(selectsBefore);
    release();
    state.hold = undefined;
    await expect(first).resolves.toEqual({ error: 'invalid' });
  });

  it('reports a configured server before any password verification or hashing', async () => {
    state.rows.push([{ id: 'active-admin' }]);
    await expect(bootstrapAdminUser('secret', 'admin', 'Admin', 'password-fixture')).resolves.toEqual({ error: 'configured' });
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.hash).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });

  it('rejects a wrong secret after verification without hashing or locking', async () => {
    state.rows.push([], [{ key: 'admin_secret_hash', value: 'stored-hash' }]);
    await expect(bootstrapAdminUser('wrong', 'admin', 'Admin', 'password-fixture')).resolves.toEqual({ error: 'invalid' });
    expect(state.verify).toHaveBeenCalledWith('stored-hash', 'wrong');
    expect(state.hash).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });
});
