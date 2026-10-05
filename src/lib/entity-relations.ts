import { db } from '../db';
import { withEntityDraftBarrier } from './entity-drafts';

export type EntityRecord = Record<string, unknown> & { id: string };
interface Relation { path: string; target: string; many?: boolean }
const relation = (path: string, target: string, many = false): Relation => ({ path, target, many });
const folder = relation('folderId', 'folders');
const links = [relation('linkedNoteIds', 'notes', true), relation('linkedTaskIds', 'tasks', true), relation('linkedTimelineEventIds', 'timelineEvents', true)];
const embeddedIOCs = [relation('iocAnalysis.iocs.*.relationships.*.targetIOCId', 'iocs'), relation('iocAnalysis.iocs.*.relatedId', 'iocs')];
/** Explicit relationships only: never rewrite IDs buried in analyst prose or tool input. */
export const ENTITY_RELATIONS: Record<string, Relation[]> = {
  notes: [folder, ...links, ...embeddedIOCs, relation('parentNoteId', 'notes')],
  tasks: [folder, ...links, ...embeddedIOCs],
  timelineEvents: [folder, ...links, ...embeddedIOCs, relation('timelineId', 'timelines'), relation('linkedIOCIds', 'iocs', true)],
  standaloneIOCs: [folder, ...links, relation('linkedEvidenceIds', 'evidenceItems', true), relation('relationships.*.targetIOCId', 'iocs')],
  evidenceItems: [folder, relation('linkedIOCIds', 'iocs', true)],
  whiteboards: [folder],
  chatThreads: [folder, relation('parentThreadId', 'chatThreads')],
  folders: [relation('timelineId', 'timelines'), relation('agentThreadId', 'chatThreads'),
    relation('playbookExecution.steps.*.entityId', 'playbookEntities')],
  timelines: [],
  agentProfiles: [],
  agentActions: [relation('investigationId', 'folders'), relation('threadId', 'chatThreads')],
  agentDeployments: [relation('investigationId', 'folders'), relation('profileId', 'agentProfiles'),
    relation('supervisorDeploymentId', 'agentDeployments'), relation('threadId', 'chatThreads')],
  agentMeetings: [relation('investigationId', 'folders'), relation('threadId', 'chatThreads'),
    relation('minutesNoteId', 'notes'), relation('participantDeploymentIds', 'agentDeployments', true)],
};
export const TAGGED_TABLES = ['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'evidenceItems', 'chatThreads', 'folders'] as const;
export const FOLDER_CONTENT_TABLES = TAGGED_TABLES.filter(name => name !== 'folders');
let lifecycleTail: Promise<void> = Promise.resolve();
/** Mount-time purges can arrive together; serialize our draft barriers, not just DB writes. */
function lifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const pending = lifecycleTail.then(() => withEntityDraftBarrier(operation));
  lifecycleTail = pending.then(() => {}, () => {});
  return pending;
}

function visit(value: unknown, path: string[], update: (parent: Record<string, unknown>, key: string) => void): void {
  if (!value || typeof value !== 'object') return;
  const [head, ...tail] = path;
  if (head === '*') { if (Array.isArray(value)) value.forEach(child => visit(child, tail, update)); return; }
  const parent = value as Record<string, unknown>;
  if (!tail.length) { if (head in parent) update(parent, head); return; }
  visit(parent[head], tail, update);
}
export function mapEntityReferences(table: string, row: EntityRecord, mapper: (target: string, id: string, path: string) => string | undefined): EntityRecord {
  const copy = structuredClone(row);
  for (const ref of ENTITY_RELATIONS[table] ?? []) visit(copy, ref.path.split('.'), (parent, key) => {
    const value = parent[key];
    if (ref.many && Array.isArray(value)) parent[key] = value.flatMap(id => typeof id === 'string' ? mapper(ref.target, id, ref.path) ?? [] : []);
    else if (typeof value === 'string') {
      const mapped = mapper(ref.target, value, ref.path);
      if (mapped === undefined) delete parent[key]; else parent[key] = mapped;
    }
  });
  // A relationship is an edge, not an empty object after its target is removed.
  const prune = (value: Record<string, unknown>) => {
    if (Array.isArray(value.relationships)) value.relationships = value.relationships.filter(rel => rel && typeof rel.targetIOCId === 'string');
  };
  prune(copy);
  const analysis = copy.iocAnalysis as { iocs?: Record<string, unknown>[] } | undefined;
  analysis?.iocs?.forEach(prune);
  return copy;
}

/** Permanent delete + every known reverse edge is one transaction; trash retains restorable links. */
export async function deleteEntitiesWithReferences(deletions: Record<string, string[]>, investigationWithContents?: string, onlyExpiredTrashBefore?: number): Promise<void> {
  if (!Object.values(deletions).some(ids => ids.length)) return;
  await lifecycle(async () => db.transaction('rw', Object.keys(ENTITY_RELATIONS).map(name => db.table(name)), async () => {
    if (onlyExpiredTrashBefore !== undefined) {
      for (const [name, ids] of Object.entries(deletions)) {
        const rows = await db.table<EntityRecord>(name).bulkGet(ids);
        deletions[name] = rows.filter((row): row is EntityRecord => !!row && row.trashed === true && typeof row.trashedAt === 'number' && row.trashedAt < onlyExpiredTrashBefore).map(row => row.id);
      }
    }
    if (investigationWithContents) {
      for (const name of FOLDER_CONTENT_TABLES) deletions[name] = await db.table(name).where('folderId').equals(investigationWithContents).primaryKeys() as string[];
      for (const name of ['agentActions', 'agentDeployments', 'agentMeetings']) deletions[name] = await db.table(name).where('investigationId').equals(investigationWithContents).primaryKeys() as string[];
    }
    const removed = new Map(Object.entries(deletions).map(([table, ids]) => [table, new Set(ids)]));
    const iocIds = new Set(removed.get('standaloneIOCs') ?? []);
    for (const table of ['notes', 'tasks', 'timelineEvents']) {
      for (const row of await db.table(table).bulkGet(deletions[table] ?? [])) {
        for (const ioc of row?.iocAnalysis?.iocs ?? []) iocIds.add(ioc.id);
      }
    }
    removed.set('iocs', iocIds);
    removed.set('playbookEntities', new Set([...(removed.get('notes') ?? []), ...(removed.get('tasks') ?? [])]));
    for (const [table, ids] of Object.entries(deletions)) {
      if (!ENTITY_RELATIONS[table]) throw new Error('Unsupported entity deletion: ' + table);
      await db.table(table).bulkDelete(ids);
    }
    const now = Date.now();
    for (const table of Object.keys(ENTITY_RELATIONS)) {
      const rows = await db.table<EntityRecord>(table).toArray();
      for (const row of rows) {
        let changed = false;
        const updated = mapEntityReferences(table, row, (target, id) => {
          if (removed.get(target)?.has(id)) { changed = true; return undefined; }
          return id;
        });
        if (changed) await db.table(table).put({ ...updated, updatedAt: now });
      }
    }
  }));
}

export async function changeTagEverywhere(id: string, replacement?: { name?: string; color?: string }): Promise<void> {
  await lifecycle(async () => db.transaction('rw', [db.tags, ...TAGGED_TABLES.map(name => db.table(name))], async () => {
    const old = await db.tags.get(id);
    if (!old) return;
    const newName = replacement?.name?.trim();
    if (newName !== undefined) {
      if (!newName) throw new Error('Tag name cannot be empty.');
      const duplicate = await db.tags.filter(tag => tag.id !== id && tag.name.toLowerCase() === newName.toLowerCase()).first();
      if (duplicate) throw new Error('A tag with that name already exists.');
    }
    if (!replacement || (newName !== undefined && newName !== old.name)) {
      for (const name of TAGGED_TABLES) {
        const rows = await db.table<EntityRecord>(name).filter(row => Array.isArray(row.tags) && row.tags.includes(old.name)).toArray();
        for (const row of rows) {
          const tags = (row.tags as string[]).flatMap(tag => tag === old.name ? newName ?? [] : tag);
          await db.table(name).update(row.id, { tags: [...new Set(tags)], updatedAt: Date.now() });
        }
      }
    }
    if (replacement) await db.tags.update(id, { ...replacement, ...(newName !== undefined ? { name: newName } : {}) }); else await db.tags.delete(id);
  }));
}

/** Record which rows this folder operation archived; independently archived rows stay archived. */
export async function setInvestigationArchived(id: string, archived: boolean): Promise<void> {
  await lifecycle(async () => db.transaction('rw', [db.folders, db.agentDeployments, db.table('_localMigrations'), ...FOLDER_CONTENT_TABLES.map(name => db.table(name))], async () => {
    const now = Date.now();
    const key = 'folder-archive:' + id;
    const previous = await db.table('_localMigrations').get(key) as { rows?: Record<string, string[]> } | undefined;
    const rows: Record<string, string[]> = previous?.rows ?? {};
    for (const name of FOLDER_CONTENT_TABLES) {
      const candidates = await db.table<EntityRecord>(name).where('folderId').equals(id).filter(row => !row.trashed).toArray();
      const changed = archived ? candidates.filter(row => !row.archived)
        : candidates.filter(row => row.archived && (!previous || rows[name]?.includes(row.id)));
      if (archived) rows[name] = [...new Set([...(rows[name] ?? []), ...changed.map(row => row.id)])];
      for (const row of changed) await db.table(name).update(row.id, { archived, updatedAt: now });
    }
    if (archived) {
      await db.table('_localMigrations').put({ key, rows, at: now });
      await db.agentDeployments.where('investigationId').equals(id).modify({ shift: 'resting', status: 'idle', updatedAt: now });
    } else await db.table('_localMigrations').delete(key);
    await db.folders.update(id, { status: archived ? 'archived' : 'active', ...(archived ? { agentEnabled: false } : {}), updatedAt: now });
  }));
}
