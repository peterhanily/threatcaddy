import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { previewRestore, restoreFullReplace, restoreMerge } from '../lib/backup-restore';
import { exportInvestigationJSON, exportJSON, importJSON, mergeImportJSON } from '../lib/export';
import { disableSync, revisionKey, suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { assertSyncCaptureReady, getSyncPauseReason, SYNC_CAPTURE_KEY, SYNC_HISTORY_MESSAGE, SYNC_RECOVERY_KEY } from '../lib/sync-capture-policy';
import { SyncEngine } from '../lib/sync-engine';
import { prepareSyncRecovery, reconcileSyncWorkspace } from '../lib/sync-recovery';
import i18n from '../i18n';
import settingsDe from '../../public/locales/de/settings.json';

const api = vi.hoisted(() => ({ pull: vi.fn(), push: vi.fn() }));
vi.mock('../lib/server-api', () => ({ syncPull: api.pull, syncPush: api.push }));

const identity = { version: 1, serverUrl: 'https://team.example', userId: 'alice' };
const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const note = (id: string, title = 'Original', folderId = 'f1') => ({ id, folderId, title, content: 'Body', tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const engines: SyncEngine[] = [];

async function clean() {
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
  });
}
/** A teammate's change arrives the way a pull applies it: uncaptured, with a new revision. */
async function pulled(write: () => Promise<unknown>, revisions: [string, string, number][]) {
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    await write();
    for (const [table, id, value] of revisions) await db.table('_syncMeta').put({ key: revisionKey(table, id), value });
  });
}
async function boundWorkspace() {
  await ensureSyncWorkspace(identity.serverUrl, identity.userId);
  await pulled(async () => {
    await db.folders.bulkAdd([{ id: 'f1', name: 'Shared case', order: 0, createdAt: 1 }, { id: 'f2', name: 'Second case', order: 1, createdAt: 1 }]);
    await db.notes.bulkAdd([note('n1'), note('n2'), note('nB', 'Other case', 'f2')]);
  }, [['folders', 'f1', 1], ['folders', 'f2', 1], ['notes', 'n1', 1], ['notes', 'n2', 1], ['notes', 'nB', 1]]);
  await db.table('_syncMeta').bulkPut([{ key: 'syncHistoryGenerationV1', value: generation }, { key: 'syncCursorV2', value: '5' }, { key: 'initialPushDoneV2', value: true }]);
}
async function teammateChanges() {
  await pulled(async () => {
    await db.notes.update('n1', { title: 'Teammate edit', updatedAt: 2 });
    await db.notes.add(note('n3', 'Teammate note'));
    await db.notes.delete('n2');
  }, [['notes', 'n1', 2], ['notes', 'n3', 1], ['notes', 'n2', 3]]);
}
async function expectPausedWithoutQueuedChanges() {
  expect(await db.table('_syncQueue').toArray()).toEqual([]);
  expect(await db.table('_syncMeta').get(SYNC_RECOVERY_KEY)).toMatchObject({ value: true });
  expect(await db.table('_localMigrations').get(SYNC_CAPTURE_KEY)).toMatchObject({ state: 'reconciliation-required', reason: 'restored-history' });
  // The banner names the restore cause, not the legacy signed-out capture gap.
  expect(await getSyncPauseReason(db)).toBe('history');
  await expect(assertSyncCaptureReady(db)).rejects.toThrow(SYNC_HISTORY_MESSAGE);
}

beforeEach(async () => {
  disableSync(); localStorage.clear();
  await clean();
  api.pull.mockReset().mockImplementation(async (_since: string, _folder: string, cursor?: string) => ({ changes: [], cursor: cursor ?? '0', generation, hasMore: false }));
  api.push.mockReset().mockResolvedValue({ results: [] });
});
afterEach(() => { engines.splice(0).forEach(engine => engine.stop()); disableSync(); localStorage.clear(); });

describe('restoring a backup in a team-bound workspace', () => {
  it('Replace All queues no deletes or rollbacks and pauses sync for reconciliation', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await teammateChanges();
    await importJSON(backup);
    expect((await db.notes.toArray()).map(row => [row.id, row.title]).sort()).toEqual([['n1', 'Original'], ['n2', 'Original'], ['nB', 'Other case']]);
    await expectPausedWithoutQueuedChanges();
  });

  it('Merge does not resurrect a teammate deletion on the server', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await teammateChanges();
    await mergeImportJSON(backup);
    expect(await db.notes.get('n2')).toBeDefined();
    await expectPausedWithoutQueuedChanges();
  });

  it('a Server Encrypted Backups restore (preview + replace) queues nothing', async () => {
    await boundWorkspace();
    const payload = await buildFullBackupPayload('all');
    await teammateChanges();
    const preview = await previewRestore(payload, 'replace');
    expect(preview.deleted).toBe(1);
    await restoreFullReplace(payload, preview);
    await expectPausedWithoutQueuedChanges();
  });

  it('an investigation export imported through Settings queues no deletes for other investigations', async () => {
    await boundWorkspace();
    const file = await exportInvestigationJSON('f1');
    await importJSON(file);
    expect((await db.folders.toArray()).map(row => row.id).sort()).toEqual(['f1', 'f2']);
    expect(await db.table('_syncQueue').toArray()).toEqual([]);
  });

  it('an engine sync after the restore pushes nothing', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await teammateChanges();
    await importJSON(backup);
    const engine = new SyncEngine(); engines.push(engine);
    const errors: (string | null)[] = [];
    engine.setErrorHandler(message => { errors.push(message); });
    engine.setWorkspaceIdentity(identity.serverUrl, identity.userId);
    await engine.sync();
    expect(api.push).not.toHaveBeenCalled();
    expect(errors.filter(Boolean)).not.toEqual([]);
  });

  it('leaves a workspace that Sync history recovery can reconcile as reviewed conflicts', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await teammateChanges();
    await importJSON(backup);
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: identity.serverUrl, accessToken: 'fixture', refreshToken: 'fixture',
      user: { id: identity.userId, displayName: 'Alice', email: 'alice@example.invalid', role: 'analyst' } }));
    const receipt = await prepareSyncRecovery('synthetic recovery passphrase');
    await reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, { backupSaved: true, reconcileConfirmed: true });
    const queue = await db.table('_syncQueue').toArray();
    expect(queue.every(entry => entry.op === 'put' && entry.clientVersion === 0)).toBe(true);
    expect(queue.map(entry => entry.entityId).sort()).toEqual(['f1', 'f2', 'n1', 'n2', 'nB']);
    expect(await getSyncPauseReason(db)).toBeNull();
  });

  it('refuses a restore that would delete a record with unsent local changes, and changes nothing', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await db.notes.add(note('local-unsent', 'Not yet pushed'));
    const queued = await db.table('_syncQueue').toArray();
    expect(queued).toEqual([expect.objectContaining({ entityId: 'local-unsent', op: 'put' })]);
    const refusal = await importJSON(backup).then(() => null, (error: Error) => error.message);
    expect(refusal).toContain('not yet uploaded');
    expect(refusal).toContain('Not yet pushed (Shared case)');
    expect(refusal).toContain('Sign in and let sync upload them');
    expect(refusal).not.toContain('notes:local-unsent');
    expect(await db.notes.get('local-unsent')).toBeDefined();
    expect(await db.table('_syncQueue').toArray()).toEqual(queued);
    expect(await db.table('_syncMeta').get(SYNC_RECOVERY_KEY)).toBeUndefined();
  });

  const shot = { id: 'e1', title: 'Beacon screenshot', folderId: 'f1', fileName: 'beacon.bmp', fileType: 'image', size: 2, imageData: 'Qk0=', imageDataMimeType: 'image/bmp',
    content: '', extractionStatus: 'metadata-only', importedAt: 1, chunkIndex: 1, chunkCount: 1, tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
  it.each([
    ['an evidence preview type the server refuses', 'evidenceItems', shot, 'Beacon screenshot'],
    ['a field over the server value limits', 'notes', { ...note('big', 'Pasted log'), content: 'x'.repeat(500_001) }, 'Pasted log'],
    ['a change too large for any upload request', 'notes', { ...note('wide', 'Wide log'), content: 'é'.repeat(460_000) }, 'Wide log'],
    // No pull has reported the server's tables, so it is taken to be one from before identities.
    ['a table the team server does not sync yet', 'identities', { id: 'dana', folderId: 'f1', type: 'person', name: 'Dana Okafor', aliases: [], details: [],
      connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 }, 'Dana Okafor'],
  ] as const)('names an item sync holds back (%s) and gives a remedy that clears the block', async (_label, table, row, title) => {
    await boundWorkspace();
    const backup = await exportJSON();
    await teammateChanges();
    await db.table(table).add(row);
    const queued = await db.table('_syncQueue').toArray();
    expect(queued).toEqual([expect.objectContaining({ entityId: row.id, op: 'put' })]);
    const refusal = await importJSON(backup).then(() => null, (error: Error) => error.message);
    expect(refusal).toContain(`${title} (Shared case)`);
    expect(refusal).toContain('Signing in or Sync history recovery will not upload them');
    expect(refusal).toContain('Delete them permanently');
    expect(refusal).not.toContain(`${table}:${row.id}`);
    expect(await db.table(table).get(row.id)).toBeDefined();
    expect(await db.table('_syncQueue').toArray()).toEqual(queued);
    expect(await db.table('_syncMeta').get(SYNC_RECOVERY_KEY)).toBeUndefined();
    // Merge deletes nothing, so it restores with the item kept.
    await mergeImportJSON(backup);
    expect(await db.table(table).get(row.id)).toBeDefined();
    // Deleting the item permanently queues a delete; Replace All then restores and recovery reconciles.
    await db.table(table).delete(row.id);
    await importJSON(backup);
    expect(await getSyncPauseReason(db)).toBe('history');
    await expect(assertSyncCaptureReady(db)).rejects.toThrow(SYNC_HISTORY_MESSAGE);
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: identity.serverUrl, accessToken: 'fixture', refreshToken: 'fixture',
      user: { id: identity.userId, displayName: 'Alice', email: 'alice@example.invalid', role: 'analyst' } }));
    const receipt = await prepareSyncRecovery('synthetic recovery passphrase');
    await reconcileSyncWorkspace(receipt, identity.serverUrl, identity.userId, { backupSaved: true, reconcileConfirmed: true });
    expect(await getSyncPauseReason(db)).toBeNull();
  });

  it('explains that refusal in the user language and names the way forward when sync is already paused', async () => {
    await boundWorkspace();
    const backup = await exportJSON();
    await importJSON(backup);
    await db.notes.add(note('paused-edit', 'Captured while paused'));
    const args = { ns: 'settings', count: 1, records: 'Captured while paused (Shared case)' };
    await expect(importJSON(backup)).rejects.toThrow('Sync history recovery');
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'settings', settingsDe, true, true);
    await i18n.changeLanguage('de');
    try {
      const german = i18n.t('data.syncUnsentRestoreBlocked', args);
      expect(german).not.toBe(i18n.getFixedT('en')('data.syncUnsentRestoreBlocked', args));
      await expect(importJSON(backup)).rejects.toThrow(german);
    } finally { await i18n.changeLanguage('en'); }
    expect(await db.notes.get('paused-edit')).toBeDefined();
  });

  it('keeps folder privacy bookkeeping in step with restored folders', async () => {
    await boundWorkspace();
    const payload = await buildFullBackupPayload('all');
    await db.folders.update('f2', { localOnly: true });
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f2']))).toMatchObject({ value: true });
    await db.table('_syncQueue').clear();
    const withPrivate = structuredClone(payload);
    withPrivate.data.folders = [...(withPrivate.data.folders ?? []), { id: 'f3', name: 'Private case', order: 2, createdAt: 1, localOnly: true }];
    await restoreFullReplace(withPrivate);
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f2']))).toMatchObject({ value: false });
    expect(await db.table('_syncMeta').get(JSON.stringify(['localOnly', 'f3']))).toMatchObject({ value: true });
    expect(await db.table('_syncQueue').toArray()).toEqual([]);
  });
});

describe('restoring a backup in an unbound workspace', () => {
  it('sets no recovery marker, so a later first connection still binds', async () => {
    await db.folders.add({ id: 'f1', name: 'Local case', order: 0, createdAt: 1 });
    await db.notes.add(note('n1'));
    const payload = await buildFullBackupPayload('all');
    await restoreMerge(payload);
    await restoreFullReplace(payload);
    expect(await db.table('_syncMeta').get(SYNC_RECOVERY_KEY)).toBeUndefined();
    expect(await db.table('_syncQueue').count()).toBe(0);
    await expect(ensureSyncWorkspace(identity.serverUrl, identity.userId)).resolves.toBeUndefined();
  });
});
