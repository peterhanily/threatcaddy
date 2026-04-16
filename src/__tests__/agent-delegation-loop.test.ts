/**
 * End-to-end test for the Phase 3 delegation loop hardening.
 *
 * Goes through the public executeTool dispatcher (no LLM, no UI), so it
 * exercises the real review_completed_task path including the escalation
 * threshold, the structured-delta validation, and the dispatcher-level
 * block on agent updates to escalated tasks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { ToolUseBlock, Task, Folder } from '../types';
import { executeTool } from '../lib/llm-tools';

const FOLDER_ID = 'test-folder';
const LEAD_PROFILE_ID = 'ap-lead-analyst';
const SPECIALIST_PROFILE_ID = 'ap-ioc-enricher';

async function seedFolder(): Promise<Folder> {
  const f: Folder = {
    id: FOLDER_ID, name: 'Test', order: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await db.folders.add(f);
  return f;
}

async function seedTask(): Promise<Task> {
  const now = Date.now();
  const t: Task = {
    id: nanoid(),
    title: 'Enrich the IOC',
    description: 'Run vendor enrichment on the suspect IP.',
    completed: false,
    priority: 'medium',
    folderId: FOLDER_ID,
    tags: [],
    status: 'in-progress',
    order: 0,
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.tasks.add(t);
  return t;
}

function reviewCall(taskId: string, requestedDelta: string, quality: 'good' | 'needs-redo' | 'serious-failure' = 'needs-redo'): ToolUseBlock {
  return {
    type: 'tool_use', id: nanoid(), name: 'review_completed_task',
    input: { taskId, quality, feedback: 'Reviewer feedback text.', requestedDelta },
  };
}

async function review(taskId: string, requestedDelta: string, quality: 'good' | 'needs-redo' | 'serious-failure' = 'needs-redo') {
  const r = await executeTool(reviewCall(taskId, requestedDelta, quality), FOLDER_ID, { profileId: LEAD_PROFILE_ID });
  return JSON.parse(r.result);
}

describe('Phase 3 delegation loop', () => {
  beforeEach(async () => {
    await db.folders.clear();
    await db.tasks.clear();
    await db.notes.clear();
    await db.agentActions.clear();
    await seedFolder();
  });

  it('rejects with quality=good is a no-op pass', async () => {
    const t = await seedTask();
    const r = await review(t.id, '', 'good');
    expect(r.success).toBe(true);
    expect(r.escalated).toBeUndefined();
    const after = await db.tasks.get(t.id);
    expect(after?.rejectionCount).toBeUndefined();
    expect(after?.escalated).toBeUndefined();
  });

  it('refuses rejection without a structured requestedDelta', async () => {
    const t = await seedTask();
    const r = await review(t.id, 'too short');
    expect(r.error).toContain('requestedDelta');
    const after = await db.tasks.get(t.id);
    expect(after?.rejectionCount).toBeUndefined();
  });

  it('refuses an identical requestedDelta on a follow-up rejection', async () => {
    const t = await seedTask();
    const delta = 'Re-run enrich_ioc with shodan flag enabled this time.';
    const r1 = await review(t.id, delta);
    expect(r1.success).toBe(true);
    expect(r1.rejectionCount).toBe(1);

    const r2 = await review(t.id, delta);
    expect(r2.error).toContain('identical');
  });

  it('auto-escalates after the third distinct rejection and freezes the task', async () => {
    const t = await seedTask();
    const r1 = await review(t.id, 'Re-run enrich_ioc with shodan flag set.');
    expect(r1.rejectionCount).toBe(1);
    expect(r1.escalated).toBe(false);

    const r2 = await review(t.id, 'Add MITRE T1071.001 mapping to the writeup.');
    expect(r2.rejectionCount).toBe(2);
    expect(r2.escalated).toBe(false);

    const r3 = await review(t.id, 'Cross-reference the IP against the AlienVault OTX pulse.');
    expect(r3.rejectionCount).toBe(3);
    expect(r3.escalated).toBe(true);

    const after = await db.tasks.get(t.id);
    expect(after?.escalated).toBe(true);
    expect(after?.tags).toContain('escalated');
    expect(after?.rejectionCount).toBe(3);
    expect(after?.rejectionHistory?.length).toBe(3);
    expect(after?.rejectionHistory?.[2].requestedDelta).toContain('AlienVault');
  });

  it('serious-failure escalates immediately on rejection #1', async () => {
    const t = await seedTask();
    const r = await review(t.id, 'This needs a senior analyst — we missed the data exfiltration evidence.', 'serious-failure');
    expect(r.escalated).toBe(true);
    expect(r.rejectionCount).toBe(1);
    const after = await db.tasks.get(t.id);
    expect(after?.escalated).toBe(true);
  });

  it('blocks an agent from updating an escalated task', async () => {
    const t = await seedTask();
    // Force escalation via serious-failure
    await review(t.id, 'Critical miss — incomplete chain of custody documented.', 'serious-failure');

    const updateCall: ToolUseBlock = {
      type: 'tool_use', id: nanoid(), name: 'update_task',
      input: { id: t.id, status: 'in-progress' },
    };
    const r = await executeTool(updateCall, FOLDER_ID, { profileId: SPECIALIST_PROFILE_ID });
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.result);
    expect(parsed.escalated).toBe(true);
    expect(parsed.error).toContain('escalated');

    // Task state must remain escalated; the failed update must not have flipped status.
    const after = await db.tasks.get(t.id);
    expect(after?.escalated).toBe(true);
    expect(after?.status).toBe('todo'); // serious-failure routed it to todo + high priority
  });

  it('also blocks lead agents — only humans can unstick', async () => {
    const t = await seedTask();
    await review(t.id, 'Critical miss — incomplete chain of custody documented.', 'serious-failure');

    const updateCall: ToolUseBlock = {
      type: 'tool_use', id: nanoid(), name: 'update_task',
      input: { id: t.id, status: 'done' },
    };
    const r = await executeTool(updateCall, FOLDER_ID, { profileId: LEAD_PROFILE_ID });
    expect(r.isError).toBe(true);
  });

  it('a human (no agentContext) can still update an escalated task', async () => {
    const t = await seedTask();
    await review(t.id, 'Critical miss — incomplete chain of custody documented.', 'serious-failure');

    const updateCall: ToolUseBlock = {
      type: 'tool_use', id: nanoid(), name: 'update_task',
      input: { id: t.id, status: 'done' },
    };
    // No agentContext → agentRole is undefined → escalation gate doesn't trigger.
    const r = await executeTool(updateCall, FOLDER_ID);
    expect(r.isError).toBe(false);
    const after = await db.tasks.get(t.id);
    expect(after?.status).toBe('done');
  });
});
