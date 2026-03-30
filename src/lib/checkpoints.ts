import { nanoid } from 'nanoid';
import { db } from '../db';
import type { Checkpoint, CheckpointEntity, ToolCallRecord } from '../types';

/**
 * Map tool names to the Dexie tables they affect.
 * Returns the table name and how to extract the entity ID from the tool input/result.
 */
function getAffectedTable(toolName: string): string | null {
  switch (toolName) {
    case 'create_note':
    case 'update_note':
      return 'notes';
    case 'create_task':
    case 'update_task':
      return 'tasks';
    case 'create_ioc':
    case 'update_ioc':
    case 'bulk_create_iocs':
      return 'standaloneIOCs';
    case 'create_timeline_event':
    case 'update_timeline_event':
      return 'timelineEvents';
    case 'generate_report':
      return 'notes'; // reports are saved as notes
    default:
      return null;
  }
}

/**
 * Snapshot entities BEFORE write tools execute.
 * For create operations, we record null (entity doesn't exist yet).
 * For update operations, we capture the current state.
 */
export async function snapshotBeforeTools(
  toolCalls: ToolCallRecord[],
): Promise<CheckpointEntity[]> {
  const entities: CheckpointEntity[] = [];
  const seen = new Set<string>();

  for (const tc of toolCalls) {
    const table = getAffectedTable(tc.name);
    if (!table) continue;

    // For updates, snapshot the entity before modification
    if (tc.name.startsWith('update_')) {
      const id = tc.input.id as string;
      if (id && !seen.has(`${table}:${id}`)) {
        seen.add(`${table}:${id}`);
        const entity = await (db as unknown as Record<string, { get: (id: string) => Promise<unknown> }>)[table]?.get(id);
        entities.push({ table, entityId: id, data: (entity as Record<string, unknown>) || null });
      }
    }

    // For creates, record the created entity ID from the result so we can delete on restore
    if (tc.name.startsWith('create_') || tc.name === 'generate_report') {
      try {
        const result = JSON.parse(tc.result);
        if (result.id && !seen.has(`${table}:${result.id}`)) {
          seen.add(`${table}:${result.id}`);
          entities.push({ table, entityId: result.id, data: null }); // null = didn't exist before
        }
      } catch { /* ignore */ }
    }

    // bulk_create_iocs
    if (tc.name === 'bulk_create_iocs') {
      try {
        const result = JSON.parse(tc.result);
        if (result.created) {
          for (const ioc of result.created) {
            if (ioc.id && !seen.has(`${table}:${ioc.id}`)) {
              seen.add(`${table}:${ioc.id}`);
              entities.push({ table, entityId: ioc.id, data: null });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  return entities;
}

/**
 * Create a checkpoint after write tools have executed.
 */
export async function createCheckpoint(
  threadId: string,
  messageId: string,
  toolCalls: ToolCallRecord[],
): Promise<Checkpoint | null> {
  const writeTools = toolCalls.filter(tc => getAffectedTable(tc.name) !== null && !tc.isError);
  if (writeTools.length === 0) return null;

  const snapshot = await snapshotBeforeTools(writeTools);
  if (snapshot.length === 0) return null;

  const checkpoint: Checkpoint = {
    id: nanoid(),
    threadId,
    messageId,
    toolNames: writeTools.map(tc => tc.name),
    snapshot,
    restored: false,
    createdAt: Date.now(),
  };

  await db.checkpoints.add(checkpoint);
  return checkpoint;
}

/**
 * Restore a checkpoint: revert created entities (delete them) and
 * restore updated entities to their pre-action state.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<boolean> {
  const checkpoint = await db.checkpoints.get(checkpointId);
  if (!checkpoint || checkpoint.restored) return false;

  for (const entity of checkpoint.snapshot) {
    const table = (db as unknown as Record<string, { put: (data: unknown) => Promise<unknown>; delete: (id: string) => Promise<void> }>)[entity.table];
    if (!table) continue;

    if (entity.data === null) {
      // Entity was created — delete it
      await table.delete(entity.entityId);
    } else {
      // Entity was modified — restore original state
      await table.put(entity.data);
    }
  }

  // Mark as restored
  await db.checkpoints.update(checkpointId, { restored: true });
  return true;
}

/**
 * Get checkpoints for a thread, most recent first.
 */
export async function getCheckpointsForThread(threadId: string): Promise<Checkpoint[]> {
  return db.checkpoints.where('threadId').equals(threadId).reverse().sortBy('createdAt');
}

/**
 * Get checkpoint for a specific message.
 */
export async function getCheckpointForMessage(messageId: string): Promise<Checkpoint | null> {
  const results = await db.checkpoints.where('messageId').equals(messageId).toArray();
  return results[0] || null;
}
