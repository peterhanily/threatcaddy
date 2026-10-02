import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { rotateSyncHistory } from '../src/db/rotate-sync-history.js';
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property]; return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: vi.fn() }));
import { processPush, pullCursorChanges, getSnapshot } from '../src/services/sync-service.js';

describe('sync generation and inline assets in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase(); state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES ('owner','owner@example.invalid','Owner','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('case','Case',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('membership','case','owner','owner')`;
  });
  afterEach(async () => { await database?.close(); });

  it('preserves image evidence and whiteboard files larger than an ordinary request through the durable log and snapshot', async () => {
    const generation = (await pullCursorChanges('0', 'owner')).generation;
    const imageData = 'A'.repeat(1_200_000);
    const files = JSON.stringify({ image: { dataURL: `data:image/png;base64,${imageData}`, mimeType: 'image/png' } });
    const results = await processPush([
      { table: 'evidenceItems', entityId: 'evidence', op: 'put', clientVersion: 0, data: { folderId: 'case', title: 'Source', fileName: 'source.png', fileType: 'image', importedAt: 1, imageData, imageDataMimeType: 'image/png' } },
      { table: 'whiteboards', entityId: 'board', op: 'put', clientVersion: 0, data: { folderId: 'case', name: 'Board', elements: '[]', files } },
    ], 'owner', { authorize: true, generation });
    expect(results.map(result => result.status)).toEqual(['accepted', 'accepted']);
    const page = await pullCursorChanges('0', 'owner', { generation });
    expect(page.changes.find(row => row.id === 'evidence')?.imageData).toBe(imageData);
    expect(page.changes.find(row => row.id === 'board')?.files).toBe(files);
    const snapshot = await getSnapshot('case');
    expect(snapshot.evidenceItems).toEqual([expect.objectContaining({ imageData })]);
    expect(snapshot.whiteboards).toEqual([expect.objectContaining({ files })]);
  });

  it('rejects oversized asset fields transactionally instead of acknowledging truncated content', async () => {
    const before = (await pullCursorChanges('0', 'owner')).cursor;
    await expect(processPush([{ table: 'whiteboards', entityId: 'big', op: 'put', data: { folderId: 'case', name: 'Big', files: ' '.repeat(8 * 1024 * 1024 + 1) } }], 'owner', { authorize: true })).rejects.toThrow('asset limit');
    expect(await database.sql`SELECT id FROM whiteboards`).toEqual([]);
    expect((await pullCursorChanges('0', 'owner')).cursor).toBe(before);
  });

  it('rejects unsupported preview MIME atomically and preserves valid partial updates and removal', async () => {
    const before = (await pullCursorChanges('0', 'owner')).cursor;
    await expect(processPush([
      { table: 'notes', entityId: 'ordinary-note', op: 'put', clientVersion: 0, data: { title: 'Ordinary note', folderId: 'case' } },
      { table: 'evidenceItems', entityId: 'preview', op: 'put', clientVersion: 0, data: { folderId: 'case', title: 'Preview', fileName: 'preview.tiff', fileType: 'image', importedAt: 1, imageData: 'YQ==', imageDataMimeType: 'image/tiff' } },
    ], 'owner', { authorize: true })).rejects.toThrow('MIME type');
    expect(await database.sql`SELECT id FROM notes`).toEqual([]);
    expect(await database.sql`SELECT id FROM evidence_items`).toEqual([]);
    expect((await pullCursorChanges('0', 'owner')).cursor).toBe(before);
    const [created] = await processPush([{ table: 'evidenceItems', entityId: 'preview', op: 'put', clientVersion: 0,
      data: { folderId: 'case', title: 'Preview', fileName: 'preview.png', fileType: 'image', importedAt: 1, imageData: 'YQ==', imageDataMimeType: 'image/png' } }], 'owner', { authorize: true });
    const [updated] = await processPush([{ table: 'evidenceItems', entityId: 'preview', op: 'put', clientVersion: created.serverVersion,
      data: { imageData: 'Yg==' } }], 'owner', { authorize: true });
    expect((await pullCursorChanges(before, 'owner')).changes.find(row => row.id === 'preview')).toMatchObject({ imageData: 'Yg==', imageDataMimeType: 'image/png' });
    await processPush([{ table: 'evidenceItems', entityId: 'preview', op: 'put', clientVersion: updated.serverVersion,
      data: { imageData: null, imageDataMimeType: null } }], 'owner', { authorize: true });
    expect((await pullCursorChanges(before, 'owner')).changes.find(row => row.id === 'preview')).toMatchObject({ imageData: null, imageDataMimeType: null });
  });

  it('bounds cursor pages by stored bytes while preserving numeric order and progress', async () => {
    const files = JSON.stringify({ image: { dataURL: `data:image/png;base64,${'A'.repeat(6_000_000)}` } });
    for (let index = 0; index < 4; index++) await processPush([{ table: 'whiteboards', entityId: `board-${index}`, op: 'put', data: { folderId: 'case', name: 'Board', files } }], 'owner', { authorize: true });
    const first = await pullCursorChanges('0', 'owner');
    expect(first.hasMore).toBe(true);
    expect(first.changes.filter(row => row.table === 'whiteboards')).toHaveLength(2);
    const second = await pullCursorChanges(first.cursor, 'owner', { generation: first.generation });
    expect(second.hasMore).toBe(false);
    expect(second.changes.filter(row => row.table === 'whiteboards')).toHaveLength(2);
    expect(BigInt(second.cursor)).toBeGreaterThan(BigInt(first.cursor));
  });

  it('preserves IOC enrichment provenance through an accepted write and durable pull', async () => {
    const enrichment = { stix: [{ object: { type: 'indicator', id: 'indicator--aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', object_marking_refs: ['marking-definition--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] }, markings: [{ type: 'marking-definition', definition: { statement: 'Synthetic handling restriction' } }] }] };
    await processPush([{ table: 'standaloneIOCs', entityId: 'ioc', op: 'put', data: { folderId: 'case', type: 'domain', value: 'example.invalid', enrichment } }], 'owner', { authorize: true });
    expect((await pullCursorChanges('0', 'owner')).changes.find(row => row.id === 'ioc')?.enrichment).toEqual(enrichment);
  });

  it('rotation preserves records and cursors but blocks old-generation reads and writes even at cursor zero', async () => {
    const before = await pullCursorChanges('0', 'owner');
    await expect(rotateSyncHistory(database.sql, false)).rejects.toThrow('Confirm');
    const generation = await rotateSyncHistory(database.sql, true);
    expect(generation).not.toBe(before.generation);
    const after = await pullCursorChanges('0', 'owner', { generation });
    expect(after.changes).toEqual(before.changes);
    expect(after.cursor).toBe(before.cursor);
    await expect(pullCursorChanges('0', 'owner', { generation: before.generation })).rejects.toMatchObject({ resetRequired: true });
    await expect(processPush([{ table: 'notes', entityId: 'n', op: 'put', data: { title: 'Stale', folderId: 'case' } }], 'owner', { authorize: true, generation: before.generation })).rejects.toMatchObject({ resetRequired: true });
    expect(await database.sql`SELECT id FROM notes`).toEqual([]);
  });
});
