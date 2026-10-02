import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { evidenceItems } from '../db/schema.js';

const state = vi.hoisted(() => ({ selections: [] as unknown[], deletes: [] as unknown[], failCommit: false, committed: false }));
vi.mock('../middleware/auth.js', () => ({ requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
  c.set('user', { id: 'owner', role: 'analyst' }); await next();
} }));
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: vi.fn().mockResolvedValue(true) }));
vi.mock('../services/notification-service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn() }));
vi.mock('../services/sync-service.js', () => ({ getEntityCounts: vi.fn(), getEntityCountsBatch: vi.fn() }));
vi.mock('../ws/handler.js', () => ({ revokeUserFolderAccess: vi.fn(), revokeFolderAccess: vi.fn(), broadcastToUser: vi.fn() }));
vi.mock('../services/storage-policy.js', () => ({
  lockStorage: vi.fn(),
  removeCommittedBlobs: vi.fn(async () => { expect(state.committed).toBe(true); return 0; }),
}));
vi.mock('../db/index.js', () => {
  function select() {
    const chain: Record<string, unknown> = {};
    for (const key of ['from', 'where', 'limit']) chain[key] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.selections.shift() ?? []).then(resolve);
    return chain;
  }
  return { db: { select, transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const result = await fn({ select, delete: (table: unknown) => ({ where: async () => { state.deletes.push(table); } }) });
    if (state.failCommit) throw new Error('Ordinary simulated commit failure');
    state.committed = true;
    return result;
  } } };
});
import investigations from '../routes/investigations.js';
import { removeCommittedBlobs } from '../services/storage-policy.js';

describe('owner investigation deletion storage lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.selections.length = 0; state.deletes.length = 0; state.failCommit = false; state.committed = false;
    state.selections.push([{ role: 'owner' }], [{ id: 'case', name: 'Ordinary case' }], [{ storagePath: 'retained.pdf', thumbnailPath: null }]);
  });
  function request() { const app = new Hono(); app.route('/investigations', investigations); return app.request('/investigations/case', { method: 'DELETE' }); }
  it('deletes evidence with all content and cleans managed bytes only after commit', async () => {
    expect((await request()).status).toBe(200);
    expect(state.deletes).toContain(evidenceItems);
    expect(removeCommittedBlobs).toHaveBeenCalledOnce();
  });
  it('never removes bytes if the final database commit fails', async () => {
    state.failCommit = true;
    expect((await request()).status).toBe(500);
    expect(state.deletes).toContain(evidenceItems);
    expect(removeCommittedBlobs).not.toHaveBeenCalled();
  });
});
