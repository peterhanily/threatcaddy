import { nanoid } from 'nanoid';
import { db, type DB } from '../db/index.js';
import { activityLog } from '../db/schema.js';

export async function logActivity(opts: {
  userId: string;
  category: string;
  action: string;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  folderId?: string;
}, database: Pick<DB, 'insert'> = db) {
  await database.insert(activityLog).values({
    id: nanoid(),
    userId: opts.userId,
    category: opts.category,
    action: opts.action,
    detail: opts.detail,
    itemId: opts.itemId,
    itemTitle: opts.itemTitle,
    folderId: opts.folderId,
    timestamp: new Date(),
  });
}

/**
 * Batch insert multiple activity log entries in a single INSERT statement.
 * More efficient than calling logActivity() per entry.
 */
export async function logActivityBatch(entries: Array<{
  userId: string;
  category: string;
  action: string;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  folderId?: string;
}>) {
  if (entries.length === 0) return;
  const now = new Date();
  await db.insert(activityLog).values(
    entries.map((opts) => ({
      id: nanoid(),
      userId: opts.userId,
      category: opts.category,
      action: opts.action,
      detail: opts.detail,
      itemId: opts.itemId,
      itemTitle: opts.itemTitle,
      folderId: opts.folderId,
      timestamp: now,
    })),
  );
}
