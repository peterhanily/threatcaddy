import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applySchemaPushFixture } from './migrations.js';

const databaseState = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({
  db: new Proxy({}, { get(_target, property) {
    const db = databaseState.db as Record<PropertyKey, unknown>;
    const value = db[property];
    return typeof value === 'function' ? value.bind(db) : value;
  } }),
}));

import { createTokenPair, rotateRefreshToken, hashRefreshToken, revokeUserSessions, revokeSessionFamily, updateUsersAndRevokeSessions, revokeAllSessions } from '../src/services/session-service.js';
import { verifyAccessToken, requireAuth, requireRole } from '../src/middleware/auth.js';
import { checkInvestigationAccess } from '../src/middleware/access.js';
import { pullChanges } from '../src/services/sync-service.js';
import { handleWSConnection, handleWSMessage, handleWSClose, broadcastToFolder, revokeUserFolderAccess } from '../src/ws/handler.js';
import authRoutes from '../src/routes/auth.js';
import adminInvestigations from '../src/routes/admin/investigations.js';
import adminUsers from '../src/routes/admin/users.js';
import investigations from '../src/routes/investigations.js';
import { initAdminKey, signAdminToken } from '../src/middleware/admin-auth.js';
import { bootstrapAdminUser } from '../src/services/admin-session-service.js';
import { updateAdminUser } from '../src/services/admin-secret.js';
import * as argon2 from 'argon2';
import type { AuthUser } from '../src/types.js';

describe('current account and investigation authorization in PostgreSQL', () => {
  let database: ScratchDatabase;
  const sockets: WSContext[] = [];
  beforeAll(() => {
    const keys = generateKeyPairSync('ed25519');
    process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    process.env.JWT_PUBLIC_KEY = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    initAdminKey();
  });
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    databaseState.db = database.db;
    await applySchemaPushFixture(database);
    await database.sql`INSERT INTO admin_users (id,username,display_name,password_hash) VALUES ('admin-fixture','test-admin','Test Administrator','fixture-admin-hash')`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES ('owner','owner@example.invalid','Owner','fixture-hash','admin'), ('editor','editor@example.invalid','Editor','fixture-hash','analyst'), ('viewer','viewer@example.invalid','Viewer','fixture-hash','viewer'), ('other','other@example.invalid','Other','fixture-hash','analyst')`;
    await database.sql`INSERT INTO folders (id,name,description,created_by,updated_by,created_at,updated_at) VALUES ('shared','Shared investigation','Authorized fixture','owner','owner',now(),now()), ('private','Other investigation','Other fixture','other','other',now(),now()), ('deleted-private','Deleted investigation','Deleted fixture','other','other',now(),now())`;
    await database.sql`UPDATE folders SET deleted_at = now() WHERE id = 'deleted-private'`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('m-owner','shared','owner','owner'),('m-editor','shared','editor','editor'),('m-viewer','shared','viewer','viewer'),('m-other','private','other','owner')`;
    await database.sql`INSERT INTO notes (id,title,content,folder_id,created_by,updated_by,created_at,updated_at) VALUES ('shared-note','Shared note','Authorized body','shared','owner','owner',now(),now()), ('private-note','Other note','Other body','private','other','other',now(),now())`;
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) handleWSClose(socket);
    await database?.close();
  });

  async function socketFor(userId: string) {
    const tokens = await createTokenPair(userId);
    const socket = { send: vi.fn(), close: vi.fn(), readyState: 1 } as unknown as WSContext;
    sockets.push(socket);
    handleWSConnection(socket);
    await handleWSMessage(socket, JSON.stringify({ type: 'auth', token: tokens.accessToken }));
    await handleWSMessage(socket, JSON.stringify({ type: 'subscribe', folderId: 'shared' }));
    return { socket, tokens };
  }

  it('applies owner/editor/viewer membership and current server-role limits', async () => {
    expect(await checkInvestigationAccess('owner', 'shared', 'owner')).toBe(true);
    expect(await checkInvestigationAccess('editor', 'shared', 'editor')).toBe(true);
    expect(await checkInvestigationAccess('viewer', 'shared', 'viewer')).toBe(true);
    expect(await checkInvestigationAccess('viewer', 'shared', 'editor')).toBe(false);
    expect(await checkInvestigationAccess('other', 'shared')).toBe(false);
    await database.sql`UPDATE users SET role = 'viewer' WHERE id = 'owner'`;
    expect(await checkInvestigationAccess('owner', 'shared', 'owner')).toBe(false);
    await database.sql`UPDATE users SET active = false WHERE id = 'editor'`;
    expect(await checkInvestigationAccess('editor', 'shared')).toBe(false);
  });

  it('filters investigation metadata, content and tombstones for full and metadata-only pulls', async () => {
    for (const metadataOnly of [false, true]) {
      const result = await pullChanges('2000-01-01T00:00:00Z', ['shared'], { metadataOnly });
      expect(result.changes.filter(row => row.table === 'folders').map(row => row.id)).toEqual(['shared']);
      expect(result.changes.filter(row => row.table === 'notes').map(row => row.id)).toEqual(['shared-note']);
      expect(JSON.stringify(result)).not.toContain('private');
      if (metadataOnly) expect(result.changes.find(row => row.id === 'shared-note')).not.toHaveProperty('content');
      expect((await pullChanges('2000-01-01T00:00:00Z', [], { metadataOnly })).changes).toEqual([]);
    }
  });

  it('authorizes HTTP against the current role and live family, including already-issued access tokens', async () => {
    const tokens = await createTokenPair('owner');
    const app = new Hono<{ Variables: { user: AuthUser } }>();
    app.use('*', requireAuth);
    app.get('/admin', requireRole('admin'), c => c.json({ ok: true }));
    const request = () => app.request('/admin', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    expect((await request()).status).toBe(200);
    await database.sql`UPDATE users SET role = 'viewer' WHERE id = 'owner'`;
    expect((await verifyAccessToken(tokens.accessToken)).role).toBe('viewer');
    expect((await request()).status).toBe(403);
    await database.sql`UPDATE users SET active = false WHERE id = 'owner'`;
    expect((await request()).status).toBe(401);
    await database.sql`UPDATE users SET active = true WHERE id = 'owner'`;
    await revokeUserSessions('owner');
    expect((await request()).status).toBe(401);
  });

  it('prevents globally demoted owners from editing membership while allowing them to leave', async () => {
    const tokens = await createTokenPair('owner');
    await database.sql`UPDATE users SET role = 'viewer' WHERE id = 'owner'`;
    const app = new Hono(); app.route('/investigations', investigations);
    const headers = { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' };
    expect((await app.request('/investigations/shared/members/editor', { method: 'PATCH', headers, body: JSON.stringify({ role: 'owner' }) })).status).toBe(403);
    expect((await app.request('/investigations/shared/members/editor', { method: 'DELETE', headers })).status).toBe(403);
    expect((await app.request('/investigations/shared/members', { method: 'POST', headers, body: JSON.stringify({ userId: 'other' }) })).status).toBe(403);
    expect((await app.request('/investigations/shared/members/owner', { method: 'DELETE', headers })).status).toBe(200);
  });

  it('retains only hashed consumed lineage and revokes the family on reuse', async () => {
    const first = await createTokenPair('editor');
    expect((await database.sql`SELECT id FROM sessions`)[0].id).toBe(hashRefreshToken(first.refreshToken));
    expect(await rotateRefreshToken(hashRefreshToken(first.refreshToken))).toMatchObject({ error: 'invalid' });
    const second = await rotateRefreshToken(first.refreshToken);
    expect(second).not.toHaveProperty('error');
    if ('error' in second) throw new Error('Expected normal rotation');
    expect((await verifyAccessToken(first.accessToken)).id).toBe('editor');
    const lineage = await database.sql`SELECT id,rotation_counter FROM sessions ORDER BY rotation_counter`;
    expect(lineage.map(row => row.rotation_counter)).toEqual([-1, 1]);
    expect(lineage.every(row => row.id !== first.refreshToken && row.id !== second.refreshToken)).toBe(true);
    expect(await rotateRefreshToken(first.refreshToken)).toMatchObject({ error: 'reuse' });
    expect(await rotateRefreshToken(second.refreshToken)).toMatchObject({ error: 'invalid' });
    await expect(verifyAccessToken(second.accessToken)).rejects.toThrow();
    expect(await database.sql`SELECT id FROM sessions`).toHaveLength(0);
  });

  it('serializes simultaneous refresh calls and fails the reused family closed', async () => {
    const first = await createTokenPair('editor');
    const results = await Promise.all([rotateRefreshToken(first.refreshToken), rotateRefreshToken(first.refreshToken)]);
    expect(results.filter(result => !('error' in result))).toHaveLength(1);
    expect(results.filter(result => 'error' in result && result.error === 'reuse')).toHaveLength(1);
    expect(await database.sql`SELECT id FROM sessions`).toHaveLength(0);
    await expect(verifyAccessToken(first.accessToken)).rejects.toThrow();
  });

  it('serializes refresh against revocation and password reset without leaving live credentials', async () => {
    const first = await createTokenPair('editor');
    await Promise.all([rotateRefreshToken(first.refreshToken), revokeUserSessions('editor')]);
    expect(await database.sql`SELECT id FROM sessions`).toHaveLength(0);
    const next = await createTokenPair('editor');
    await Promise.all([rotateRefreshToken(next.refreshToken), updateUsersAndRevokeSessions(['editor'], { passwordHash: 'changed-fixture-hash' })]);
    expect(await database.sql`SELECT id FROM sessions`).toHaveLength(0);
    await expect(verifyAccessToken(next.accessToken)).rejects.toThrow();
    await expect(updateUsersAndRevokeSessions(['editor'], { passwordHash: 'stale-request' }, 'fixture-hash')).rejects.toThrow('credentials changed');
    expect((await database.sql`SELECT password_hash FROM users WHERE id = 'editor'`)[0].password_hash).toBe('changed-fixture-hash');
  });

  it('converts an existing opaque refresh token to hashed lineage and rejects expired sessions', async () => {
    const legacy = 'legacy_fixture_refresh_token_001';
    expect(legacy).toHaveLength(32);
    await database.sql`INSERT INTO sessions (id,user_id,expires_at) VALUES (${legacy},'editor',now()+interval '1 day')`;
    const result = await rotateRefreshToken(legacy);
    expect(result).not.toHaveProperty('error');
    expect(await database.sql`SELECT id FROM sessions WHERE id = ${legacy}`).toHaveLength(0);
    await database.sql`UPDATE sessions SET expires_at = now()-interval '1 second'`;
    if ('error' in result) throw new Error('Expected legacy conversion');
    await expect(verifyAccessToken(result.accessToken)).rejects.toThrow();
    expect(await rotateRefreshToken(result.refreshToken)).toMatchObject({ error: 'expired' });
  });

  it('enforces device limits using live families instead of consumed refresh records', async () => {
    await database.sql`INSERT INTO server_settings (key,value) VALUES ('max_sessions_per_user','2')`;
    const one = await createTokenPair('editor');
    await rotateRefreshToken(one.refreshToken);
    const two = await createTokenPair('editor');
    expect((await verifyAccessToken(one.accessToken)).id).toBe('editor');
    const three = await createTokenPair('editor');
    await expect(verifyAccessToken(one.accessToken)).rejects.toThrow();
    expect((await verifyAccessToken(two.accessToken)).id).toBe('editor');
    expect((await verifyAccessToken(three.accessToken)).id).toBe('editor');
  });

  it('logs out the authenticated family while preserving another device and another user', async () => {
    const one = await createTokenPair('editor');
    const two = await createTokenPair('editor');
    const other = await createTokenPair('other');
    const app = new Hono(); app.route('/auth', authRoutes);
    const response = await app.request('/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${one.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: other.refreshToken }) });
    expect(response.status).toBe(200);
    await expect(verifyAccessToken(one.accessToken)).rejects.toThrow();
    expect((await verifyAccessToken(two.accessToken)).id).toBe('editor');
    expect((await verifyAccessToken(other.accessToken)).id).toBe('other');
  });

  it('removes every socket subscription and presence when membership is revoked', async () => {
    const first = await socketFor('editor');
    const second = await socketFor('editor');
    await database.sql`DELETE FROM investigation_members WHERE user_id = 'editor'`;
    revokeUserFolderAccess('editor', 'shared');
    vi.mocked(first.socket.send).mockClear(); vi.mocked(second.socket.send).mockClear();
    await broadcastToFolder('shared', { type: 'entity-change', id: 'benign-fixture' });
    expect(first.socket.send).not.toHaveBeenCalled(); expect(second.socket.send).not.toHaveBeenCalled();
    await handleWSMessage(first.socket, JSON.stringify({ type: 'subscribe', folderId: 'shared' }));
    expect(first.socket.send).toHaveBeenCalledWith(expect.stringContaining('No access'));
  });

  it('rechecks recipients against current database membership and account status before broadcasting', async () => {
    const { socket } = await socketFor('editor');
    vi.mocked(socket.send).mockClear();
    await broadcastToFolder('shared', { type: 'entity-change', id: 'authorized-fixture' });
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('authorized-fixture'));
    await database.sql`UPDATE users SET active = false WHERE id = 'editor'`;
    vi.mocked(socket.send).mockClear();
    await broadcastToFolder('shared', { type: 'entity-change', id: 'later-fixture' });
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('later-fixture'));
    expect(socket.close).toHaveBeenCalled();
  });

  it('disconnects matching sockets for family, account and all-user revocation', async () => {
    const first = await socketFor('editor');
    const second = await socketFor('editor');
    const user = await verifyAccessToken(first.tokens.accessToken);
    await revokeSessionFamily(user.id, user.sessionFamily!);
    expect(first.socket.close).toHaveBeenCalled(); expect(second.socket.close).not.toHaveBeenCalled();
    await updateUsersAndRevokeSessions(['editor'], { role: 'viewer' });
    expect(second.socket.close).toHaveBeenCalled();
    const other = await socketFor('owner');
    await revokeAllSessions();
    expect(other.socket.close).toHaveBeenCalled();
  });

  it('applies admin membership removal and password reset to already authenticated sockets and tokens', async () => {
    const { socket, tokens } = await socketFor('editor');
    const adminToken = await signAdminToken('admin-fixture', 'test-admin', 'fixture-admin-hash');
    const app = new Hono(); app.route('/admin', adminInvestigations); app.route('/admin', adminUsers);
    const headers = { Authorization: `Bearer ${adminToken}` };
    expect((await app.request('/admin/api/investigations/shared/members/editor', { method: 'DELETE', headers })).status).toBe(200);
    vi.mocked(socket.send).mockClear();
    await broadcastToFolder('shared', { type: 'entity-change', id: 'after-admin-removal' });
    expect(socket.send).not.toHaveBeenCalled();
    expect((await app.request('/admin/api/users/editor/reset-password', { method: 'POST', headers })).status).toBe(200);
    expect(socket.close).toHaveBeenCalled();
    await expect(verifyAccessToken(tokens.accessToken)).rejects.toThrow();
    expect(await rotateRefreshToken(tokens.refreshToken)).toMatchObject({ error: 'invalid' });
  });

  it('keeps ownerless investigations visible to administrative recovery without granting ordinary membership', async () => {
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('ownerless','Recoverable fixture',now(),now())`;
    const app = new Hono(); app.route('/admin', adminInvestigations);
    const headers = { Authorization: `Bearer ${await signAdminToken('admin-fixture', 'test-admin', 'fixture-admin-hash')}` };
    const list = await app.request('/admin/api/investigations', { headers });
    expect(list.status).toBe(200);
    expect((await list.json()).investigations).toContainEqual(expect.objectContaining({ id: 'ownerless', creatorName: null }));
    expect((await app.request('/admin/api/investigations/ownerless/detail', { headers })).status).toBe(200);
    expect(await checkInvestigationAccess('editor', 'ownerless')).toBe(false);
  });

  it('rejects disabled, re-enabled, deleted and password-reset administrator tokens', async () => {
    const app = new Hono(); app.route('/admin', adminInvestigations);
    const token = await signAdminToken('admin-fixture', 'test-admin', 'fixture-admin-hash');
    const request = (value: string) => app.request('/admin/api/investigations', { headers: { Authorization: `Bearer ${value}` } });
    expect((await request(token)).status).toBe(200);
    await updateAdminUser('admin-fixture', { active: false });
    expect((await request(token)).status).toBe(401);
    await updateAdminUser('admin-fixture', { active: true });
    expect((await request(token)).status).toBe(401);
    const second = await signAdminToken('admin-fixture', 'test-admin', 'fixture-admin-hash');
    await database.sql`UPDATE admin_users SET password_hash = 'reset-fixture-hash' WHERE id = 'admin-fixture'`;
    expect((await request(second)).status).toBe(401);
    await expect(signAdminToken('admin-fixture', 'test-admin', 'fixture-admin-hash')).rejects.toThrow('credentials changed');
    const third = await signAdminToken('admin-fixture', 'test-admin', 'reset-fixture-hash');
    await database.sql`DELETE FROM admin_users WHERE id = 'admin-fixture'`;
    expect((await request(third)).status).toBe(401);
  });

  it('allows one bootstrap setup only when no active administrator exists, including simultaneous attempts', async () => {
    const secret = 'local-bootstrap-fixture-secret';
    await database.sql`INSERT INTO server_settings (key,value) VALUES ('admin_secret_hash',${await argon2.hash(secret)})`;
    expect(await bootstrapAdminUser(secret, 'extra-admin', 'Extra', 'long-fixture-password')).toMatchObject({ error: 'configured' });
    await database.sql`UPDATE admin_users SET active = false`;
    const results = await Promise.all([
      bootstrapAdminUser(secret, 'recovery-one', 'Recovery One', 'long-fixture-password'),
      bootstrapAdminUser(secret, 'recovery-two', 'Recovery Two', 'long-fixture-password'),
    ]);
    expect(results.filter(result => 'admin' in result)).toHaveLength(1);
    expect(results.filter(result => 'error' in result && result.error === 'configured')).toHaveLength(1);
    expect((await database.sql`SELECT id FROM admin_users WHERE active = true`)).toHaveLength(1);
  });
});
