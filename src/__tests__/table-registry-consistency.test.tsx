import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { INVESTIGATION_TABLES, SHARED_TABLES } from '../lib/backup-data';
import { ENTITY_RELATIONS, FOLDER_CONTENT_TABLES, TAGGED_TABLES } from '../lib/entity-relations';
import { ENCRYPTED_FIELDS } from '../lib/encryptionMiddleware';
import { isSyncTable, LEGACY_SYNC_TABLES, SYNC_TABLES } from '../lib/sync-state';
import { TABLE_SANITIZERS } from '../lib/sync-sanitize';
import { useFolders } from '../hooks/useFolders';
import { ConflictDialog } from '../components/Common/ConflictDialog';
import type { SyncResult } from '../lib/server-api';
import common from '../../public/locales/en/common.json';
import settings from '../../public/locales/en/settings.json';

/**
 * Every Dexie table must appear in each table list that applies to it. The expected
 * sets come from the Dexie schema itself, so a new table that misses a list fails
 * here. Any exemption below needs a stated reason.
 */
const INTERNAL_TABLES: Record<string, string> = {
  _syncQueue: 'outgoing sync queue', _syncMeta: 'sync revisions and cursors',
  _localMigrations: 'markers for content migrations that have run', _clipReceipts: 'per-workspace clip import receipts',
};
const NOT_BACKED_UP: Record<string, string> = {
  activityLog: 'local 30-day activity history, not user content',
  integrationRuns: 'per-device integration run records',
  checkpoints: 'per-device undo checkpoints for AI writes',
};
/** Investigation tables that never reach the team server. */
const LOCAL_INVESTIGATION_TABLES: Record<string, string> = {
  agentActions: 'agent records stay with the client that runs the agents',
  agentDeployments: 'agent records stay with the client that runs the agents',
  agentMeetings: 'agent records stay with the client that runs the agents',
};
/** Backed-up tables that belong to no investigation and are not shared catalogs. */
const GLOBAL_TABLES: Record<string, string> = {
  agentProfiles: 'reusable agent profiles', noteTemplates: 'note templates', playbookTemplates: 'playbook templates',
  integrationTemplates: 'integration templates', installedIntegrations: 'installed integrations',
  customSlashCommands: 'custom slash commands',
};

const sorted = (names: Iterable<string>) => [...names].sort();
const root = join(__dirname, '..', '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');
/**
 * The contents of the value that `marker` introduces: from the bracket that ends the
 * marker, or else the first bracket after its `=` (so type annotations are skipped).
 */
function block(path: string, marker: string): string {
  const text = source(path);
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`${marker} not found in ${path}`);
  const from = /[[{(]$/.test(marker) ? start + marker.length - 1 : text.indexOf('=', start);
  const open = text.slice(from).search(/[[{(]/) + from;
  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] in pairs) depth++;
    else if (Object.values(pairs).includes(text[i]) && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`${marker} is not closed in ${path}`);
}
const quoted = (text: string) => sorted((text.match(/'([A-Za-z0-9_]+)'/g) ?? []).map((x) => x.slice(1, -1)));
const allTables = () => db.tables.map((table) => table.name);
const entityTables = () => allTables().filter((name) => !(name in INTERNAL_TABLES));
/** Backed-up tables with an index on `field` (local-only tables are exempt above). */
const indexedBy = (field: string) => db.tables.filter((table) => !(table.name in NOT_BACKED_UP)
  && table.schema.indexes.some((index) => index.name === field)).map((table) => table.name);

describe('table lists stay consistent with the Dexie schema', () => {
  it('names a reason for every internal table and keeps the exemption lists current', () => {
    expect(allTables().filter((name) => name.startsWith('_')).sort()).toEqual(sorted(Object.keys(INTERNAL_TABLES)));
    for (const name of [...Object.keys(NOT_BACKED_UP), ...Object.keys(GLOBAL_TABLES)]) expect(entityTables(), name).toContain(name);
    for (const name of Object.keys(NOT_BACKED_UP)) expect(BACKUP_TABLES, name).not.toContain(name);
  });

  it('backs up every entity table unless it is exempt for a stated reason', () => {
    expect(sorted(entityTables().filter((name) => !(name in NOT_BACKED_UP)))).toEqual(sorted(BACKUP_TABLES));
  });

  it('lists every table for encryption and names every backup table in the restore preview', () => {
    for (const name of entityTables()) expect(ENCRYPTED_FIELDS, name).toHaveProperty(name);
    for (const name of BACKUP_TABLES) expect(settings, name).toHaveProperty([`encryption.table.${name}`]);
  });

  it('puts every table indexed by folderId or investigationId in the investigation scope', () => {
    const expected = sorted(['folders', ...indexedBy('folderId'), ...indexedBy('investigationId')]);
    expect(sorted(INVESTIGATION_TABLES)).toEqual(expected);
    expect(sorted(FOLDER_CONTENT_TABLES)).toEqual(sorted(indexedBy('folderId')));
    expect(sorted(TAGGED_TABLES)).toEqual(sorted(['folders', ...indexedBy('tags')]));
    for (const name of expected) expect(ENTITY_RELATIONS, name).toHaveProperty(name);
  });

  it('places every backup table in an investigation, a shared catalog or the global list', () => {
    for (const name of BACKUP_TABLES) {
      const homes = [INVESTIGATION_TABLES.includes(name), SHARED_TABLES.has(name), name in GLOBAL_TABLES].filter(Boolean);
      expect(homes, name).toHaveLength(1);
    }
  });

  it('syncs every investigation table unless it is exempt for a stated reason', () => {
    expect(sorted(INVESTIGATION_TABLES.filter((name) => !isSyncTable(name)))).toEqual(sorted(Object.keys(LOCAL_INVESTIGATION_TABLES)));
  });

  it('gives every synced table a backup entry, a scope, a sanitizer and a sync-status label', () => {
    for (const name of SYNC_TABLES) {
      expect(BACKUP_TABLES, name).toContain(name);
      expect(INVESTIGATION_TABLES.includes(name) || SHARED_TABLES.has(name), name).toBe(true);
      expect(common, name).toHaveProperty([`syncStatus.itemType.${name}`]);
    }
    expect(sorted(Object.keys(TABLE_SANITIZERS))).toEqual(sorted(SYNC_TABLES));
  });

  it('labels a sync conflict for every synced table', () => {
    for (const table of SYNC_TABLES) {
      const conflict: SyncResult = { table, entityId: `${table}-id`, status: 'conflict', serverVersion: 2,
        localData: { title: `Local ${table}` }, serverData: { id: `${table}-id`, title: `Remote ${table}` } };
      // A single conflict renders expanded, so its row label is visible.
      const view = render(<ConflictDialog conflicts={[conflict]} onResolve={vi.fn()} onResolveAll={vi.fn()} onClose={vi.fn()} />);
      const label = screen.getByText(new RegExp(`: Local ${table}$`)).textContent ?? '';
      expect(label, table).not.toMatch(/^Item:/);
      view.unmount();
    }
  });

  it('reloads the UI after a server pull for every synced table', () => {
    const reloads = quoted((source('src/hooks/useServerSync.ts').match(/tables\.has\('([A-Za-z0-9_]+)'\)/g) ?? []).join(' '));
    expect(reloads).toEqual(sorted(SYNC_TABLES));
  });
});

describe('the server agrees with the client', () => {
  it('uses the same synced tables in the route enum, the table map and the sync-contract table list', () => {
    const client = sorted(SYNC_TABLES);
    expect(quoted(block('server/src/routes/sync.ts', 'table: z.enum('))).toEqual(client);
    const tableMap = block('server/src/services/sync-service.ts', 'const TABLE_MAP');
    expect(sorted((tableMap.match(/^\s*([A-Za-z0-9_]+):\s*schema\./gm) ?? []).map((x) => x.trim().split(':')[0]))).toEqual(client);
    expect(quoted(block('server/src/db/sync-contract.ts', 'const syncTables'))).toEqual(client);
  });

  it('agrees on the frozen tables that clients and servers synced before they listed their tables', () => {
    expect(quoted(block('server/src/services/sync-service.ts', 'export const LEGACY_SYNC_TABLES'))).toEqual(sorted(LEGACY_SYNC_TABLES));
    // 2.0.4 synced these ten. A table added since must stay out, or older clients would receive it and stop syncing.
    expect(sorted(LEGACY_SYNC_TABLES)).toEqual(sorted(['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems']));
    expect(LEGACY_SYNC_TABLES.every(isSyncTable)).toBe(true);
  });

  it('scopes, shares and tombstones the same tables', () => {
    expect(quoted(block('server/src/services/investigation-lifecycle.ts', 'export const INVESTIGATION_CONTENT_TABLES'))).toEqual(sorted(FOLDER_CONTENT_TABLES.filter(isSyncTable)));
    expect(quoted(block('server/src/services/sync-service.ts', 'const GLOBAL_SYNC_TABLES'))).toEqual(sorted(SHARED_TABLES));
    expect(quoted(block('server/src/services/cleanup-service.ts', 'const TOMBSTONE_TABLES'))).toEqual(sorted(SYNC_TABLES.filter((name) => name !== 'folders')));
  });
});

describe('investigation lifecycle reaches every folder content table', () => {
  beforeEach(async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
  });
  const seed = async () => {
    await db.folders.put({ id: 'f-lifecycle', name: 'Synthetic', order: 0, createdAt: 1 } as never);
    for (const name of indexedBy('folderId')) await db.table(name).put({ id: `${name}-row`, folderId: 'f-lifecycle', trashed: false, createdAt: 1, updatedAt: 1 });
  };

  it('trashes the content of every folder-indexed table when an investigation is trashed', async () => {
    await seed();
    const { result } = renderHook(() => useFolders());
    await act(async () => { await result.current.trashFolderContents('f-lifecycle'); });
    for (const name of indexedBy('folderId')) expect((await db.table(name).get(`${name}-row`))?.trashed, name).toBe(true);
  });

  it('unassigns the content of every folder-indexed table when an investigation is deleted', async () => {
    await seed();
    const { result } = renderHook(() => useFolders());
    await act(async () => { await result.current.deleteFolder('f-lifecycle'); });
    for (const name of indexedBy('folderId')) {
      const row = await db.table(name).get(`${name}-row`);
      expect(row, name).toBeDefined();
      expect(row?.folderId, name).toBeUndefined();
    }
  });
});
