import { db } from '../db';
import type { Settings, ToolCallRecord } from '../types';
import { classifyToolCall } from './tool-reach';

/** Item tables that sync with their investigation. */
const ITEM_TABLES = ['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'evidenceItems', 'identities'] as const;

/** The write calls whose target classifyToolCall resolves (tool-reach.ts resolveTargets). Every
 * other write lands in its own conversation's investigation, so classifying it would find nothing. */
const REACHING_WRITES = new Set(['create_in_investigation', 'update_note', 'update_task', 'update_ioc', 'update_timeline_event',
  'link_entities', 'review_completed_task', 'enrich_ioc', 'delete_note_folder', 'move_to_folder', 'update_identity', 'connect_identities']);

/** Agents, the supervisor and the bridge tag what they create (D11); 2.0.2 rows carry only createdBy. */
const agentMade = (row: { tags?: unknown; createdBy?: unknown }) =>
  (Array.isArray(row.tags) && row.tags.includes('ai-generated'))
  || (typeof row.createdBy === 'string' && row.createdBy.startsWith('agent:'));

// Rows are read whole (toArray, count), never through a cursor: in an encrypted workspace a
// cursor awaits Web Crypto between rows, and WebKit ends the transaction before it can continue.

/** A conversation filed elsewhere that wrote here: from a local-only home, other local-only
 * investigations are in reach (tool-reach.ts). Agent audit messages record no tool calls. */
async function chatWroteHere(folderId: string): Promise<boolean> {
  const calls: { home?: string; call: ToolCallRecord }[] = [];
  for (const thread of await db.chatThreads.toArray()) {
    if (thread.folderId === folderId || !Array.isArray(thread.messages)) continue;
    for (const message of thread.messages) {
      for (const call of Array.isArray(message?.toolCalls) ? message.toolCalls : []) {
        if (typeof call?.name === 'string' && REACHING_WRITES.has(call.name)) calls.push({ home: thread.folderId, call });
      }
    }
  }
  if (!calls.length) return false;
  // One read-only transaction, as in the dispatcher: Dexie reads only.
  return db.transaction('r', db.tables, async () => {
    for (const { home, call } of calls) {
      // An enrichment writes onto its IOC, which update_ioc resolves the same way, without
      // enrich_ioc's integrations lookup (a cursor read).
      const placed = call.name === 'enrich_ioc'
        ? { name: 'update_ioc', input: { id: call.input?.iocId } }
        : { name: call.name, input: call.input };
      const reach = await classifyToolCall({ type: 'tool_use', id: call.id, ...placed },
        { homeFolderId: home, settings: {} as Settings });
      if (reach.targetFolderIds.includes(folderId)) return true;
    }
    return false;
  });
}

/**
 * Whether sharing this investigation would sync text AI wrote in it: a conversation or an
 * agent or supervisor audit thread with messages, an item an agent created, a change an agent
 * or the supervisor made here, or a write a conversation filed elsewhere made here. Chat-created
 * items carry no marker, so a conversation whose record is gone is not seen.
 * Trashed rows count: restoring one later syncs it.
 */
export async function hasAiWrittenContent(folderId: string): Promise<boolean> {
  const threads = await db.chatThreads.where('folderId').equals(folderId).toArray();
  if (threads.some(thread => (Array.isArray(thread.messages) && thread.messages.length > 0) || agentMade(thread))) return true;
  for (const table of ITEM_TABLES) {
    if ((await db.table(table).where('folderId').equals(folderId).toArray()).some(agentMade)) return true;
  }
  // 'approved' without a result: the write may have run before the outcome was recorded.
  for (const status of ['executed', 'approved']) {
    if (await db.agentActions.where('[investigationId+status]').equals([folderId, status]).count()) return true;
  }
  return chatWroteHere(folderId);
}
