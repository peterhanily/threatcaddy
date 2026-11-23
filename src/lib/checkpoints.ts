import { db } from '../db';
import type { Checkpoint, CheckpointEntity, ToolUseBlock } from '../types';
import type { ToolExecutionResult } from './llm-tool-execution';
import { toolExecutionError } from './llm-tool-execution';
import { revisionKey } from './sync-state';

const tables: Record<string, string> = {
  create_note: 'notes', update_note: 'notes', generate_report: 'notes',
  create_task: 'tasks', update_task: 'tasks', create_ioc: 'standaloneIOCs',
  update_ioc: 'standaloneIOCs', bulk_create_iocs: 'standaloneIOCs',
  create_timeline_event: 'timelineEvents', update_timeline_event: 'timelineEvents',
  // connect_identities changes whichever identity holds the edge, so like link_entities it is not undoable.
  create_identity: 'identities', update_identity: 'identities',
};
const entityTables = new Set(Object.values(tables));
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
async function revision(table: string, id: string): Promise<number> {
  return (await db.table('_syncMeta').get(revisionKey(table, id)))?.value ?? 0;
}

/** Capture local writes and their undo record atomically. Network/integration
 * tools are deliberately not advertised as undoable. Locks span only local
 * IndexedDB work; no provider request or approval wait belongs in this callback. */
export async function executeCheckpointedTool(
  context: { id: string; threadId: string; messageId: string; signal?: AbortSignal },
  tool: ToolUseBlock,
  execute: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const tableName = tables[tool.name];
  if (!tableName) return execute();
  let failedResult: ToolExecutionResult | undefined;
  try {
    // Supported tools also read folders/timelines and observer attribution can
    // touch notes. All stores keep existing local handlers/outbox work atomic.
    return await db.transaction('rw', db.tables, async () => {
      const prior = await db.checkpoints.get(context.id);
      if (prior?.restored) throw new Error('This undo group was already restored.');
      const before: CheckpointEntity[] = [];
      if (tool.name.startsWith('update_')) {
        const id = String(tool.input.id || '');
        const data = await db.table(tableName).get(id) ?? null;
        before.push({ table: tableName, entityId: id, data });
      }
      for (const entry of before) {
        const previous = prior?.snapshot.find(row => row.table === entry.table && row.entityId === entry.entityId);
        if (previous && (canonical(entry.data) !== canonical(previous.after) || await revision(entry.table, entry.entityId) !== previous.afterRevision)) {
          throw new Error('The entity changed since this assistant turn began. Start a new turn before modifying it.');
        }
      }
      const result = await execute();
      if (context.signal?.aborted) throw new Error('Tool execution was cancelled; local changes rolled back.');
      if (result.isError) { failedResult = result; throw new Error('Tool write failed; changes rolled back.'); }
      if (!tool.name.startsWith('update_')) {
        const payload = JSON.parse(result.result);
        const ids = tool.name === 'bulk_create_iocs' ? payload.iocs?.map((row: { id: string }) => row.id) : [payload.id];
        if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Tool did not return usable entity IDs; write rolled back.');
        for (const id of ids) before.push({ table: tableName, entityId: id, data: null });
      }
      const snapshot = [...(prior?.snapshot ?? [])];
      for (const entry of before) {
        const after = await db.table(entry.table).get(entry.entityId) ?? null;
        const afterRevision = await revision(entry.table, entry.entityId);
        const index = snapshot.findIndex(row => row.table === entry.table && row.entityId === entry.entityId);
        if (index < 0) snapshot.push({ ...entry, after, afterRevision });
        else snapshot[index] = { ...snapshot[index], after, afterRevision };
      }
      await db.checkpoints.put({ id: context.id, threadId: context.threadId, messageId: context.messageId, toolNames: [...(prior?.toolNames ?? []), tool.name], snapshot,
        restored: false, createdAt: prior?.createdAt ?? Date.now() });
      return result;
    });
  } catch (error) {
    return failedResult ?? toolExecutionError(error instanceof Error ? error.message : 'The tool write could not be committed.');
  }
}

/** Validate every postimage/revision before modifying anything; restore rows
 * and mark the checkpoint in one transaction. Old unsafe snapshots fail closed. */
export async function restoreCheckpoint(checkpointId: string): Promise<boolean> {
  return db.transaction('rw', db.tables, async () => {
    const checkpoint = await db.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.restored) return false;
    for (const entity of checkpoint.snapshot) {
      if (!entityTables.has(entity.table) || entity.after === undefined || entity.afterRevision === undefined) {
        throw new Error('This older checkpoint cannot be restored safely.');
      }
      const current = await db.table(entity.table).get(entity.entityId) ?? null;
      if (canonical(current) !== canonical(entity.after) || await revision(entity.table, entity.entityId) !== entity.afterRevision) {
        throw new Error('An entity or its sync revision changed after this action. Undo was cancelled without changing any data.');
      }
    }
    for (const entity of checkpoint.snapshot) {
      if (entity.data === null) await db.table(entity.table).delete(entity.entityId);
      else await db.table(entity.table).put(entity.data);
      // An undone identity takes with it the connections made to it (connect_identities is not undoable on its own).
      if (entity.table === 'identities' && entity.data === null) {
        const pointing = await db.identities.filter(row => row.connections.some(edge => edge.targetId === entity.entityId)).toArray();
        for (const row of pointing) {
          await db.identities.update(row.id, { connections: row.connections.filter(edge => edge.targetId !== entity.entityId), updatedAt: Date.now() });
        }
      }
    }
    await db.checkpoints.update(checkpointId, { restored: true });
    return true;
  });
}

/**
 * Deletes the AI undo checkpoints that hold a copy of any removed row (an undo of it could no
 * longer apply) or belong to a removed chat thread, so a deleted identity's details, private
 * ones included, do not outlive it here. `removed` maps table names to removed ids. Call inside a
 * transaction that includes db.checkpoints.
 */
export async function deleteCheckpointsFor(removed: ReadonlyMap<string, ReadonlySet<string>>): Promise<void> {
  const threads = removed.get('chatThreads');
  const holds = (checkpoint: Checkpoint) => (threads?.has(checkpoint.threadId) ?? false)
    || checkpoint.snapshot.some(entity => removed.get(entity.table)?.has(entity.entityId) ?? false);
  const doomed = (await db.checkpoints.toArray()).filter(holds).map(checkpoint => checkpoint.id);
  if (doomed.length) await db.checkpoints.bulkDelete(doomed);
}

export async function getCheckpointsForThread(threadId: string): Promise<Checkpoint[]> {
  return db.checkpoints.where('threadId').equals(threadId).reverse().sortBy('createdAt');
}
export async function getCheckpointForMessage(messageId: string): Promise<Checkpoint | null> {
  return (await db.checkpoints.where('messageId').equals(messageId).first()) ?? null;
}
