import { nanoid } from 'nanoid';
import { db } from '../db';
import type { IOCAnalysis } from '../types';
import { mapEntityReferences } from './entity-relations';
import { sanitizeSharePayload, shareCollections } from './share-data';

/** Save independent copies, never overwrite IDs or bind to unrelated recipient data. */
export async function importSharedPayload(raw: unknown): Promise<void> {
  const payload = sanitizeSharePayload(raw);
  const collections = shareCollections(payload);
  const maps = new Map(Object.entries(collections).map(([table, rows]) => [table, new Map(rows.map(row => [row.id, nanoid()]))]));
  const iocIds = new Map(maps.get('standaloneIOCs'));
  for (const table of ['notes', 'tasks', 'timelineEvents']) {
    for (const row of collections[table] ?? []) {
      for (const ioc of (row.iocAnalysis as IOCAnalysis | undefined)?.iocs ?? []) {
        if (!iocIds.has(ioc.id)) iocIds.set(ioc.id, nanoid());
      }
    }
  }
  maps.set('iocs', iocIds);
  for (const [table, rows] of Object.entries(collections)) {
    collections[table] = rows.map(row => {
      const copy = mapEntityReferences(table, row, (target, id) => maps.get(target)?.get(id));
      copy.id = maps.get(table)?.get(row.id) ?? nanoid();
      delete copy.createdBy;
      delete copy.updatedBy;
      if (table === 'tasks' || table === 'standaloneIOCs') {
        delete copy.assigneeId;
        delete copy.assigneeName;
      }
      if (table === 'folders') copy.name = String(copy.name) + ' (shared copy)';
      const analysis = copy.iocAnalysis as IOCAnalysis | undefined;
      if (analysis) for (const ioc of analysis.iocs) ioc.id = iocIds.get(ioc.id) ?? nanoid();
      // An event without a shared timeline belongs to the unassigned timeline.
      if (table === 'timelineEvents' && !copy.timelineId) copy.timelineId = '';
      return copy;
    });
  }
  await db.transaction('rw', Object.keys(collections).map(name => db.table(name)), async () => {
    for (const [table, rows] of Object.entries(collections)) {
      if (table === 'tags') {
        // Entity tags refer to names. Reuse the existing definition without changing it.
        for (const row of rows) {
          if (!await db.tags.filter(tag => tag.name === row.name).first()) await db.table(table).add(row);
        }
      } else if (rows.length) await db.table(table).bulkAdd(rows);
    }
  });
}
