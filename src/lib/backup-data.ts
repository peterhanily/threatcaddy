/** Consistent full snapshots and verified, snapshot-based differential backups. */
import { db } from '../db';
import { backupFingerprint, backupStateFingerprint, canonicalBackupJSON, type BackupPayload } from './backup-crypto';
import { BACKUP_TABLES, investigationOf, parseEntityScope, type BackupTable } from './backup-tables';
import { flushEntityDrafts } from './entity-drafts';

export type BackupRow = Record<string, unknown> & { id: string };
const INVESTIGATION_TABLES: BackupTable[] = [
  'folders', 'notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs',
  'evidenceItems', 'chatThreads', 'agentActions', 'agentDeployments', 'agentMeetings',
];
const SHARED_TABLES = new Set<BackupTable>(['tags', 'timelines']);

/** The same scope projection is used for snapshot creation and restore checks. */
export function selectBackupData(
  rows: Map<BackupTable, BackupRow[]>,
  scope: BackupPayload['scope'],
  scopeId?: string,
  allowMissing = false,
): BackupPayload['data'] {
  if (scope === 'all') return Object.fromEntries(BACKUP_TABLES.map(name => [name, rows.get(name) ?? []]));
  if (scope === 'entity') {
    const { table, id } = parseEntityScope(scopeId);
    const selected = (rows.get(table) ?? []).filter(row => row.id === id);
    if (!allowMissing && !selected.length) throw new Error('Entity not found: ' + scopeId);
    return { [table]: selected };
  }
  if (scope !== 'investigation' || !scopeId?.trim()) throw new Error('scopeId required for investigation scope');
  const selected = new Map(INVESTIGATION_TABLES.map(name => [name,
    (rows.get(name) ?? []).filter(row => investigationOf(name, row) === scopeId),
  ]));
  if (!allowMissing && !selected.get('folders')?.length) throw new Error('Investigation not found');
  const tagNames = new Set<string>();
  const timelineIds = new Set<string>();
  for (const records of selected.values()) for (const row of records) {
    if (Array.isArray(row.tags)) for (const tag of row.tags) if (typeof tag === 'string') tagNames.add(tag);
    if (typeof row.timelineId === 'string') timelineIds.add(row.timelineId);
  }
  selected.set('tags', (rows.get('tags') ?? []).filter(row => typeof row.name === 'string' && tagNames.has(row.name)));
  selected.set('timelines', (rows.get('timelines') ?? []).filter(row => timelineIds.has(row.id)));
  return Object.fromEntries(selected);
}

async function collectSnapshot(scope: BackupPayload['scope'], scopeId?: string, allowMissing = false): Promise<BackupPayload> {
  if ((await flushEntityDrafts()).some(saved => !saved)) throw new Error('Save or recover pending drafts before creating a backup.');
  return db.transaction('r', BACKUP_TABLES.map(name => db.table(name)), async () => {
    const createdAt = Date.now();
    const rows = new Map<BackupTable, BackupRow[]>();
    for (const name of BACKUP_TABLES) rows.set(name, await db.table(name).toArray());
    return { version: 1, type: 'full', scope, scopeId, createdAt, data: selectBackupData(rows, scope, scopeId, allowMissing) };
  });
}

export function buildFullBackupPayload(scope: BackupPayload['scope'], scopeId?: string): Promise<BackupPayload> {
  return collectSnapshot(scope, scopeId);
}

/** A differential must start with a complete, unambiguous supported full base. */
export function requireDifferentialBase(parent: BackupPayload, scope: BackupPayload['scope'], scopeId?: string): void {
  if (!parent || parent.version !== 1 || parent.type !== 'full' || parent.scope !== scope || parent.scopeId !== scopeId
    || !Number.isFinite(parent.createdAt) || !parent.data || typeof parent.data !== 'object' || Array.isArray(parent.data)
    || (parent.deletedIds !== undefined && (!parent.deletedIds || typeof parent.deletedIds !== 'object'
      || Array.isArray(parent.deletedIds) || Object.values(parent.deletedIds).some(ids => !Array.isArray(ids) || ids.length)))) {
    throw new Error('Differential backup requires a full parent with the same scope.');
  }
  const names: BackupTable[] = scope === 'all' ? [...BACKUP_TABLES] : scope === 'entity' ? [parseEntityScope(scopeId).table]
    : [...INVESTIGATION_TABLES, 'tags', 'timelines'];
  if (Object.keys(parent.data).length !== names.length || names.some(name => !Array.isArray(parent.data[name]))) {
    throw new Error('The parent does not contain a complete supported snapshot. Create a new full backup first.');
  }
  for (const name of names) {
    const ids = new Set<string>();
    for (const row of parent.data[name] ?? []) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof (row as BackupRow).id !== 'string'
        || !(row as BackupRow).id.trim() || ids.has((row as BackupRow).id)) throw new Error('Invalid records in the differential parent.');
      const record = row as BackupRow;
      ids.add(record.id);
      if (scope === 'investigation' && !SHARED_TABLES.has(name) && investigationOf(name, record) !== scopeId) throw new Error('Parent record is outside the backup scope.');
      if (scope === 'entity' && record.id !== parseEntityScope(scopeId).id) throw new Error('Parent record is outside the backup scope.');
    }
  }
}

export async function buildDifferentialPayload(
  scope: BackupPayload['scope'],
  parentPayload: BackupPayload,
  parentBackupId: string,
  scopeId?: string,
): Promise<BackupPayload> {
  const parent = structuredClone(parentPayload);
  requireDifferentialBase(parent, scope, scopeId);
  if (!parentBackupId.trim()) throw new Error('Differential backup requires its parent backup ID.');
  const current = await collectSnapshot(scope, scopeId, true);
  const data: BackupPayload['data'] = {};
  const deletedIds: Record<string, string[]> = {};
  for (const name of Object.keys(current.data) as BackupTable[]) {
    const previous = new Map((parent.data[name] as BackupRow[]).map(row => [row.id, row]));
    const rows = current.data[name] as BackupRow[];
    const currentIds = new Set(rows.map(row => row.id));
    const changed: BackupRow[] = [];
    for (const row of rows) {
      const old = previous.get(row.id);
      if (!old || canonicalBackupJSON(old) !== canonicalBackupJSON(row)) {
        if (old && scope === 'investigation' && SHARED_TABLES.has(name)) {
          throw new Error('Shared tags or timelines changed since the parent. Create a new full backup for this investigation.');
        }
        changed.push(row);
      }
    }
    if (changed.length) data[name] = changed;
    // Shared catalogs can stop being referenced by this scope without deletion.
    if (scope !== 'investigation' || !SHARED_TABLES.has(name)) {
      const removed = [...previous.keys()].filter(id => !currentIds.has(id));
      if (removed.length) deletedIds[name] = removed;
    }
  }
  return {
    version: 2, type: 'differential', scope, scopeId, parentBackupId,
    createdAt: current.createdAt, lastBackupAt: parent.createdAt,
    baseFingerprint: await backupFingerprint(parent),
    baseStateFingerprint: await backupStateFingerprint(parent),
    resultFingerprint: await backupStateFingerprint(current),
    data, ...(Object.keys(deletedIds).length ? { deletedIds } : {}),
  };
}

export function countPayloadEntities(payload: BackupPayload): number {
  return Object.values(payload.data).reduce((count, rows) => count + (rows?.length ?? 0), 0);
}
