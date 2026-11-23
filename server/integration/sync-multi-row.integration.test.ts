/**
 * F3 (DATA-2, DATA-3): changes from several rows, or from several devices, that the server accepts
 * instead of turning into conflicts or permanent rejections.
 * - Deleting an investigation with its items: the items' deletes complete the deletion, in the same
 *   batch or later, whatever their revision; nothing else may write into a deleted investigation.
 * - A change that leaves the row as it is (a delete of a deleted row, a put equal to the stored row,
 *   as when two devices run the same 30-day purge) is accepted without a write or a new revision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, testDatabaseUrl, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: vi.fn() }));

import { processPush, pullCursorChanges, SYNC_TABLE_NAMES, clientSyncTables } from '../src/services/sync-service.js';

testDatabaseUrl(process.env.TEST_DATABASE_URL);
const tables = clientSyncTables(SYNC_TABLE_NAMES.join(','));
const person = (name: string, extra: Record<string, unknown> = {}) => ({ folderId: 'case', type: 'person', name, aliases: [], details: [], connections: [], tags: [], trashed: false, archived: false, ...extra });
const note = (folderId = 'case') => ({ folderId, title: 'Note', content: '', tags: [], trashed: false, archived: false, pinned: false });

describe('multi-row changes the server accepts', () => {
  let database: ScratchDatabase;
  const cursor = async () => (await database.sql`SELECT cursor FROM sync_clock WHERE id = 1`)[0].cursor as bigint;
  const version = async (table: string, id: string) => (await database.sql.unsafe(`SELECT version, deleted_at FROM ${table} WHERE id = $1`, [id]))[0] as unknown as { version: number; deleted_at: Date | null };
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Owner','fixture','analyst'), ('viewer','viewer@example.invalid','Viewer','fixture','analyst')`;
    const created = await processPush([
      { table: 'folders', entityId: 'case', op: 'put', clientVersion: 0, data: { name: 'Case' } },
      { table: 'folders', entityId: 'other', op: 'put', clientVersion: 0, data: { name: 'Other' } },
      { table: 'identities', entityId: 'dana', op: 'put', clientVersion: 0, data: person('Dana', { connections: [{ targetId: 'lee', label: 'manages' }] }) },
      { table: 'identities', entityId: 'lee', op: 'put', clientVersion: 0, data: person('Lee') },
      { table: 'notes', entityId: 'n1', op: 'put', clientVersion: 0, data: note() },
      { table: 'notes', entityId: 'n2', op: 'put', clientVersion: 0, data: note() },
    ], 'owner', { authorize: true });
    expect(created.every(result => result.status === 'accepted')).toBe(true);
    await database.sql`INSERT INTO investigation_members (id, folder_id, user_id, role) VALUES ('m-viewer', 'case', 'viewer', 'viewer')`;
  });
  afterEach(async () => { await database?.close(); });

  it('deletes an investigation with its items in one batch, and an item delete sent later', async () => {
    // A teammate edited Dana since this device last synced: her delete still completes the investigation's deletion.
    expect((await processPush([{ table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana R.') }], 'owner', { authorize: true }))[0].status).toBe('accepted');
    const results = await processPush([
      { table: 'identities', entityId: 'dana', op: 'delete', clientVersion: 1 },
      { table: 'notes', entityId: 'n1', op: 'delete', clientVersion: 1 },
      { table: 'folders', entityId: 'case', op: 'delete', clientVersion: 1 },
    ], 'owner', { authorize: true });
    expect(results.map(r => [r.table, r.status])).toEqual([['identities', 'accepted'], ['notes', 'accepted'], ['folders', 'accepted']]);
    expect((await version('identities', 'dana')).deleted_at).not.toBeNull();
    // The next cycle (an item whose delete was refused before this server version, or sent in a later batch).
    expect((await processPush([{ table: 'notes', entityId: 'n2', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true }))[0].status).toBe('accepted');
  });

  it('still lets nothing else write into a deleted investigation, or a viewer delete in it', async () => {
    expect((await processPush([{ table: 'folders', entityId: 'case', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true }))[0].status).toBe('accepted');
    const refused = await processPush([
      { table: 'notes', entityId: 'n1', op: 'put', clientVersion: 1, data: note() },
      { table: 'notes', entityId: 'n2', op: 'put', clientVersion: 1, data: note('other') },
      { table: 'notes', entityId: 'n3', op: 'put', clientVersion: 0, data: note() },
    ], 'owner', { authorize: true });
    expect(refused.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect((await processPush([{ table: 'identities', entityId: 'lee', op: 'delete', clientVersion: 1 }], 'viewer', { authorize: true }))[0].status).toBe('rejected');
    expect((await version('identities', 'lee')).deleted_at).toBeNull();
  });

  it('accepts a delete of a deleted row, and a put equal to the stored row, without a write or a new revision', async () => {
    // Device A purges Lee and removes Dana's connection to him (Dana v2, Lee deleted at v2).
    const fromA = await processPush([
      { table: 'identities', entityId: 'lee', op: 'delete', clientVersion: 1 },
      { table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana', { connections: [], updatedAt: 1_000 }) },
    ], 'owner', { authorize: true });
    expect(fromA.map(r => r.status)).toEqual(['accepted', 'accepted']);
    const before = await cursor();
    // Device B loaded before pulling and ran the same purge from the older revisions.
    const fromB = await processPush([
      { table: 'identities', entityId: 'lee', op: 'delete', clientVersion: 1 },
      { table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana', { connections: [], updatedAt: 2_000 }) },
    ], 'owner', { authorize: true });
    expect(fromB.map(r => [r.status, r.serverVersion, r.unchanged])).toEqual([['accepted', 2, true], ['accepted', 2, true]]);
    expect(await cursor()).toBe(before);
    expect((await version('identities', 'dana')).version).toBe(2);
  });

  it('compares stored JSON by content, and still conflicts on a real difference or a deleted row', async () => {
    // jsonb keeps its own key order; the same edge written with its keys in another order is the same.
    await processPush([{ table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana', { connections: [{ label: 'manages', targetId: 'lee' }], details: [{ id: 'd1', label: 'Email', value: 'dana@example.invalid', private: false }] }) }], 'owner', { authorize: true });
    const same = await processPush([{ table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana', { connections: [{ targetId: 'lee', label: 'manages' }], details: [{ private: false, value: 'dana@example.invalid', label: 'Email', id: 'd1' }] }) }], 'owner', { authorize: true });
    expect(same.map(r => [r.status, r.unchanged])).toEqual([['accepted', true]]);
    const different = await processPush([{ table: 'identities', entityId: 'dana', op: 'put', clientVersion: 1, data: person('Dana', { status: 'compromised' }) }], 'owner', { authorize: true });
    expect(different.map(r => r.status)).toEqual(['conflict']);
    await processPush([{ table: 'notes', entityId: 'n1', op: 'delete', clientVersion: 1 }], 'owner', { authorize: true });
    // A put equal to a deleted row's content would restore it: that is a real conflict.
    const restore = await processPush([{ table: 'notes', entityId: 'n1', op: 'put', clientVersion: 1, data: note() }], 'owner', { authorize: true });
    expect(restore.map(r => r.status)).toEqual(['conflict']);
    // Every client still receives each real change once.
    const pulled = await pullCursorChanges('0', 'owner', { tables });
    expect(pulled.changes.filter(c => c.table === 'identities' && c.id === 'dana').map(c => c.version)).toEqual([2]);
  });
});
