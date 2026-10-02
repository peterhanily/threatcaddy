import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { disableSync, revisionKey } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { prepareSyncRecovery, reconcileSyncWorkspace, restoreSyncRecovery } from '../lib/sync-recovery';
import { decryptBackup } from '../lib/backup-crypto';
const api = vi.hoisted(() => ({ pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({ syncPull: api.pull }));
const password = 'a separate recovery phrase';
const identity = { version: 1, serverUrl: 'https://team.example', userId: 'alice' };
const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const confirmed = { backupSaved: true, reconcileConfirmed: true };
const note = { id: 'n', title: 'Local work', content: 'Preserved', folderId: 'f', tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  disableSync(); setSessionKey(null); localStorage.clear();
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f', name: 'Shared', order: 0, createdAt: 1 });
  await db.notes.add(note);
  await db.table('_syncMeta').bulkPut([
    { key: 'syncWorkspaceIdentityV1', value: identity },
    { key: 'syncRecoveryRequiredV2', value: true },
    { key: revisionKey('notes', 'n'), value: 27 },
  ]);
  await db.table('_syncQueue').add({ table: 'notes', entityId: 'deleted', folderId: 'f', op: 'delete', clientVersion: 8 });
  localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: identity.serverUrl, accessToken: 'synthetic', refreshToken: 'synthetic-refresh', user: { id: identity.userId, displayName: 'Alice', email: 'alice@example.invalid', role: 'analyst' } }));
  api.pull.mockReset().mockResolvedValue({ changes: [], cursor: '99', generation });
});
afterEach(() => { disableSync(); localStorage.clear(); });

describe('explicit sync recovery', () => {
  it('roundtrip-verifies an encrypted all-store archive including pending deletes and original revisions', async () => {
    const receipt = await prepareSyncRecovery(password);
    expect(JSON.stringify(receipt.blob)).not.toContain('Preserved');
    const archive = await decryptBackup<{ data: Record<string, unknown[]> }>(password, receipt.blob);
    expect(archive.data.notes).toEqual([note]);
    expect(archive.data._syncQueue).toEqual([expect.objectContaining({ op: 'delete', clientVersion: 8 })]);
    expect(archive.data._syncMeta).toContainEqual({ key: revisionKey('notes', 'n'), value: 27 });
  });
  it('retains every local entity and pending delete, but requires fresh revision review before overwrite', async () => {
    const receipt = await prepareSyncRecovery(password);
    await reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed);
    expect(await db.notes.get('n')).toEqual(note);
    expect(await db.table('_syncQueue').toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'deleted', op: 'delete', clientVersion: 0 }),
      expect.objectContaining({ entityId: 'n', op: 'put', clientVersion: 0, data: note }),
    ]));
    expect(await db.table('_syncMeta').get(revisionKey('notes', 'n'))).toBeUndefined();
    expect(await db.table('_syncMeta').get('syncHistoryGenerationV1')).toMatchObject({ value: generation });
    expect(await db.table('_syncMeta').get('syncCursorV2')).toMatchObject({ value: '0' });
    expect(await db.table('_syncMeta').get('syncRecoveryRequiredV2')).toMatchObject({ value: false });
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('Download');
  });
  it('requires a verified receipt and both confirmations', async () => {
    const receipt = await prepareSyncRecovery(password);
    await expect(reconcileSyncWorkspace({ ...receipt }, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('Download');
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, { ...confirmed, backupSaved: false })).rejects.toThrow('Download');
    expect(api.pull).not.toHaveBeenCalled();
  });
  it('refuses any local mutation after backup without rebasing queued work', async () => {
    const receipt = await prepareSyncRecovery(password);
    await db.notes.update('n', { title: 'A later edit' });
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('changed after backup');
    expect((await db.table('_syncQueue').toArray())[0].clientVersion).toBe(8);
  });
  it('refuses another account or a sign-out during the server handshake', async () => {
    const receipt = await prepareSyncRecovery(password);
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, 'bob', confirmed)).rejects.toThrow('account changed');
    api.pull.mockImplementationOnce(async () => { localStorage.removeItem('threatcaddy-auth'); return { generation }; });
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('account changed');
    expect((await db.table('_syncQueue').toArray())[0].clientVersion).toBe(8);
  });
  it('never changes a foreign durable workspace binding even after explicit confirmation', async () => {
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { ...identity, userId: 'bob' } });
    const receipt = await prepareSyncRecovery(password);
    await expect(reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, confirmed)).rejects.toThrow('another account');
    expect(await db.table('_syncMeta').get('syncWorkspaceIdentityV1')).toMatchObject({ value: { userId: 'bob' } });
  });
  it('restores the archive only into an empty workspace and leaves sync paused', async () => {
    await db.folders.update('f', { agentEnabled: true });
    const receipt = await prepareSyncRecovery(password);
    await expect(restoreSyncRecovery(password, receipt.blob, true)).rejects.toThrow('empty workspace');
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
    expect(await restoreSyncRecovery(password, receipt.blob, true)).toBe(receipt.records);
    expect(await db.notes.get('n')).toEqual(note);
    expect(await db.folders.get('f')).toMatchObject({ agentEnabled: false, agentStatus: 'paused' });
    expect((await db.table('_syncQueue').toArray())[0].clientVersion).toBe(8);
    expect(await db.table('_syncMeta').get('syncRecoveryRequiredV2')).toMatchObject({ value: true });
  });
});
