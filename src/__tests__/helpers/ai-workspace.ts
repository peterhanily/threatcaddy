/**
 * A bound team workspace with four investigations, each holding a canary note,
 * task and IOC whose text is the folder's canary (no canary is a prefix of another):
 *   S  shared (synced), the usual home
 *   P  synced, private to other members
 *   L  local-only
 *   L2 local-only "hunting" case (a valid local-only home)
 * Writes after seeding are captured in _syncQueue, so tests can prove that no
 * foreign data reached a shared row or the outbox.
 */
import { db } from '../../db';
import type { Folder } from '../../types';
import { SYNC_WORKSPACE_KEY } from '../../lib/sync-capture-policy';
import { suppressSyncInCurrentTransaction } from '../../lib/sync-state';

export const WORKSPACE_IDENTITY = { version: 1, serverUrl: 'https://team.test.invalid', userId: 'analyst' } as const;
export const AI_FOLDERS = ['S', 'P', 'L', 'L2'] as const;
export type AIFolderId = typeof AI_FOLDERS[number];
const CANARIES: Record<string, string> = { S: 'CANARY-S', P: 'CANARY-P', L: 'CANARY-L', L2: 'CANARY-H' };
export const canary = (folderId: string) => CANARIES[folderId] ?? `CANARY-${folderId}`;
export const ids = (folderId: string) => ({ note: `${folderId}-note`, task: `${folderId}-task`, ioc: `${folderId}-ioc` });

const NAMES: Record<AIFolderId, string> = { S: 'Shared case', P: 'Private case', L: 'Local case', L2: 'Hunting case' };

export async function clearAIWorkspace(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
  });
}

export async function seedAIWorkspace(): Promise<void> {
  await clearAIWorkspace();
  const now = Date.now();
  for (const [order, id] of AI_FOLDERS.entries()) {
    const folder: Folder = { id, name: NAMES[id], order, createdAt: now, status: 'active', ...(id.startsWith('L') ? { localOnly: true } : {}) };
    await db.folders.add(folder);
    const { note, task, ioc } = ids(id);
    await db.notes.add({ id: note, folderId: id, title: `${NAMES[id]} note`, content: `Evidence ${canary(id)}`, tags: [], pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now });
    await db.tasks.add({ id: task, folderId: id, title: `${NAMES[id]} task`, description: `Follow up ${canary(id)}`, completed: false, priority: 'none', status: 'todo', order: 0, tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now });
    await db.standaloneIOCs.add({ id: ioc, folderId: id, type: 'domain', value: `${canary(id).toLowerCase()}.example`, analystNotes: canary(id), confidence: 'medium', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now });
  }
  await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value: WORKSPACE_IDENTITY });
  await db.table('_syncQueue').clear();
}

const contains = (value: unknown, needle: string) => JSON.stringify(value ?? null).includes(needle);

/** Whether any note, task, chat thread or IOC filed in folderId mentions the canary. */
export async function rowsContain(folderId: string, needle: string): Promise<boolean> {
  const tables = [db.notes, db.tasks, db.chatThreads, db.standaloneIOCs] as const;
  for (const table of tables) {
    const rows = await (table as typeof db.notes).where('folderId').equals(folderId).toArray();
    if (rows.some(row => contains(row, needle))) return true;
  }
  return false;
}

export async function syncQueueContains(needle: string): Promise<boolean> {
  return (await db.table('_syncQueue').toArray()).some(row => contains(row, needle));
}
