import { db } from '../db';

/** Item tables that sync with their investigation. */
const ITEM_TABLES = ['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'evidenceItems'] as const;

/** Agents, the supervisor and the bridge tag what they create (D11); 2.0.2 rows carry only createdBy. */
const agentMade = (row: { tags?: unknown; createdBy?: unknown }) =>
  (Array.isArray(row.tags) && row.tags.includes('ai-generated'))
  || (typeof row.createdBy === 'string' && row.createdBy.startsWith('agent:'));

/**
 * Whether sharing this investigation would sync text AI wrote in it: a conversation or an
 * agent or supervisor audit thread with messages, or an item an agent created. Chat-created
 * items carry no marker, but the conversation that created them is filed here too.
 * Trashed rows count: restoring one later syncs it.
 */
export async function hasAiWrittenContent(folderId: string): Promise<boolean> {
  const threads = await db.chatThreads.where('folderId').equals(folderId)
    .filter(thread => (Array.isArray(thread.messages) && thread.messages.length > 0) || agentMade(thread)).count();
  if (threads) return true;
  for (const table of ITEM_TABLES) {
    if (await db.table(table).where('folderId').equals(folderId).filter(agentMade).count()) return true;
  }
  return false;
}
