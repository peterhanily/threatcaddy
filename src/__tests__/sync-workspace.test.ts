import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { disableSync, revisionKey } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { ensureSyncWorkspace, normalizeSyncWorkspaceIdentity, SYNC_WORKSPACE_KEY } from '../lib/sync-workspace';

beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
afterEach(() => disableSync());

async function snapshot() {
  return { queue: await db.table('_syncQueue').toArray(), meta: await db.table('_syncMeta').toArray() };
}

describe('durable sync workspace identity', () => {
  it('binds a fresh sync workspace without modifying existing local-only content', async () => {
    const folder = { id: 'local', name: 'Local evidence', localOnly: true, order: 0, createdAt: 1 };
    await db.folders.add(folder);
    await ensureSyncWorkspace(' https://TEAM.example:443/mount/// ', 'analyst');
    expect(await db.table('_syncMeta').get(SYNC_WORKSPACE_KEY)).toEqual({
      key: SYNC_WORKSPACE_KEY, value: { version: 1, serverUrl: 'https://team.example/mount', userId: 'analyst' },
    });
    expect(await db.folders.get('local')).toEqual(folder);
    expect(await db.table('_syncQueue').count()).toBe(0);
  });

  it('accepts the same canonical identity after restart even with pending work and revisions', async () => {
    await ensureSyncWorkspace('https://team.example/', 'analyst');
    await db.table('_syncQueue').add({ table: 'notes', entityId: 'n', op: 'put', data: { content: 'Retained' } });
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'n'), value: 7 });
    const before = await snapshot();
    await ensureSyncWorkspace('HTTPS://TEAM.EXAMPLE:443', 'analyst');
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['https://other.example', 'analyst'],
    ['https://team.example', 'different-account'],
    ['http://team.example', 'analyst'],
    ['https://team.example:8443', 'analyst'],
    ['https://team.example/other-mount', 'analyst'],
  ])('refuses another destination or account without altering state: %s / %s', async (serverUrl, userId) => {
    await ensureSyncWorkspace('https://team.example', 'analyst');
    await db.table('_syncQueue').add({ table: 'notes', entityId: 'n', op: 'delete', clientVersion: 2 });
    const before = await snapshot();
    await expect(ensureSyncWorkspace(serverUrl, userId)).rejects.toThrow('Export a local backup');
    expect(await snapshot()).toEqual(before);
  });

  it('does not auto-adopt unbound pending work', async () => {
    await db.table('_syncQueue').add({ table: 'folders', entityId: 'f', op: 'put', data: { name: 'Private investigation' } });
    const before = await snapshot();
    await expect(ensureSyncWorkspace('https://team.example', 'analyst')).rejects.toThrow('cannot be adopted automatically');
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    [revisionKey('notes', 'n'), 0], ['syncCursorV2', '0'], ['initialPushDoneV2', false],
    ['syncRecoveryRequiredV2', true], ['initialPushDone', true], ['lastSyncTimestamp', '2026-01-01'],
    [JSON.stringify(['localOnly', 'id']), 'true'], [JSON.stringify(['localOnly', '']), true],
    [JSON.stringify(['localOnly', 'id', 'history']), false],
  ])('does not auto-adopt unbound metadata, including an empty baseline: %s', async (key, value) => {
    await db.table('_syncMeta').put({ key, value });
    const before = await snapshot();
    await expect(ensureSyncWorkspace('https://team.example', 'analyst')).rejects.toThrow('no verified server/account binding');
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, 'old-format', {}, { version: 2, serverUrl: 'https://team.example', userId: 'analyst' }])(
    'fails closed on an invalid existing binding without rewriting it: %j', async value => {
      await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value });
      const before = await snapshot();
      await expect(ensureSyncWorkspace('https://team.example', 'analyst')).rejects.toThrow('binding is invalid');
      expect(await snapshot()).toEqual(before);
    },
  );

  it('serializes competing first connections so only one account can bind', async () => {
    const results = await Promise.allSettled([
      ensureSyncWorkspace('https://team.example', 'first'),
      ensureSyncWorkspace('https://team.example', 'second'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const binding = await db.table('_syncMeta').get(SYNC_WORKSPACE_KEY);
    expect(['first', 'second']).toContain(binding.value.userId);
    expect(await db.table('_syncMeta').count()).toBe(1);
  });

  it.each([
    ['not-a-url', 'analyst'], ['ftp://team.example', 'analyst'],
    ['https://name:secret@team.example', 'analyst'], ['https://team.example?other=1', 'analyst'],
    ['https://team.example#different', 'analyst'], ['https://team.example', ''],
  ])('rejects ambiguous or credential-bearing identity input without writes: %s', async (url, user) => {
    await expect(ensureSyncWorkspace(url, user)).rejects.toThrow('Sync requires');
    expect(await snapshot()).toEqual({ queue: [], meta: [] });
  });

  it('does not normalize away meaningful path or account identity differences', () => {
    expect(normalizeSyncWorkspaceIdentity('http://localhost:80/Team/', 'A')).toEqual({
      version: 1, serverUrl: 'http://localhost/Team', userId: 'A',
    });
    expect(normalizeSyncWorkspaceIdentity('https://team.example/team', 'a')).not.toEqual(
      normalizeSyncWorkspaceIdentity('https://team.example/Team', 'A'),
    );
  });
});
