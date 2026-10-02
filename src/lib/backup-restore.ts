/** Validate a complete restoration plan before mutating any records. */
import Dexie, { type Table } from 'dexie';
import { db } from '../db';
import { backupFingerprint, backupStateFingerprint, canonicalBackupJSON, type BackupPayload } from './backup-crypto';
import { requireDifferentialBase, selectBackupData } from './backup-data';
import { BACKUP_TABLES, investigationOf, isBackupTable, parseEntityScope, type BackupTable } from './backup-tables';
import { flushEntityDrafts, withEntityDraftBarrier } from './entity-drafts';
import { mapEntityReferences } from './entity-relations';

type Row = Record<string, unknown> & { id: string };
type Mode = 'replace' | 'merge';

export interface RestoreResult {
  added: number;
  updated: number;
  deleted: number;
  tables: string[];
}

export interface RestorePreview extends RestoreResult {
  scope: BackupPayload['scope'];
  scopeId?: string;
  sharedPreserved: number;
  changes: { table: string; added: number; updated: number; deleted: number }[];
}

interface Operation { table: BackupTable; puts: Row[]; deletes: string[] }
interface Plan { preview: RestorePreview; operations: Operation[]; basis: string }
// Keep record contents behind object identity, out of UI props and serialized previews.
const previewSnapshots = new WeakMap<RestorePreview, string>();

function table(name: BackupTable): Table<Row, string> { return db.table(name); }
const sharedTables = new Set<BackupTable>(['tags', 'timelines']);
const scopedTables = new Set<BackupTable>([
  'folders', 'notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs',
  'evidenceItems', 'chatThreads', 'agentActions', 'agentDeployments', 'agentMeetings',
]);

function isRow(item: unknown): item is Row {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const id = (item as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim().length > 0;
}

function validate(payload: BackupPayload, mode: Mode): Map<BackupTable, Row[]> {
  if (payload?.type === 'differential' && payload.version === 1) {
    throw new Error('Legacy differential backups cannot be verified. Restore a full backup or create a new full backup.');
  }
  if (!payload || !((payload.version === 1 && payload.type === 'full') || (payload.version === 2 && payload.type === 'differential'))
    || !['all', 'investigation', 'entity'].includes(payload.scope)
    || !Number.isFinite(payload.createdAt) || !payload.data || typeof payload.data !== 'object'
    || Array.isArray(payload.data)) throw new Error('Invalid or unsupported backup payload.');
  if (payload.type === 'differential' && (!Number.isFinite(payload.lastBackupAt)
    || typeof payload.parentBackupId !== 'string' || !payload.parentBackupId.trim()
    || [payload.baseFingerprint, payload.baseStateFingerprint, payload.resultFingerprint]
      .some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))) {
    throw new Error('Differential backup is missing verifiable parent and state fingerprints.');
  }
  if (mode === 'replace' && payload.type !== 'full') throw new Error('Replace requires a full backup.');
  if (payload.scope === 'investigation' && (typeof payload.scopeId !== 'string' || !payload.scopeId.trim())) {
    throw new Error('Investigation backups require a scope ID.');
  }
  const entity = payload.scope === 'entity' ? parseEntityScope(payload.scopeId) : undefined;
  const result = new Map<BackupTable, Row[]>();
  for (const [name, value] of Object.entries(payload.data)) {
    if (!isBackupTable(name)) throw new Error(`Unsupported backup table: ${name}.`);
    if (!Array.isArray(value)) throw new Error(`Backup table ${name} must be an array; omit absent tables explicitly.`);
    if (entity && entity.table !== name) throw new Error(`Table ${name} is outside the entity backup scope.`);
    if (payload.scope === 'investigation' && !scopedTables.has(name) && !sharedTables.has(name)) {
      throw new Error(`Table ${name} is not part of an investigation backup.`);
    }
    const ids = new Set<string>();
    const rows: Row[] = [];
    for (const item of value) {
      if (!isRow(item)) throw new Error(`Invalid record in ${name}; nothing was restored.`);
      if (ids.has(item.id)) throw new Error(`Duplicate record ${name}:${item.id}; nothing was restored.`);
      ids.add(item.id);
      if (entity && item.id !== entity.id) throw new Error(`Record ${name}:${item.id} is outside the entity backup scope.`);
      if (payload.scope === 'investigation' && scopedTables.has(name)
        && investigationOf(name, item) !== payload.scopeId) throw new Error(`Record ${name}:${item.id} is outside the investigation backup scope.`);
      if (name === 'tags' && (typeof item.name !== 'string' || !item.name.trim())) throw new Error('Restored tags require a name.');
      rows.push(item as Row);
    }
    result.set(name, rows);
  }
  if (payload.deletedIds !== undefined) {
    if (!payload.deletedIds || typeof payload.deletedIds !== 'object' || Array.isArray(payload.deletedIds)) throw new Error('Invalid backup deletion list.');
    for (const [name, ids] of Object.entries(payload.deletedIds)) {
      if (!isBackupTable(name) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())
        || new Set(ids).size !== ids.length) throw new Error('Invalid backup deletion list.');
      if (payload.type === 'full' && ids.length) throw new Error('Full backups cannot contain differential deletions.');
      if (entity && (name !== entity.table || ids.some(id => id !== entity.id))) throw new Error('Deletion is outside the entity backup scope.');
      if (payload.scope === 'investigation' && !scopedTables.has(name) && ids.length) throw new Error('Investigation backups cannot delete shared records.');
    }
  }
  return result;
}

function belongs(payload: BackupPayload, name: BackupTable, row: Row): boolean {
  if (payload.scope === 'all') return true;
  if (payload.scope === 'entity') {
    const target = parseEntityScope(payload.scopeId);
    return target.table === name && target.id === row.id;
  }
  return scopedTables.has(name) && investigationOf(name, row) === payload.scopeId;
}

function protectRetainedReferences(before: Map<BackupTable, Row[]>, operations: Operation[]) {
  const removed = new Map<string, Set<string>>(operations.map(op => [op.table, new Set(op.deletes)]));
  const after = new Map([...before].map(([name, rows]) => [name, new Map(rows.map(row => [row.id, row]))]));
  for (const op of operations) {
    const records = after.get(op.table);
    for (const id of op.deletes) records?.delete(id);
    for (const row of op.puts) records?.set(row.id, row);
  }
  // Embedded IOC IDs share the relationship namespace with standalone IOCs.
  // An update can remove an embedded IOC without deleting its containing note.
  function iocIds(rows: Iterable<[BackupTable, Iterable<Row>]>): Set<string> {
    const ids = new Set<string>();
    for (const [name, values] of rows) for (const row of values) {
      if (name === 'standaloneIOCs') ids.add(row.id);
      if (['notes', 'tasks', 'timelineEvents'].includes(name)) {
        const analysis = row.iocAnalysis as { iocs?: { id?: unknown }[] } | undefined;
        for (const ioc of analysis?.iocs ?? []) if (typeof ioc.id === 'string') ids.add(ioc.id);
      }
    }
    return ids;
  }
  const retainedIOCs = iocIds([...after].map(([name, rows]) => [name, rows.values()]));
  removed.set('iocs', new Set([...iocIds(before)].filter(id => !retainedIOCs.has(id))));
  removed.set('playbookEntities', new Set([...(removed.get('notes') ?? []), ...(removed.get('tasks') ?? [])]));
  const retainedTagNames = new Set([...(after.get('tags')?.values() ?? [])].map(row => row.name));
  const removedTags = new Set((before.get('tags') ?? []).filter(row => !retainedTagNames.has(row.name)).map(row => row.name));
  for (const [name, rows] of after) for (const row of rows.values()) {
    mapEntityReferences(name, row, (target, id) => {
      if (removed.get(target)?.has(id)) {
        throw new Error(`Restore would break a retained reference in ${name}:${row.id}. Include the linked records or use merge.`);
      }
      return id;
    });
    if (Array.isArray(row.tags) && row.tags.some(tag => removedTags.has(tag))) {
      throw new Error(`Restore would remove a tag still used by ${name}:${row.id}. Include the linked records or use merge.`);
    }
  }
}

async function prepare(payload: BackupPayload, mode: Mode, parent?: BackupPayload): Promise<Plan> {
  const incoming = validate(payload, mode);
  const before = new Map<BackupTable, Row[]>();
  for (const name of BACKUP_TABLES) before.set(name, await table(name).toArray());
  if (payload.type === 'differential') {
    if (!parent) throw new Error('Supply the matching full parent backup before applying a differential.');
    validate(parent, 'replace');
    requireDifferentialBase(parent, payload.scope, payload.scopeId);
    // Keep IndexedDB alive while Web Crypto verifies the consistent transaction snapshot.
    const [parentHash, parentState, currentState] = await Dexie.waitFor(Promise.all([
      backupFingerprint(parent), backupStateFingerprint(parent),
      backupStateFingerprint({ ...payload, data: selectBackupData(before, payload.scope, payload.scopeId, true) }),
    ]));
    if (parentHash !== payload.baseFingerprint || parentState !== payload.baseStateFingerprint
      || parent.createdAt !== payload.lastBackupAt) throw new Error('This is not the matching full parent backup for the differential.');
    if (currentState !== parentState) throw new Error('Restore the matching full backup first; current data differs from the differential base.');
  }
  const operations: Operation[] = [];
  const preview: RestorePreview = { added: 0, updated: 0, deleted: 0, tables: [], scope: payload.scope, scopeId: payload.scopeId, sharedPreserved: 0, changes: [] };
  for (const name of BACKUP_TABLES) {
    const rows = incoming.get(name);
    const tombstones = payload.deletedIds?.[name] ?? [];
    if (rows === undefined && tombstones.length === 0) continue;
    const existing = new Map((before.get(name) ?? []).map(row => [row.id, row]));
    const shared = payload.scope === 'investigation' && sharedTables.has(name);
    const puts: Row[] = [];
    const incomingIds = new Set(rows?.map(row => row.id));
    let added = 0;
    let updated = 0;
    for (const row of rows ?? []) {
      const old = existing.get(row.id);
      if (old && !shared && !belongs(payload, name, old)) throw new Error(`Existing record ${name}:${row.id} belongs to another scope.`);
      if (shared && old) {
        if (name === 'tags' && old.name !== row.name) throw new Error('A shared tag identity has a different name; restore cannot rename it.');
        preview.sharedPreserved++;
        continue;
      }
      if (shared && name === 'tags' && [...existing.values()].some(tag => tag.name === row.name)) {
        preview.sharedPreserved++;
        continue;
      }
      const newer = typeof row.updatedAt === 'number' && typeof old?.updatedAt === 'number' && row.updatedAt > old.updatedAt;
      if (!old || ((mode === 'replace' || payload.type === 'differential' || newer) && canonicalBackupJSON(row) !== canonicalBackupJSON(old))) {
        puts.push(row);
        if (old) updated++; else added++;
      }
    }
    const deletes = new Set<string>();
    if (mode === 'replace' && !shared && rows !== undefined) {
      for (const old of existing.values()) if (belongs(payload, name, old) && !incomingIds.has(old.id)) deletes.add(old.id);
    }
    for (const id of tombstones) {
      if (incomingIds.has(id)) throw new Error(`Backup both restores and deletes ${name}:${id}.`);
      const old = existing.get(id);
      if (old && !belongs(payload, name, old)) throw new Error(`Deletion ${name}:${id} is outside the backup scope.`);
      if (old) deletes.add(id);
    }
    operations.push({ table: name, puts, deletes: [...deletes] });
    preview.added += added;
    preview.updated += updated;
    preview.deleted += deletes.size;
    preview.tables.push(name);
    preview.changes.push({ table: name, added, updated, deleted: deletes.size });
  }
  protectRetainedReferences(before, operations);
  if (payload.type === 'differential') {
    const after = new Map([...before].map(([name, rows]) => [name, new Map(rows.map(row => [row.id, row]))]));
    for (const op of operations) {
      const records = after.get(op.table);
      if (!records) throw new Error('Restore plan contains an unsupported table.');
      for (const id of op.deletes) records.delete(id);
      for (const row of op.puts) records.set(row.id, row);
    }
    const projected = new Map([...after].map(([name, rows]) => [name, [...rows.values()]]));
    const resultHash = await Dexie.waitFor(backupStateFingerprint({ ...payload,
      data: selectBackupData(projected, payload.scope, payload.scopeId, true),
    }));
    if (resultHash !== payload.resultFingerprint) throw new Error('Differential backup does not reproduce its verified result; nothing was restored.');
  }
  // Exact comparison rejects stale previews after concurrent edits without a hash-collision risk.
  const basis = JSON.stringify({ payload, mode, before: [...before] });
  return { preview, operations, basis };
}

export async function previewRestore(payload: BackupPayload, mode: Mode = 'replace', parent?: BackupPayload): Promise<RestorePreview> {
  const snapshot = structuredClone(payload);
  const base = parent && structuredClone(parent);
  if ((await flushEntityDrafts()).some(saved => !saved)) throw new Error('Save or recover pending drafts before previewing a restore.');
  return db.transaction('r', BACKUP_TABLES.map(name => db.table(name)), async () => {
    const plan = await prepare(snapshot, mode, base);
    previewSnapshots.set(plan.preview, plan.basis);
    return plan.preview;
  });
}

async function restore(payload: BackupPayload, mode: Mode, expected?: RestorePreview, parent?: BackupPayload): Promise<RestoreResult> {
  const snapshot = structuredClone(payload);
  const base = parent && structuredClone(parent);
  try {
    return await withEntityDraftBarrier(() => db.transaction('rw', BACKUP_TABLES.map(name => db.table(name)), async () => {
      const plan = await prepare(snapshot, mode, base);
      if (expected && previewSnapshots.get(expected) !== plan.basis) throw new Error('Data changed after the restore preview. Review a fresh preview before restoring.');
      for (const operation of plan.operations) {
        if (operation.deletes.length) await table(operation.table).bulkDelete(operation.deletes);
        if (operation.puts.length) await table(operation.table).bulkPut(operation.puts);
      }
      return { added: plan.preview.added, updated: plan.preview.updated, deleted: plan.preview.deleted, tables: plan.preview.tables };
    }));
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'QuotaExceededError') || /QuotaExceeded|storage quota/.test(String(error))) {
      throw new Error('Storage quota exceeded. Free up space and retry; this restore was rolled back.');
    }
    throw error;
  }
}

export function restoreFullReplace(payload: BackupPayload, expected?: RestorePreview): Promise<RestoreResult> {
  return restore(payload, 'replace', expected);
}

export function restoreMerge(payload: BackupPayload, expected?: RestorePreview, parent?: BackupPayload): Promise<RestoreResult> {
  return restore(payload, 'merge', expected, parent);
}
