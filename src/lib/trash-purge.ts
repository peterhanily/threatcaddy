import type { EntityTable } from 'dexie';
import { deleteEntitiesWithReferences, ENTITY_RELATIONS } from './entity-relations';

const TRASH_PURGE_DAYS = 30;

interface Trashable {
  id: string;
  trashed: boolean;
  trashedAt?: number;
}

/**
 * Auto-purge items that have been in trash longer than TRASH_PURGE_DAYS.
 * Returns the remaining items after purging.
 */
export async function purgeOldTrash<T extends Trashable>(
  items: T[],
  table: EntityTable<T, 'id'>,
): Promise<T[]> {
  const purgeThreshold = Date.now() - TRASH_PURGE_DAYS * 86400000;
  const toPurge = items.filter((item) => item.trashed && item.trashedAt && item.trashedAt < purgeThreshold);
  if (toPurge.length > 0) {
    if (!ENTITY_RELATIONS[table.name]) throw new Error('No safe purge lifecycle registered for ' + table.name);
    await deleteEntitiesWithReferences({ [table.name]: toPurge.map(item => item.id) }, undefined, purgeThreshold);
  }
  if (!toPurge.length) return items;
  // A record restored or edited while its queued purge waited must not vanish from the view.
  const retained = new Map((await table.where('id').anyOf(toPurge.map(item => item.id)).toArray()).map(item => [item.id, item]));
  const candidates = new Set(toPurge.map(item => item.id));
  return items.flatMap(item => candidates.has(item.id) ? retained.get(item.id) ?? [] : item);
}
