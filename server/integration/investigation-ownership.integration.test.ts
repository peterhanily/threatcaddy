import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));

import investigations from '../src/routes/investigations.js';
import adminInvestigations from '../src/routes/admin/investigations.js';
import adminUsers from '../src/routes/admin/users.js';
import { initAdminKey, signAdminToken } from '../src/middleware/admin-auth.js';
import { createTokenPair, updateUsersAndRevokeSessions } from '../src/services/session-service.js';
import { verifyAccessToken } from '../src/middleware/auth.js';
import { mutateInvestigationMember } from '../src/services/investigation-policy.js';

describe('eligible investigation ownership invariants in real PostgreSQL', () => {
  let database: ScratchDatabase;
  let app: Hono;
  let adminHeaders: Record<string, string>;
  beforeAll(() => {
    const keys = generateKeyPairSync('ed25519');
    process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    process.env.JWT_PUBLIC_KEY = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    initAdminKey();
  });
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO admin_users (id,username,display_name,password_hash)
      VALUES ('administrator','fictional-admin','Fictional administrator','fictional-admin-hash')`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role,active) VALUES
      ('owner-a','owner-a@example.invalid','Fictional owner A','fixture','analyst',true),
      ('owner-b','owner-b@example.invalid','Fictional owner B','fixture','analyst',true),
      ('editor','editor@example.invalid','Fictional editor','fixture','analyst',true),
      ('viewer','viewer@example.invalid','Fictional viewer','fixture','viewer',true),
      ('inactive','inactive@example.invalid','Fictional inactive','fixture','analyst',false),
      ('system','fixture@threatcaddy.internal','Fictional system','fixture','admin',true),
      ('other','other@example.invalid','Fictional other admin','fixture','admin',true)`;
    await database.sql`INSERT INTO folders (id,name,created_by,updated_by,created_at,updated_at)
      VALUES ('shared','Fictional shared case','owner-a','owner-a',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('member-a','shared','owner-a','owner'),('member-b','shared','owner-b','owner'),
      ('member-editor','shared','editor','editor'),('member-viewer','shared','viewer','viewer')`;
    app = new Hono();
    app.route('/investigations', investigations);
    app.route('/admin', adminInvestigations);
    app.route('/admin', adminUsers);
    adminHeaders = { Authorization: `Bearer ${await signAdminToken('administrator', 'fictional-admin', 'fictional-admin-hash')}`,
      'Content-Type': 'application/json' };
  });
  afterEach(async () => { await database?.close(); });

  async function eligibleOwners() {
    return database.sql`SELECT u.id FROM investigation_members m JOIN users u ON u.id=m.user_id
      WHERE m.folder_id='shared' AND m.role='owner' AND u.active=true
        AND u.role IN ('admin','analyst') AND lower(u.email) NOT LIKE '%@threatcaddy.internal' ORDER BY u.id`;
  }
  const membership = (userId: string) => `/admin/api/investigations/shared/members/${userId}`;
  async function headersFor(userId: string) {
    const tokens = await createTokenPair(userId);
    return { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' };
  }

  it.each(['remove', 'demote'] as const)('serializes two simultaneous owner %s requests without orphaning', async operation => {
    const responses = await Promise.all(['owner-a', 'owner-b'].map(userId => app.request(membership(userId), {
      method: operation === 'remove' ? 'DELETE' : 'PATCH', headers: adminHeaders,
      ...(operation === 'demote' ? { body: JSON.stringify({ role: 'editor' }) } : {}),
    })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find(response => response.status === 409)!.json()).toMatchObject({ code: 'LAST_ELIGIBLE_OWNER' });
    expect(await eligibleOwners()).toHaveLength(1);
  });

  it('allows one of two ordinary owners to leave, but retains the final owner', async () => {
    const first = await headersFor('owner-a');
    const second = await headersFor('owner-b');
    const responses = await Promise.all([
      app.request('/investigations/shared/members/owner-a', { method: 'DELETE', headers: first }),
      app.request('/investigations/shared/members/owner-b', { method: 'DELETE', headers: second }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await eligibleOwners()).toHaveLength(1);
  });

  it.each([
    { action: 'disable' }, { action: 'changeRole', role: 'viewer' },
  ])('rolls back bulk account $action, including sessions, if it removes every eligible owner', async action => {
    const tokenA = await createTokenPair('owner-a');
    const tokenB = await createTokenPair('owner-b');
    const before = await database.sql`SELECT id,active,role FROM users ORDER BY id`;
    const sessions = await database.sql`SELECT id,user_id FROM sessions ORDER BY id`;
    const response = await app.request('/admin/api/users/bulk', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ ...action, userIds: ['owner-a', 'owner-b'] }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LAST_ELIGIBLE_OWNER' });
    expect(await database.sql`SELECT id,active,role FROM users ORDER BY id`).toEqual(before);
    expect(await database.sql`SELECT id,user_id FROM sessions ORDER BY id`).toEqual(sessions);
    expect((await verifyAccessToken(tokenA.accessToken)).id).toBe('owner-a');
    expect((await verifyAccessToken(tokenB.accessToken)).id).toBe('owner-b');
  });

  it('serializes independent deactivations and revokes only the committed account sessions', async () => {
    const tokenA = await createTokenPair('owner-a');
    const tokenB = await createTokenPair('owner-b');
    const responses = await Promise.all(['owner-a', 'owner-b'].map(userId => app.request(`/admin/api/users/${userId}`, {
      method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active: false }),
    })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const remaining = await eligibleOwners();
    expect(remaining).toHaveLength(1);
    const tokens = { 'owner-a': tokenA, 'owner-b': tokenB };
    for (const userId of ['owner-a', 'owner-b'] as const) {
      if (remaining[0].id === userId) expect((await verifyAccessToken(tokens[userId].accessToken)).id).toBe(userId);
      else await expect(verifyAccessToken(tokens[userId].accessToken)).rejects.toThrow();
    }
  });

  it.each(['inactive', 'viewer', 'system'])('refuses %s as an owner without changing current membership', async userId => {
    const before = await database.sql`SELECT user_id,role FROM investigation_members ORDER BY user_id`;
    const response = await app.request('/admin/api/investigations/shared/members', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ userId, role: 'owner' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INELIGIBLE_OWNER' });
    expect(await database.sql`SELECT user_id,role FROM investigation_members ORDER BY user_id`).toEqual(before);
  });

  it('does not count legacy inactive, viewer or system ownership as an eligible replacement', async () => {
    await database.sql`UPDATE users SET active=false WHERE id='owner-b'`;
    await database.sql`UPDATE investigation_members SET role='owner' WHERE user_id='viewer'`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('legacy-system','shared','system','owner')`;
    const response = await app.request(membership('owner-a'), { method: 'DELETE', headers: adminHeaders });
    expect(response.status).toBe(409);
    expect((await eligibleOwners()).map(row => row.id)).toEqual(['owner-a']);
  });

  it('retains recoverable ownership while soft-deleted and permits explicit admin repair', async () => {
    await database.sql`UPDATE folders SET deleted_at=now() WHERE id='shared'`;
    expect((await app.request(membership('owner-b'), { method: 'DELETE', headers: adminHeaders })).status).toBe(200);
    expect((await app.request(membership('owner-a'), { method: 'DELETE', headers: adminHeaders })).status).toBe(409);
    const recovery = await app.request('/admin/api/investigations/shared/members', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ userId: 'other', role: 'owner' }) });
    expect(recovery.status).toBe(200);
    expect((await eligibleOwners()).map(row => row.id)).toEqual(['other', 'owner-a']);
  });

  it('serializes account deactivation against membership removal under the same policy lock', async () => {
    const results = await Promise.allSettled([
      updateUsersAndRevokeSessions(['owner-a'], { active: false }),
      mutateInvestigationMember({ actor: { kind: 'admin', userId: 'administrator' }, folderId: 'shared',
        targetUserId: 'owner-b', operation: 'remove' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: 'LAST_ELIGIBLE_OWNER' });
    expect(await eligibleOwners()).toHaveLength(1);
  });

  it.each([{ active: false }, { role: 'viewer' }] as const)('serializes administrator eligibility changes $active $role independently of folder ownership', async updates => {
    await database.sql`UPDATE users SET role='analyst' WHERE id='other'`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('admin-a','admin-a@example.invalid','Fictional app admin A','fixture','admin'),
      ('admin-b','admin-b@example.invalid','Fictional app admin B','fixture','admin')`;
    const tokens = { 'admin-a': await createTokenPair('admin-a'), 'admin-b': await createTokenPair('admin-b') };
    const responses = await Promise.all(['admin-a', 'admin-b'].map(userId => app.request(`/admin/api/users/${userId}`, {
      method: 'PATCH', headers: adminHeaders, body: JSON.stringify(updates),
    })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find(response => response.status === 409)!.json()).toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
    const remaining = await database.sql`SELECT id FROM users WHERE active=true AND role='admin'
      AND lower(email) NOT LIKE '%@threatcaddy.internal'`;
    expect(remaining).toHaveLength(1);
    for (const userId of ['admin-a', 'admin-b'] as const) {
      if (remaining[0].id === userId) expect((await verifyAccessToken(tokens[userId].accessToken)).id).toBe(userId);
      else await expect(verifyAccessToken(tokens[userId].accessToken)).rejects.toThrow();
    }
  });

  it('does not count an internal account as a remaining application administrator during bulk changes', async () => {
    const token = await createTokenPair('other');
    const before = await database.sql`SELECT id,active,role FROM users ORDER BY id`;
    const sessions = await database.sql`SELECT id,user_id FROM sessions ORDER BY id`;
    const response = await app.request('/admin/api/users/bulk', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ action: 'disable', userIds: ['other'] }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
    expect(await database.sql`SELECT id,active,role FROM users ORDER BY id`).toEqual(before);
    expect(await database.sql`SELECT id,user_id FROM sessions ORDER BY id`).toEqual(sessions);
    expect((await verifyAccessToken(token.accessToken)).id).toBe('other');
  });

  it('rechecks membership after waiting for a previously started policy transaction', async () => {
    const headers = await headersFor('owner-a');
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const prior = database.sql.begin(async transaction => {
      await transaction`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      await transaction`DELETE FROM investigation_members WHERE folder_id='shared' AND user_id='owner-a'`;
      acquired();
      await held;
    });
    let request: Promise<Response> | undefined;
    try {
      await locked;
      request = Promise.resolve(app.request('/investigations/shared/members/editor', { method: 'PATCH', headers,
        body: JSON.stringify({ role: 'owner' }) }));
      await vi.waitFor(async () => {
        const rows = await database.sql`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 5_000 });
    } finally { release(); await prior; }
    const response = await request!;
    expect(response.status).toBe(403);
    expect((await database.sql`SELECT role FROM investigation_members WHERE user_id='editor'`)[0].role).toBe('editor');
    expect((await eligibleOwners()).map(row => row.id)).toEqual(['owner-b']);
  });

  it('requires explicit administrator recovery of a legacy orphan and does not restore creator authority', async () => {
    await database.sql`DELETE FROM investigation_members WHERE folder_id='shared' AND role='owner'`;
    const ordinary = await app.request('/investigations/shared/members', { method: 'POST', headers: await headersFor('owner-a'),
      body: JSON.stringify({ userId: 'other', role: 'owner' }) });
    expect(ordinary.status).toBe(403);
    const recovered = await app.request('/admin/api/investigations/shared/members', { method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ userId: 'other', role: 'owner' }) });
    expect(recovered.status).toBe(200);
    expect((await eligibleOwners()).map(row => row.id)).toEqual(['other']);
    expect(await database.sql`SELECT id FROM investigation_members WHERE user_id='owner-a'`).toEqual([]);
  });

  it('does not reinstate a removed creator during packaged startup or restart', async () => {
    await database.sql`DELETE FROM investigation_members WHERE folder_id='shared' AND role='owner'`;
    const before = await database.sql`SELECT id,user_id,role FROM investigation_members ORDER BY id`;
    const artifact = await stageBuiltServer();
    try {
      await bootBuiltServer(database, artifact);
      await bootBuiltServer(database, artifact);
      expect(await database.sql`SELECT id,user_id,role FROM investigation_members ORDER BY id`).toEqual(before);
      expect(await eligibleOwners()).toHaveLength(0);
      expect((await database.sql`SELECT created_by FROM folders WHERE id='shared'`)[0].created_by).toBe('owner-a');
    } finally { await artifact.close(); }
  });
});
