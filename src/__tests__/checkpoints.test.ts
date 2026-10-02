import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { executeCheckpointedTool, restoreCheckpoint } from '../lib/checkpoints';
import { executeTool } from '../lib/llm-tools';
import { revisionKey } from '../lib/sync-state';
import type { Note, ToolUseBlock } from '../types';

const context = { id: 'checkpoint', threadId: 'thread', messageId: 'assistant' };
const note = (id: string): Note => ({ id, title: 'Before', content: 'Original body', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const tool = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: 'call', name, input });
const run = (call: ToolUseBlock) => executeCheckpointedTool(context, call, () => executeTool(call));
beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.checkpoints.clear(), db.standaloneIOCs.clear(), db.table('_syncMeta').clear()]);
});

describe('transactional AI undo', () => {
  it('captures the real preimage and first preimage across repeated edits', async () => {
    await db.notes.add(note('note'));
    expect((await run(tool('update_note', { id: 'note', title: 'First' }))).isError).toBe(false);
    expect((await run(tool('update_note', { id: 'note', title: 'Last' }))).isError).toBe(false);
    const checkpoint = (await db.checkpoints.get(context.id))!;
    expect(checkpoint.snapshot[0].data?.title).toBe('Before');
    expect(checkpoint.snapshot[0].after?.title).toBe('Last');
    expect(await restoreCheckpoint(context.id)).toBe(true);
    expect(await db.notes.get('note')).toEqual(note('note'));
    expect(await restoreCheckpoint(context.id)).toBe(false);
  });

  it('tracks bulk-created IOC IDs from the actual result and removes them on undo', async () => {
    expect((await run(tool('bulk_create_iocs', { iocs: [{ type: 'domain', value: 'example.com' }, { type: 'ipv4', value: '192.0.2.1' }] }))).isError).toBe(false);
    expect(await db.standaloneIOCs.count()).toBe(2);
    expect((await db.checkpoints.get(context.id))?.snapshot).toHaveLength(2);
    await restoreCheckpoint(context.id);
    expect(await db.standaloneIOCs.count()).toBe(0);
  });

  it('refuses the entire undo group when one entity has a later edit', async () => {
    await db.notes.bulkAdd([note('first'), note('second')]);
    await run(tool('update_note', { id: 'first', title: 'AI first' }));
    await run(tool('update_note', { id: 'second', title: 'AI second' }));
    await db.notes.update('second', { title: 'Human edit' });
    await expect(restoreCheckpoint(context.id)).rejects.toThrow('changed');
    expect((await db.notes.get('first'))?.title).toBe('AI first');
    expect((await db.notes.get('second'))?.title).toBe('Human edit');
    expect((await db.checkpoints.get(context.id))?.restored).toBe(false);
  });

  it('also refuses later sync revisions even when visible content is identical', async () => {
    await db.notes.add(note('note'));
    await run(tool('update_note', { id: 'note', title: 'AI title' }));
    await db.table('_syncMeta').put({ key: revisionKey('notes', 'note'), value: 2 });
    await expect(restoreCheckpoint(context.id)).rejects.toThrow('revision changed');
    expect((await db.notes.get('note'))?.title).toBe('AI title');
  });

  it('rolls back entity changes if checkpoint persistence fails', async () => {
    await db.notes.add(note('note'));
    const put = vi.spyOn(db.checkpoints, 'put').mockRejectedValueOnce(new Error('Checkpoint unavailable'));
    const result = await run(tool('update_note', { id: 'note', title: 'Not committed' }));
    put.mockRestore();
    expect(result.isError).toBe(true);
    expect(await db.notes.get('note')).toEqual(note('note'));
    expect(await db.checkpoints.count()).toBe(0);
  });

  it('rolls back partial handler writes when the handler reports failure', async () => {
    await db.notes.add(note('note'));
    const result = await executeCheckpointedTool(context, tool('update_note', { id: 'note' }), async () => {
      await db.notes.update('note', { title: 'Partial' });
      return { result: 'Failed', isError: true };
    });
    expect(result).toEqual({ result: 'Failed', isError: true });
    expect(await db.notes.get('note')).toEqual(note('note'));
  });
});
