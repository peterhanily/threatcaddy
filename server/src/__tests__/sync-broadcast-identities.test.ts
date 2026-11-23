/**
 * Push broadcasts: an identity change reaches every subscriber of its investigation, 2.0.4 clients
 * included, so it is announced without its record (no client reads `data`; they pull instead).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
const mocks = vi.hoisted(() => ({
  push: vi.fn(), broadcast: vi.fn(), audit: vi.fn(),
  user: { id: 'user-1', role: 'analyst' } as { id: string; role: string },
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => { c.set('user', mocks.user); return next(); },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: vi.fn(async () => true) }));
vi.mock('../services/sync-service.js', () => ({
  processPush: mocks.push, pullChanges: vi.fn(), pullCursorChanges: vi.fn(), getSnapshot: vi.fn(), clientSyncTables: vi.fn(),
  SyncWriteValidationError: class extends Error {}, SyncReadError: class extends Error {},
}));
vi.mock('../services/audit-service.js', () => ({ logActivityBatch: mocks.audit }));
vi.mock('../ws/handler.js', () => ({ broadcastToFolder: mocks.broadcast }));
vi.mock('../db/index.js', () => ({ db: {} }));

import syncRoutes from '../routes/sync.js';
const app = new Hono().route('/api/sync', syncRoutes);


const SECRET = '+44 7700 900123';
const push = (table: string, serverRecord: Record<string, unknown>) => {
  mocks.push.mockResolvedValue([{ table, entityId: 'id-1', status: 'accepted', serverVersion: 2, serverRecord }]);
  return app.request('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      changes: [{ table, op: 'put', entityId: 'id-1', clientVersion: 1, data: { title: 'x', folderId: 'folder-1' } }] }) });
};

beforeEach(() => { vi.resetAllMocks(); });

describe('push broadcasts', () => {
  it('announce an identity change without its record, so no subscriber (a 2.0.4 client) receives private details', async () => {
    const record = { id: 'id-1', folderId: 'folder-1', name: 'Dana', type: 'person', version: 2,
      details: [{ id: 'd', label: 'Phone', value: SECRET, private: true }] };
    expect((await push('identities', record)).status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledWith('folder-1',
      { type: 'entity-change', table: 'identities', op: 'put', entityId: 'id-1', updatedBy: 'user-1' }, 'user-1');
    expect(JSON.stringify(mocks.broadcast.mock.calls)).not.toContain(SECRET);
  });

  it('keep the record on other tables, as before', async () => {
    const record = { id: 'id-1', folderId: 'folder-1', title: 'x', version: 2 };
    expect((await push('notes', record)).status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledWith('folder-1', expect.objectContaining({ table: 'notes', data: record }), 'user-1');
  });

  it('log an identity change without the person\'s name (the activity log is read by every member and outlives a deletion)', async () => {
    const record = { id: 'id-1', folderId: 'folder-1', name: 'Dana Okafor', type: 'person', version: 2, details: [] };
    expect((await push('identities', record)).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith([expect.objectContaining({ category: 'identities', itemId: 'id-1', itemTitle: undefined, folderId: 'folder-1' })]);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('Dana Okafor');
    await push('notes', { id: 'id-1', folderId: 'folder-1', title: 'Weekly notes', version: 2 });
    expect(mocks.audit).toHaveBeenLastCalledWith([expect.objectContaining({ category: 'notes', itemTitle: 'Weekly notes' })]);
  });

  it('announce and log nothing for a change the server accepted without a write (the row already was as asked)', async () => {
    mocks.push.mockResolvedValue([{ table: 'notes', entityId: 'id-1', status: 'accepted', serverVersion: 4, unchanged: true }]);
    const response = await app.request('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', changes: [{ table: 'notes', op: 'delete', entityId: 'id-1', clientVersion: 1 }] }) });
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([expect.objectContaining({ status: 'accepted', serverVersion: 4, unchanged: true })]);
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
