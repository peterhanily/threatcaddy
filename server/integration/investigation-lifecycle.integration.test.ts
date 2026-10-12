import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, events: vi.fn(), revoke: vi.fn(),
  cleanup: vi.fn(), inspectCleanup: undefined as (() => Promise<void>) | undefined }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: state.events }));
vi.mock('../src/ws/handler.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/ws/handler.js')>(), revokeFolderAccess: state.revoke,
}));
vi.mock('../src/services/storage-policy.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/services/storage-policy.js')>();
  return { ...actual, removeCommittedBlobs: async (...args: Parameters<typeof actual.removeCommittedBlobs>) => {
    state.cleanup(...args);
    await state.inspectCleanup?.();
    return actual.removeCommittedBlobs(...args);
  } };
});

import { createTokenPair } from '../src/services/session-service.js';
import { initAdminKey, signAdminToken } from '../src/middleware/admin-auth.js';
import { checkInvestigationAccess } from '../src/middleware/access.js';
import { processPush, pullCursorChanges, pullChanges, getSnapshot } from '../src/services/sync-service.js';
import { purgeExpiredInvestigation, purgeInvestigation } from '../src/services/investigation-lifecycle.js';
import { removeCommittedBlobs } from '../src/services/storage-policy.js';

const retainedTables = ['notes', 'tasks', 'timeline_events', 'whiteboards', 'standalone_iocs', 'chat_threads', 'evidence_items'] as const;
const marker = 'Fictional retained child body';

describe('investigation soft deletion and committed purge in real PostgreSQL', () => {
  let database: ScratchDatabase;
  let directory: string;
  let paths: string[] = [];
  let app: Hono;
  let userHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;
  let userRoutes: typeof import('../src/routes/investigations.js').default;
  let adminRoutes: Hono;
  let blob: string;
  let thumbnail: string;
  let unrelatedBlob: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'threatcaddy-lifecycle-files-'));
    vi.stubEnv('FILE_STORAGE_PATH', directory);
    const keys = generateKeyPairSync('ed25519');
    vi.stubEnv('JWT_PRIVATE_KEY', keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
    vi.stubEnv('JWT_PUBLIC_KEY', keys.publicKey.export({ format: 'pem', type: 'spki' }).toString());
    initAdminKey();
    // Both routes capture their storage root on import, after the disposable
    // directory exists. No test ever targets /data/files or a user directory.
    userRoutes = (await import('../src/routes/investigations.js')).default;
    adminRoutes = (await import('../src/routes/admin/investigations.js')).default;
  });
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    state.cleanup.mockClear(); state.revoke.mockClear(); state.events.mockClear(); state.inspectCleanup = undefined;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO admin_users (id,username,display_name,password_hash)
      VALUES ('administrator','fictional-admin','Fictional administrator','fictional-admin-hash')`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Fictional owner','fixture','analyst'),
      ('other-owner','second@example.invalid','Fictional second owner','fixture','analyst'),
      ('editor','editor@example.invalid','Fictional editor','fixture','analyst'),
      ('reader','reader@example.invalid','Fictional reader','fixture','viewer'),
      ('outside-admin','outside@example.invalid','Fictional unrelated admin','fixture','admin')`;
    await database.sql`INSERT INTO folders (id,name,created_by,updated_by,created_at,updated_at) VALUES
      ('shared','Fictional retained case','owner','owner',now(),now()),
      ('unrelated','Fictional unrelated case','outside-admin','outside-admin',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('member-owner','shared','owner','owner'),('member-other-owner','shared','other-owner','owner'),
      ('member-editor','shared','editor','editor'),('member-reader','shared','reader','viewer'),
      ('member-unrelated','unrelated','outside-admin','owner')`;
    await database.sql`INSERT INTO notes (id,title,content,folder_id,created_at,updated_at) VALUES
      ('note','Fictional note',${marker},'shared',now(),now()),
      ('independent-tombstone','Fictional deleted note','Separately deleted','shared',now(),now()),
      ('other-note','Unrelated note','Must remain','unrelated',now(),now())`;
    await database.sql`UPDATE notes SET deleted_at=now() WHERE id='independent-tombstone'`;
    await database.sql`INSERT INTO tasks (id,title,description,folder_id,created_at,updated_at)
      VALUES ('task','Fictional task',${marker},'shared',now(),now())`;
    await database.sql`INSERT INTO timeline_events (id,title,description,timestamp,event_type,timeline_id,folder_id,created_at,updated_at)
      VALUES ('event','Fictional event',${marker},now(),'other','fictional-timeline','shared',now(),now())`;
    await database.sql`INSERT INTO whiteboards (id,name,elements,folder_id,created_at,updated_at)
      VALUES ('board','Fictional board','[]','shared',now(),now())`;
    await database.sql`INSERT INTO standalone_iocs (id,type,value,analyst_notes,folder_id,created_at,updated_at)
      VALUES ('ioc','domain','example.invalid',${marker},'shared',now(),now())`;
    await database.sql`INSERT INTO chat_threads (id,title,messages,model,provider,folder_id,created_at,updated_at)
      VALUES ('chat','Fictional chat','[]','fixture','local','shared',now(),now())`;
    await database.sql`INSERT INTO evidence_items (id,title,file_name,file_type,content,imported_at,folder_id,created_at,updated_at)
      VALUES ('evidence','Fictional evidence','fixture.txt','text',${marker},1700000000000,'shared',now(),now())`;
    await database.sql`INSERT INTO posts (id,author_id,content,folder_id,parent_id,reply_to_id) VALUES
      ('post','owner','Fictional case discussion','shared',null,null),
      ('legacy-reply','editor','Fictional older unscoped reply',null,'post','post'),
      ('legacy-empty-reply','editor','Fictional older empty-scope reply','','legacy-reply','legacy-reply'),
      ('foreign-post','outside-admin','Unrelated discussion','unrelated','post','legacy-empty-reply')`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji) VALUES
      ('reaction','legacy-reply','reader','ok'),('empty-reaction','legacy-empty-reply','reader','ok')`;
    await database.sql`INSERT INTO notifications (id,user_id,type,post_id,message,folder_id) VALUES
      ('notification','reader','mention','post','Fictional notification','shared'),
      ('legacy-notification','reader','reply','legacy-reply','Fictional older notification',null),
      ('empty-notification','reader','reply','legacy-empty-reply','Fictional older empty-scope notification','')`;
    await database.sql`INSERT INTO agent_actions (id,investigation_id,tool_name,status) VALUES ('action','shared','fixture_review','rejected')`;
    await database.sql`INSERT INTO agent_heartbeats (folder_id,user_id,server_takeover_at) VALUES ('shared','owner',now())`;
    blob = `${database.name}-file.txt`; thumbnail = `${database.name}-thumbnail.txt`; unrelatedBlob = `${database.name}-unrelated.txt`;
    paths = [blob, thumbnail, unrelatedBlob].map(path => join(directory, path));
    await Promise.all(paths.map(path => writeFile(path, 'Only synthetic local bytes.')));
    await database.sql`INSERT INTO files (id,uploaded_by,filename,mime_type,size_bytes,storage_path,thumbnail_path,folder_id) VALUES
      ('file','owner','fixture.txt','text/plain',26,${blob},${thumbnail},'shared'),
      ('other-file','outside-admin','unrelated.txt','text/plain',26,${unrelatedBlob},null,'unrelated')`;
    app = new Hono(); app.route('/investigations', userRoutes); app.route('/admin', adminRoutes);
    app.onError((_error, context) => context.json({ error: 'Test request failed without committing' }, 500));
    userHeaders = { Authorization: `Bearer ${(await createTokenPair('owner')).accessToken}`, 'Content-Type': 'application/json' };
    adminHeaders = { Authorization: `Bearer ${await signAdminToken('administrator', 'fictional-admin', 'fictional-admin-hash')}`,
      'Content-Type': 'application/json' };
  });
  afterEach(async () => {
    state.inspectCleanup = undefined;
    await database?.close();
    for (const path of paths.splice(0)) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  });
  afterAll(async () => { vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function snapshot() {
    const result: Record<string, readonly unknown[]> = {};
    for (const table of [...retainedTables, 'folders', 'posts', 'reactions', 'notifications', 'files',
      'investigation_members', 'agent_actions', 'agent_heartbeats', 'sync_clock', 'sync_changes', 'activity_log']) {
      const key = table === 'agent_heartbeats' ? 'folder_id' : table === 'sync_changes' ? 'cursor' : 'id';
      result[table] = await database.sql`SELECT * FROM ${database.sql(table)} ORDER BY ${database.sql(key)}`;
    }
    return result;
  }
  async function assertPurgeCommitted() {
    expect(await database.sql`SELECT id FROM folders WHERE id='shared'`).toEqual([]);
    for (const table of retainedTables) expect(await database.sql`SELECT id FROM ${database.sql(table)} WHERE folder_id='shared'`).toEqual([]);
    for (const table of ['investigation_members', 'files', 'notifications']) {
      expect(await database.sql`SELECT id FROM ${database.sql(table)} WHERE folder_id='shared'`).toEqual([]);
    }
    expect(await database.sql`SELECT id FROM posts WHERE id IN ('post','legacy-reply','legacy-empty-reply')`).toEqual([]);
    expect(await database.sql`SELECT id FROM reactions WHERE post_id IN ('legacy-reply','legacy-empty-reply')`).toEqual([]);
    expect(await database.sql`SELECT id FROM notifications WHERE id IN ('legacy-notification','empty-notification')`).toEqual([]);
    expect(await database.sql`SELECT id FROM agent_actions WHERE investigation_id='shared'`).toEqual([]);
    expect(await database.sql`SELECT folder_id FROM agent_heartbeats WHERE folder_id='shared'`).toEqual([]);
    expect((await database.sql`SELECT content,parent_id,reply_to_id FROM posts WHERE id='foreign-post'`)[0])
      .toEqual({ content: 'Unrelated discussion', parent_id: null, reply_to_id: null });
    expect((await database.sql`SELECT content FROM notes WHERE id='other-note'`)[0].content).toBe('Must remain');
    expect(await readFile(join(directory, unrelatedBlob), 'utf8')).toBe('Only synthetic local bytes.');
  }

  it('requires a current owner for folder soft-delete and restoration, not editor or unrelated server admin', async () => {
    const before = await snapshot();
    for (const userId of ['editor', 'outside-admin']) {
      const [result] = await processPush([{ table: 'folders', entityId: 'shared', op: 'delete', clientVersion: 1 }], userId, { authorize: true });
      expect(result.status).toBe('rejected');
    }
    expect(await snapshot()).toEqual(before);
    const [deleted] = await processPush([{ table: 'folders', entityId: 'shared', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true });
    expect(deleted).toMatchObject({ status: 'accepted', serverVersion: 2 });
    for (const userId of ['editor', 'outside-admin']) {
      const [result] = await processPush([{ table: 'folders', entityId: 'shared', op: 'put', clientVersion: 2, data: { name: 'Fictional retained case' } }], userId, { authorize: true });
      expect(result.status).toBe('rejected');
    }
    expect((await database.sql`SELECT deleted_at FROM folders WHERE id='shared'`)[0].deleted_at).not.toBeNull();
    const [restored] = await processPush([{ table: 'folders', entityId: 'shared', op: 'put', clientVersion: 2, data: { name: 'Fictional retained case' } }], 'owner', { authorize: true });
    expect(restored).toMatchObject({ status: 'accepted', serverVersion: 3, serverRecord: { deletedAt: null } });
  });

  it('hides retained children behind minimal tombstones and republishes only live children after restore', async () => {
    const before = await snapshot();
    const initial = await pullCursorChanges('0', 'reader');
    expect(initial.changes).toContainEqual(expect.objectContaining({ id: 'note', content: marker }));
    await processPush([{ table: 'folders', entityId: 'shared', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true });
    expect(await checkInvestigationAccess('reader', 'shared')).toBe(false);
    expect(await getSnapshot('shared')).toEqual({});
    for (const metadataOnly of [false, true]) {
      const cursor = await pullCursorChanges(initial.cursor, 'reader', { metadataOnly });
      expect(cursor.changes).toContainEqual({ table: 'notes', op: 'delete', id: 'note', version: 1 });
      expect(cursor.changes.every(row => row.op === 'delete' && Object.keys(row).sort().join(',') === 'id,op,table,version')).toBe(true);
      expect(JSON.stringify(cursor)).not.toContain(marker);
      const legacy = await pullChanges('2000-01-01T00:00:00Z', ['shared'], { metadataOnly });
      expect(legacy.changes.every(row => row.op === 'delete' && Object.keys(row).sort().join(',') === 'id,op,table')).toBe(true);
      expect(JSON.stringify(legacy)).not.toContain(marker);
    }
    for (const table of retainedTables) expect((await snapshot())[table]).toEqual(before[table]);
    expect(await readFile(join(directory, blob), 'utf8')).toBe('Only synthetic local bytes.');
    const hiddenCursor = (await pullCursorChanges(initial.cursor, 'reader')).cursor;
    await processPush([{ table: 'folders', entityId: 'shared', op: 'put', clientVersion: 2, data: { name: 'Fictional retained case' } }], 'owner', { authorize: true });
    const visible = await pullCursorChanges(hiddenCursor, 'reader');
    expect(visible.changes).toContainEqual(expect.objectContaining({ table: 'notes', id: 'note', op: 'put', content: marker, version: 2 }));
    expect(visible.changes).toContainEqual(expect.objectContaining({ table: 'evidenceItems', id: 'evidence', op: 'put', content: marker }));
    expect(visible.changes.some(row => row.id === 'independent-tombstone' && row.op === 'put')).toBe(false);
    expect((await database.sql`SELECT deleted_at FROM notes WHERE id='independent-tombstone'`)[0].deleted_at).not.toBeNull();
    expect(await checkInvestigationAccess('reader', 'shared')).toBe(true);
    expect((await getSnapshot('shared')).notes).toContainEqual(expect.objectContaining({ id: 'note', content: marker }));
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it.each(['user', 'admin'] as const)('uses the same complete committed purge through the %s route', async actor => {
    state.inspectCleanup = assertPurgeCommitted;
    const response = await app.request(actor === 'user' ? '/investigations/shared' : '/admin/api/investigations/shared/content', {
      method: 'DELETE', headers: actor === 'user' ? userHeaders : adminHeaders,
      ...(actor === 'admin' ? { body: JSON.stringify({ confirmName: 'Fictional retained case' }) } : {}),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, cleanupPending: 0 });
    expect(state.cleanup).toHaveBeenCalledTimes(1);
    expect(state.revoke).toHaveBeenCalledOnce();
    await assertPurgeCommitted();
    await expect(readFile(join(directory, blob))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(directory, thumbnail))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back child removals and clock changes on an ordinary constraint failure before any blob cleanup', async () => {
    await database.sql`CREATE TABLE lifecycle_purge_guard (folder_id text REFERENCES folders(id))`;
    await database.sql`INSERT INTO lifecycle_purge_guard VALUES ('shared')`;
    const before = await snapshot();
    const failed = await app.request('/investigations/shared', { method: 'DELETE', headers: userHeaders });
    expect(failed.status).toBe(500);
    expect(await snapshot()).toEqual(before);
    expect(state.cleanup).not.toHaveBeenCalled(); expect(state.revoke).not.toHaveBeenCalled();
    expect(await readFile(join(directory, blob), 'utf8')).toBe('Only synthetic local bytes.');
    expect(await readFile(join(directory, thumbnail), 'utf8')).toBe('Only synthetic local bytes.');
    await database.sql`DROP TABLE lifecycle_purge_guard`;
    expect((await app.request('/investigations/shared', { method: 'DELETE', headers: userHeaders })).status).toBe(200);
    await assertPurgeCommitted();
  });

  it('rejects an incorrect administrative confirmation and inactive administrator without deleting data', async () => {
    const before = await snapshot();
    const wrongName = await app.request('/admin/api/investigations/shared/content', { method: 'DELETE', headers: adminHeaders,
      body: JSON.stringify({ confirmName: 'Another fictional case' }) });
    expect(wrongName.status).toBe(400);
    await database.sql`UPDATE admin_users SET active=false WHERE id='administrator'`;
    await expect(purgeInvestigation({ actor: { kind: 'admin', userId: 'administrator' }, folderId: 'shared', confirmName: 'Fictional retained case' }))
      .rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it('rechecks current ownership when a purge waits behind a membership transaction', async () => {
    let release!: () => void; let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const prior = database.sql.begin(async transaction => {
      await transaction`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      await transaction`DELETE FROM investigation_members WHERE folder_id='shared' AND user_id='owner'`;
      acquired(); await held;
    });
    let request: Promise<Response> | undefined;
    try {
      await locked;
      request = Promise.resolve(app.request('/investigations/shared', { method: 'DELETE', headers: userHeaders }));
      await vi.waitFor(async () => {
        const waiting = await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 5_000 });
    } finally { release(); await prior; }
    expect((await request!).status).toBe(403);
    expect((await database.sql`SELECT content FROM notes WHERE id='note'`)[0].content).toBe(marker);
    expect(state.cleanup).not.toHaveBeenCalled(); expect(state.revoke).not.toHaveBeenCalled();
    expect(await readFile(join(directory, blob), 'utf8')).toBe('Only synthetic local bytes.');
  });

  it('preserves an investigation restored after retention selected its old tombstone', async () => {
    await database.sql`UPDATE folders SET deleted_at='2000-01-01' WHERE id='shared'`;
    const [candidate] = await database.sql`SELECT id,version FROM folders WHERE deleted_at<'2020-01-01'`;
    expect(candidate.id).toBe('shared');
    expect((await processPush([{ table: 'folders', entityId: 'shared', op: 'put', clientVersion: candidate.version,
      data: { name: 'Fictional retained case' } }], 'owner', { authorize: true }))[0].status).toBe('accepted');
    expect(await purgeExpiredInvestigation(candidate.id, new Date('2020-01-01'))).toBeNull();
    expect((await database.sql`SELECT content FROM evidence_items WHERE id='evidence'`)[0].content).toBe(marker);
    expect(await readFile(join(directory, blob), 'utf8')).toBe('Only synthetic local bytes.');
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it('includes evidence and retained references in retention purge before removing managed bytes', async () => {
    await database.sql`UPDATE folders SET deleted_at='2000-01-01' WHERE id='shared'`;
    const purged = await purgeExpiredInvestigation('shared', new Date('2020-01-01'));
    expect(purged?.deleted.evidenceItems).toBe(1);
    expect(purged?.folderFiles).toEqual([{ storagePath: blob, thumbnailPath: thumbnail }]);
    await assertPurgeCommitted();
    expect(await readFile(join(directory, blob), 'utf8')).toBe('Only synthetic local bytes.');
    state.inspectCleanup = assertPurgeCommitted;
    expect(await removeCommittedBlobs(directory, purged!.folderFiles)).toBe(0);
    await expect(readFile(join(directory, blob))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
