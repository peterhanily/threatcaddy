import type { EntityTable } from 'dexie';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- IDType<T,'id'> is always string at runtime
    await table.bulkDelete(toPurge.map((item) => item.id) as any);
  }
  return toPurge.length > 0
    ? items.filter((item) => !toPurge.some((p) => p.id === item.id))
    : items;
}
