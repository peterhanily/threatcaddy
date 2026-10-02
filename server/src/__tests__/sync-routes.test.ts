import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
const mocks = vi.hoisted(() => ({
  push: vi.fn(), pull: vi.fn(), cursor: vi.fn(), snapshot: vi.fn(), access: vi.fn(), broadcast: vi.fn(), audit: vi.fn(),
  user: { id: 'user-1', role: 'analyst' } as { id: string; role: string } | null,
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    if (!mocks.user) return c.json({ error: 'Unauthorized' }, 401);
    c.set('user', mocks.user); return next();
  },
  requireRole: (...roles: string[]) => async (c: { get: (key: string) => { role: string }; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) =>
    roles.includes(c.get('user').role) ? next() : c.json({ error: 'Forbidden' }, 403),
}));
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: mocks.access }));
vi.mock('../services/sync-service.js', () => ({
  processPush: mocks.push, pullChanges: mocks.pull, pullCursorChanges: mocks.cursor, getSnapshot: mocks.snapshot,
  SyncWriteValidationError: class extends Error {},
  SyncReadError: class extends Error {
    constructor(message: string, public status: number, public resetRequired = false) { super(message); }
  },
}));
vi.mock('../services/audit-service.js', () => ({ logActivityBatch: mocks.audit }));
vi.mock('../ws/handler.js', () => ({ broadcastToFolder: mocks.broadcast }));
vi.mock('../db/index.js', () => ({ db: { select: () => ({ from: () => ({ where: async () => [{ folderId: 'folder-1' }] }) }) } }));

import syncRoutes from '../routes/sync.js';
import { SyncReadError, SyncWriteValidationError } from '../services/sync-service.js';
const app = new Hono().route('/api/sync', syncRoutes);
const put = { table: 'notes', op: 'put', entityId: 'note-1', clientVersion: 3, data: { title: 'Edited', folderId: 'folder-1' } };
const record = { id: 'note-1', title: 'Edited', folderId: 'folder-1', version: 4 };
function push(changes: unknown) {
  return app.request('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes, generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.user = { id: 'user-1', role: 'analyst' };
  mocks.access.mockResolvedValue(true);
  mocks.push.mockResolvedValue([{ table: 'notes', entityId: 'note-1', status: 'accepted', serverVersion: 4, serverRecord: record }]);
  mocks.pull.mockResolvedValue({ changes: [], serverTimestamp: '2026-01-01T00:00:00Z' });
});

describe('sync HTTP write boundary', () => {
  it('requires authentication and a server write role', async () => {
    mocks.user = null; expect((await push([put])).status).toBe(401);
    mocks.user = { id: 'viewer', role: 'viewer' }; expect((await push([put])).status).toBe(403);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([null, {}, [{ ...put, op: 'unknown' }], [put, put], [{ ...put, clientVersion: -1 }], [{ ...put, data: undefined }], Array.from({ length: 501 }, (_, index) => ({ ...put, entityId: String(index) }))])('rejects invalid or ambiguous batches before service writes', async changes => {
    expect((await push(changes)).status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('accepts an empty batch without a transaction', async () => {
    expect(await (await push([])).json()).toEqual({ results: [] });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('delegates current authorization and revisions to the write transaction', async () => {
    expect((await push([put])).status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith([put], 'user-1', { authorize: true, generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(mocks.broadcast).toHaveBeenCalledWith('folder-1', expect.objectContaining({ type: 'entity-change', data: record }), 'user-1');
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it('does not enable internal trust from request fields', async () => {
    await push([{ ...put, trustedInternal: true }]);
    expect(mocks.push).toHaveBeenCalledWith([put], 'user-1', { authorize: true, generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });

  it('returns a clear validation failure when a field exceeds sync limits', async () => {
    mocks.push.mockRejectedValue(new SyncWriteValidationError('Sync field content exceeds the supported value limits'));
    const response = await push([put]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Sync field content exceeds the supported value limits' });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'rejected'])('does not broadcast or audit a %s result', async status => {
    mocks.push.mockResolvedValue([{ table: 'notes', entityId: 'note-1', status }]);
    expect((await push([put])).status).toBe(200);
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('sends a removal to the previous folder and confirmed data only to the destination', async () => {
    mocks.push.mockResolvedValue([{ table: 'notes', entityId: 'note-1', status: 'accepted', serverRecord: record, previousFolderId: 'previous-folder' }]);
    await push([put]);
    expect(mocks.broadcast.mock.calls[0]).toEqual(['previous-folder', { type: 'entity-change', table: 'notes', op: 'delete', entityId: 'note-1', updatedBy: 'user-1' }, 'user-1']);
    expect(mocks.broadcast.mock.calls[1][0]).toBe('folder-1');
    expect(mocks.broadcast.mock.calls[1][1].data).toEqual(record);
  });

  it('broadcasts folder changes to their own subscribers', async () => {
    mocks.push.mockResolvedValue([{ table: 'folders', entityId: 'folder-1', status: 'accepted', serverRecord: { id: 'folder-1', version: 2 } }]);
    await push([{ table: 'folders', entityId: 'folder-1', op: 'put', clientVersion: 1, data: { name: 'Renamed' } }]);
    expect(mocks.broadcast.mock.calls[0][0]).toBe('folder-1');
  });
});

describe('sync HTTP read boundary', () => {
  it('passes the authenticated identity and explicit page scope to cursor reads', async () => {
    const page = { changes: [], cursor: '42', hasMore: false, serverTimestamp: '2026-01-01' };
    mocks.cursor.mockResolvedValue(page);
    const response = await app.request('/api/sync/pull?cursor=12&limit=50&folderId=folder-1&metadataOnly=true');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(page);
    expect(mocks.cursor).toHaveBeenCalledWith('12', 'user-1', { limit: 50, folderId: 'folder-1', metadataOnly: true });
  });

  it('returns an explicit reset instruction for a future cursor', async () => {
    mocks.cursor.mockRejectedValue(new SyncReadError('Restart synchronization', 409, true));
    const response = await app.request('/api/sync/pull?cursor=99');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SYNC_CURSOR_RESET', resetRequired: true });
  });

  it('retains full-resync compatibility for a timestamp-only client', async () => {
    expect((await app.request('/api/sync/pull?since=2026-01-01')).status).toBe(200);
    expect(mocks.pull).toHaveBeenCalledWith('2026-01-01', ['folder-1'], undefined);
  });

  it.each(['0', '-1', '1001', 'not-a-number'])('rejects invalid page limit %s', async limit => {
    expect((await app.request('/api/sync/pull?cursor=0&limit=' + limit)).status).toBe(400);
    expect(mocks.cursor).not.toHaveBeenCalled();
  });

  it('requires a cursor or a legacy timestamp', async () => {
    expect((await app.request('/api/sync/pull')).status).toBe(400);
  });

  it('requires investigation membership for snapshots and legacy scoped reads', async () => {
    mocks.access.mockResolvedValue(false);
    expect((await app.request('/api/sync/snapshot/folder-1')).status).toBe(403);
    expect((await app.request('/api/sync/pull?since=2026-01-01&folderId=folder-1')).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('returns an authorized snapshot', async () => {
    mocks.snapshot.mockResolvedValue({ notes: [record] });
    const response = await app.request('/api/sync/snapshot/folder-1');
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ notes: [record] });
  });
});
