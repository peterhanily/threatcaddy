import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, abortAfterDelete: undefined as AbortController | undefined,
  abortAfterCommit: undefined as AbortController | undefined, audit: vi.fn(), notify: vi.fn(), reload: vi.fn(), unload: vi.fn() }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  if (property === 'transaction') return async (callback: (tx: unknown) => Promise<unknown>) => {
    const result = await (database.transaction as (cb: (tx: object) => Promise<unknown>) => Promise<unknown>)(async tx => callback(new Proxy(tx, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key === 'delete' && state.abortAfterDelete) return (...args: unknown[]) => {
          const query = value.apply(target, args);
          const original = query.then.bind(query);
          query.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => original((rows: unknown) => {
            state.abortAfterDelete?.abort(); return resolve(rows);
          }, reject);
          return query;
        };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })));
    state.abortAfterCommit?.abort();
    return result;
  };
  const value = database[property]; return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/services/audit-service.js', () => ({ logActivity: state.audit }));
vi.mock('../src/services/session-events.js', () => ({ notifySessionRevocation: state.notify }));
// Persisted settings are exercised; no scheduler, bot, provider or external integration executes.
vi.mock('../src/bots/bot-manager.js', () => ({ botManager: { reloadBot: state.reload, unloadBot: state.unload }, validateCronExpression: vi.fn() }));
import { getAdminAiPrincipal, initAdminKey, requireAdminAuth, signAdminToken, type AdminAiPrincipal } from '../src/middleware/admin-auth.js';
import { revokeAdminSessions } from '../src/services/admin-session-service.js';
import { AdminAiApprovalRegistry } from '../src/services/admin-ai-approvals.js';
import { dispatchAdminAiTool, executeApprovedAdminAiTool } from '../src/services/admin-ai-service.js';

describe('exact AI action authority and commit receipts in PostgreSQL', () => {
  let database: ScratchDatabase;
  let principal: AdminAiPrincipal;
  let registry: AdminAiApprovalRegistry;
  beforeEach(async () => {
    vi.clearAllMocks(); state.abortAfterDelete = undefined; state.abortAfterCommit = undefined;
    state.audit.mockResolvedValue(undefined); state.reload.mockResolvedValue(undefined); state.unload.mockResolvedValue(undefined);
    database = await scratchDatabase({ maxConnections: 4 }); state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO admin_users (id,username,display_name,password_hash,active)
      VALUES ('console','fictional-console','Fictional console','fixture-admin-hash',true)`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role,active) VALUES
      ('target','target@example.invalid','Fictional target','fixture','analyst',true),
      ('other','other@example.invalid','Fictional other','fixture','admin',true),
      ('inactive','inactive@example.invalid','Fictional inactive','fixture','analyst',false)`;
    await database.sql`INSERT INTO sessions (id,user_id,rotation_counter,expires_at) VALUES
      ('fictional-live','target',0,now()+interval '1 day'),
      ('fictional-consumed','target',-1,now()+interval '1 day'),
      ('fictional-expired','target',0,now()-interval '1 day'),
      ('fictional-disabled','inactive',0,now()+interval '1 day')`;
    initAdminKey();
    const token = await signAdminToken('console', 'fictional-console', 'fixture-admin-hash');
    const app = new Hono().get('/', requireAdminAuth, c => c.json(getAdminAiPrincipal(c)));
    const response = await app.request('/', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200); principal = await response.json() as AdminAiPrincipal;
    registry = new AdminAiApprovalRegistry();
  });
  afterEach(async () => { await database?.close(); });

  function approve(signal?: AbortSignal) {
    const proposal = registry.issue(principal, 'toggle_user_active', { userId: 'target', active: false });
    return { proposal, receipt: registry.decide(proposal.approvalId, 'approve', principal,
      (name, input) => executeApprovedAdminAiTool(name, input, { principal, signal })) };
  }
  async function unchanged() {
    expect((await database.sql`SELECT active FROM users WHERE id='target'`)[0].active).toBe(true);
    expect((await database.sql`SELECT count(*)::int AS n FROM sessions WHERE user_id='target'`)[0].n).toBe(3);
    expect(state.notify).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  }

  it.each(['password', 'deactivate', 'session epoch'])('rechecks %s revocation after waiting for the write lock', async kind => {
    let result!: ReturnType<typeof approve>;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      result = approve();
      await vi.waitFor(async () => {
        expect((await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query ILIKE '%sync_clock%' AND query ILIKE '%FOR UPDATE%'`).length).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
      if (kind === 'password') await tx`UPDATE admin_users SET password_hash='changed-fixture-hash' WHERE id='console'`;
      if (kind === 'deactivate') await tx`UPDATE admin_users SET active=false WHERE id='console'`;
      if (kind === 'session epoch') revokeAdminSessions('console');
    });
    expect(await result.receipt).toMatchObject({ status: 'failed', error: expect.stringContaining('session expired or changed') });
    await unchanged();
  });

  it('rolls back the account and session deletion when cancellation arrives inside the transaction', async () => {
    state.abortAfterDelete = new AbortController();
    expect(await approve(state.abortAfterDelete.signal).receipt).toMatchObject({ status: 'failed', error: 'Action cancelled before commit.' });
    await unchanged();
  });

  it('retains a committed receipt when the request is cancelled during transaction settlement', async () => {
    state.abortAfterCommit = new AbortController();
    const { proposal, receipt } = approve(state.abortAfterCommit.signal);
    expect(await receipt).toMatchObject({ status: 'completed', result: { ok: true, active: false } });
    expect((await database.sql`SELECT active FROM users WHERE id='target'`)[0].active).toBe(false);
    expect((await database.sql`SELECT count(*)::int AS n FROM sessions WHERE user_id='target'`)[0].n).toBe(0);
    const executeAgain = vi.fn();
    expect(await registry.decide(proposal.approvalId, 'approve', principal, executeAgain)).toMatchObject({ status: 'completed' });
    expect(executeAgain).not.toHaveBeenCalled(); expect(state.audit).toHaveBeenCalledTimes(1);
  });

  it('does not relabel an account commit when audit persistence later fails', async () => {
    state.audit.mockRejectedValueOnce(new Error('Synthetic unavailable audit storage'));
    expect(await approve().receipt).toMatchObject({ status: 'completed', result: { ok: true, warnings: [expect.any(String)] } });
    expect((await database.sql`SELECT active FROM users WHERE id='target'`)[0].active).toBe(false);
  });

  it('projects only live sessions, without raw or hashed credential identifiers', async () => {
    const result = await dispatchAdminAiTool('get_active_sessions', {}, { principal });
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') throw new Error('Expected read result');
    const rows = result.result as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'displayName', 'expiresAt', 'userEmail', 'userId']);
    expect(rows[0].userId).toBe('target');
    const stats = await dispatchAdminAiTool('get_server_stats', {}, { principal });
    expect(stats).toMatchObject({ kind: 'result', result: { activeSessions: 1 } });
  });

  it('bounds bot lists and rejects unsupported activation but permits disable', async () => {
    await database.sql`INSERT INTO bot_configs (id,user_id,type,name,enabled,created_by)
      SELECT 'fixture-bot-'||n,'target','integration','Fictional legacy definition',true,'target' FROM generate_series(1,105) n`;
    const listing = await dispatchAdminAiTool('list_bots', {}, { principal });
    expect(listing.kind === 'result' && Array.isArray(listing.result) && listing.result.length).toBe(20);
    const activation = registry.issue(principal, 'toggle_bot', { botId: 'fixture-bot-1', enabled: true });
    const execute = (name: string, input: Record<string, unknown>) => executeApprovedAdminAiTool(name, input, { principal });
    expect(await registry.decide(activation.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'failed', error: expect.stringContaining('unavailable') });
    expect(state.reload).not.toHaveBeenCalled();
    const disable = registry.issue(principal, 'toggle_bot', { botId: 'fixture-bot-1', enabled: false });
    expect(await registry.decide(disable.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'completed', result: { enabled: false } });
    expect((await database.sql`SELECT enabled FROM bot_configs WHERE id='fixture-bot-1'`)[0].enabled).toBe(false);
    expect(state.unload).toHaveBeenCalledExactlyOnceWith('fixture-bot-1', { signal: expect.any(AbortSignal) });
  });
});
