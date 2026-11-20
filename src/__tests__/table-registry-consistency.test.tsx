import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { INVESTIGATION_TABLES } from '../lib/backup-data';
import { scopedTables } from '../lib/backup-restore';
import { ENTITY_RELATIONS, FOLDER_CONTENT_TABLES, TAGGED_TABLES } from '../lib/entity-relations';
import { ENCRYPTED_FIELDS } from '../lib/encryptionMiddleware';
import { SYNC_TABLES } from '../lib/sync-state';
import { TABLE_SANITIZERS } from '../lib/sync-sanitize';
import { useFolders } from '../hooks/useFolders';
import { ConflictDialog } from '../components/Common/ConflictDialog';
import type { SyncResult } from '../lib/server-api';
import common from '../../public/locales/en/common.json';
import settings from '../../public/locales/en/settings.json';

/**
 * Every Dexie table must appear in each table list that applies to it. Adding a
 * table without updating one of these lists fails here. An exemption needs a reason.
 */
const NOT_BACKED_UP: Record<string, string> = {
  activityLog: 'local 30-day activity history, not user content',
  integrationRuns: 'per-device integration run records',
  checkpoints: 'per-device undo checkpoints for AI writes',
};
const sorted = (names: Iterable<string>) => [...names].sort();
const root = join(__dirname, '..', '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const entityTables = () => db.tables.map((table) => table.name).filter((name) => !name.startsWith('_'));

describe('table lists stay consistent', () => {
  it('backs up every entity table unless it is exempt for a stated reason', () => {
    const missing = entityTables().filter((name) => !(BACKUP_TABLES as readonly string[]).includes(name) && !(name in NOT_BACKED_UP));
    expect(missing).toEqual([]);
    for (const name of Object.keys(NOT_BACKED_UP)) expect(entityTables()).toContain(name);
  });

  it('lists every Dexie table for encryption and names every backup table in the restore preview', () => {
    for (const name of entityTables()) expect(ENCRYPTED_FIELDS, name).toHaveProperty(name);
    for (const name of BACKUP_TABLES) expect(settings, name).toHaveProperty([`encryption.table.${name}`]);
  });

  it('agrees on which tables belong to an investigation', () => {
    expect(sorted(INVESTIGATION_TABLES)).toEqual(sorted(scopedTables));
    for (const name of TAGGED_TABLES) expect(INVESTIGATION_TABLES, name).toContain(name);
    for (const name of FOLDER_CONTENT_TABLES) expect(INVESTIGATION_TABLES, name).toContain(name);
    for (const name of INVESTIGATION_TABLES) expect(ENTITY_RELATIONS, name).toHaveProperty(name);
  });

  it('gives every synced table a backup entry, a sanitizer and a sync-status label', () => {
    for (const name of SYNC_TABLES) {
      expect(BACKUP_TABLES, name).toContain(name);
      expect(common, name).toHaveProperty([`syncStatus.itemType.${name}`]);
    }
    expect(sorted(Object.keys(TABLE_SANITIZERS))).toEqual(sorted(SYNC_TABLES));
  });

  it('labels a sync conflict for every synced table', () => {
    const conflicts: SyncResult[] = SYNC_TABLES.map((table) => ({ table, entityId: `${table}-id`, status: 'conflict', serverVersion: 2,
      localData: { title: `Local ${table}` }, serverData: { id: `${table}-id`, title: `Remote ${table}` } }));
    render(<ConflictDialog conflicts={conflicts} onResolve={vi.fn()} onResolveAll={vi.fn()} onClose={vi.fn()} />);
    for (const table of SYNC_TABLES) expect(screen.queryByText(`Item: Local ${table}`), table).toBeNull();
  });

  it('matches the server: route enum, sync service table map and trigger contract', () => {
    const client = sorted(SYNC_TABLES);
    const routeEnum = source('server/src/routes/sync.ts').match(/table:\s*z\.enum\(\[([^\]]+)\]\)/)?.[1] ?? '';
    expect(sorted((routeEnum.match(/'([A-Za-z]+)'/g) ?? []).map((x) => x.slice(1, -1)))).toEqual(client);
    const tableMap = source('server/src/services/sync-service.ts').match(/const TABLE_MAP[^{]*\{([^}]+)\}/)?.[1] ?? '';
    expect(sorted((tableMap.match(/^\s*([A-Za-z]+):/gm) ?? []).map((x) => x.trim().slice(0, -1)))).toEqual(client);
    const contract = source('server/src/db/sync-contract.ts').match(/const syncTables[^{]*\{([^}]+)\}/)?.[1] ?? '';
    expect(sorted((contract.match(/'([A-Za-z]+)'/g) ?? []).map((x) => x.slice(1, -1)))).toEqual(client);
  });
});

describe('investigation lifecycle reaches every folder content table', () => {
  beforeEach(async () => {
    for (const name of [...BACKUP_TABLES]) await db.table(name).clear();
  });

  it('trashes the content of every folder content table when an investigation is trashed', async () => {
    await db.folders.put({ id: 'f-lifecycle', name: 'Synthetic', order: 0, createdAt: 1 } as never);
    for (const name of FOLDER_CONTENT_TABLES) await db.table(name).put({ id: `${name}-row`, folderId: 'f-lifecycle', trashed: false, createdAt: 1, updatedAt: 1 });
    const { result } = renderHook(() => useFolders());
    await act(async () => { await result.current.trashFolderContents('f-lifecycle'); });
    for (const name of FOLDER_CONTENT_TABLES) expect((await db.table(name).get(`${name}-row`))?.trashed, name).toBe(true);
  });
});
