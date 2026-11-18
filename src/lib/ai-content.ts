import { db } from '../db';
import type { Settings, ToolCallRecord } from '../types';
import { isWriteTool } from './llm-tool-defs';
import { classifyToolCall } from './tool-reach';

/** Item tables that sync with their investigation. */
const ITEM_TABLES = ['notes', 'tasks', 'timelineEvents', 'whiteboards', 'standaloneIOCs', 'evidenceItems'] as const;

/** Agents, the supervisor and the bridge tag what they create (D11); 2.0.2 rows carry only createdBy. */
const agentMade = (row: { tags?: unknown; createdBy?: unknown }) =>
  (Array.isArray(row.tags) && row.tags.includes('ai-generated'))
  || (typeof row.createdBy === 'string' && row.createdBy.startsWith('agent:'));

/** A conversation filed elsewhere that wrote here: from a local-only home, other local-only
 * investigations are in reach (tool-reach.ts). Agent audit messages record no tool calls. */
async function chatWroteHere(folderId: string): Promise<boolean> {
  const calls: { home?: string; call: ToolCallRecord }[] = [];
  await db.chatThreads.each(thread => {
    if (thread.folderId === folderId || !Array.isArray(thread.messages)) return;
    for (const message of thread.messages) {
      for (const call of Array.isArray(message?.toolCalls) ? message.toolCalls : []) {
        if (typeof call?.name === 'string' && isWriteTool(call.name)) calls.push({ home: thread.folderId, call });
      }
    }
  });
  // One read-only transaction, as in the dispatcher: Dexie reads only.
  return db.transaction('r', db.tables, async () => {
    for (const { home, call } of calls) {
      const reach = await classifyToolCall({ type: 'tool_use', id: call.id, name: call.name, input: call.input },
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
  const threads = await db.chatThreads.where('folderId').equals(folderId)
    .filter(thread => (Array.isArray(thread.messages) && thread.messages.length > 0) || agentMade(thread)).count();
  if (threads) return true;
  for (const table of ITEM_TABLES) {
    if (await db.table(table).where('folderId').equals(folderId).filter(agentMade).count()) return true;
  }
  // 'approved' without a result: the write may have run before the outcome was recorded.
  if (await db.agentActions.where('[investigationId+status]').anyOf([[folderId, 'executed'], [folderId, 'approved']]).count()) return true;
  return chatWroteHere(folderId);
}
