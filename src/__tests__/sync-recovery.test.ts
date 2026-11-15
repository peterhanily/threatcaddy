import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, runWorkspaceContentMigrations } from '../db';
import { disableSync, revisionKey } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { prepareSyncRecovery, reconcileSyncWorkspace, restoreSyncRecovery } from '../lib/sync-recovery';
import { decryptBackup } from '../lib/backup-crypto';
import { buildFullBackupPayload } from '../lib/backup-data';
import { exportJSON } from '../lib/export';
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
  it('restores pending agent approvals as inert, backup-valid history', async () => {
    const action = { investigationId: 'f', threadId: 't', toolName: 'create_note', toolInput: { title: 'Draft' }, rationale: 'History', createdAt: 1 };
    await db.agentActions.bulkAdd([
      { ...action, id: 'pending', status: 'pending', toolBinding: 'binding', idempotencyKey: 'key-1' },
      { ...action, id: 'approved', status: 'approved', toolBinding: 'binding', idempotencyKey: 'key-2', resultSummary: 'Earlier note' },
      { ...action, id: 'executed', status: 'executed', toolBinding: 'binding', idempotencyKey: 'key-3', resultSummary: 'Done' },
    ]);
    const receipt = await prepareSyncRecovery(password);
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await restoreSyncRecovery(password, receipt.blob, true);
    for (const id of ['pending', 'approved']) {
      const restored = await db.agentActions.get(id);
      expect(restored).toMatchObject({ status: 'rejected', resultSummary: expect.stringContaining('Recovered from archive') });
      expect(restored).not.toHaveProperty('result');
      expect(restored).not.toHaveProperty('toolBinding');
      expect(restored).not.toHaveProperty('idempotencyKey');
    }
    expect(await db.agentActions.get('executed')).toMatchObject({ status: 'executed', toolBinding: 'binding', idempotencyKey: 'key-3', resultSummary: 'Done' });
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(buildFullBackupPayload('investigation', 'f')).resolves.toBeDefined();
    await expect(exportJSON()).resolves.toContain('Recovered from archive');
  });
  it('repairs backup-blocking rows from an older archive even after the one-time repair already ran', async () => {
    // Rows a pre-2.0.1 build wrote: NaN usage, a stamped meeting, a meeting without its thread and an action holding `result`.
    const action = { investigationId: 'f', threadId: 't', toolName: 'create_note', toolInput: { title: 'Draft' }, rationale: 'History', createdAt: 1 };
    await db.chatThreads.add({ id: 't', title: 'Audit', messages: [{ id: 'm', role: 'assistant', content: 'Turn', createdAt: 1, tokenCount: { input: NaN, output: 2 } }],
      model: 'model', provider: 'anthropic', folderId: 'f', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    await db.agentDeployments.add({ id: 'd', investigationId: 'f', profileId: 'p', status: 'idle', order: 0, createdAt: 1, updatedAt: 1,
      metrics: { cyclesRun: 1, toolCallsExecuted: 0, toolCallsProposed: 0, tasksCompleted: 0, tasksRejected: 0, tokensUsed: { input: NaN, output: NaN }, lastCycleAt: 1, costUSD: NaN } });
    await db.table('agentMeetings').bulkAdd([
      { id: 'stamped', investigationId: 'f', participantDeploymentIds: [], threadId: 't', agenda: 'A', status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1, updatedAt: 9 },
      { id: 'threadless', investigationId: 'f', participantDeploymentIds: [], agenda: 'B', status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1 },
    ]);
    await db.table('agentActions').add({ ...action, id: 'old', status: 'rejected', result: 'Recovered from archive' });
    const receipt = await prepareSyncRecovery(password);
    // A fresh workspace on this build has already recorded the one-time repair.
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await runWorkspaceContentMigrations();
    expect(await db.table('_localMigrations').get('backup-integrity-v1')).toBeDefined();
    await restoreSyncRecovery(password, receipt.blob, true);
    expect((await db.agentDeployments.get('d'))?.metrics).toMatchObject({ tokensUsed: { input: 0, output: 0 }, costUSD: 0 });
    expect((await db.chatThreads.get('t'))?.messages[0].tokenCount).toEqual({ input: 0, output: 2 });
    expect(await db.agentMeetings.get('stamped')).not.toHaveProperty('updatedAt');
    expect(await db.agentMeetings.get('threadless')).toMatchObject({ threadId: '' });
    expect(await db.agentActions.get('old')).toMatchObject({ resultSummary: 'Recovered from archive' });
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(exportJSON()).resolves.toContain('threatcaddy-backup');
  });
});
