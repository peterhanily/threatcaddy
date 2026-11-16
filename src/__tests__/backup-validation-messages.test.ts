import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { exportJSON } from '../lib/export';

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add({ id: 'f', name: 'Case', order: 0, createdAt: 1 });
  await db.notes.add({ id: 'n1', title: 'Confidential title', content: 'SECRET-CONTENT', folderId: 'f', tags: [], pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
});

async function exportError(): Promise<string> {
  const error = await exportJSON().then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  await expect(buildFullBackupPayload('all')).rejects.toThrow(message);
  return message;
}

describe('backup validation errors identify the offending record', () => {
  it('names table, field and record id for an out-of-contract row, without import wording or values', async () => {
    await db.table('agentMeetings').add({ id: 'meeting-7', investigationId: 'f', participantDeploymentIds: [], threadId: 't', agenda: 'SECRET-AGENDA',
      status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1, updatedAt: 2 });
    const message = await exportError();
    expect(message).toContain('agentMeetings.updatedAt (unsupported)');
    expect(message).toContain('agentMeetings:meeting-7');
    expect(message).not.toContain('imported');
    expect(message).not.toContain('SECRET');
  });

  it('names the nested path and record id for a non-finite number', async () => {
    await db.agentDeployments.add({ id: 'deployment-3', investigationId: 'f', profileId: 'p', status: 'idle', order: 0, createdAt: 1, updatedAt: 1,
      metrics: { cyclesRun: 1, toolCallsExecuted: 0, toolCallsProposed: 0, tasksCompleted: 0, tasksRejected: 0, tokensUsed: { input: NaN, output: 1 }, lastCycleAt: 1 } });
    const message = await exportError();
    expect(message).toContain('agentDeployments');
    expect(message).toContain('deployment-3');
    expect(message).toContain('metrics.tokensUsed.input');
    expect(message).not.toContain('imported');
  });

  it('keeps the field path that existing callers match on', async () => {
    await db.table('notes').update('n1', { version: 'not-a-revision' });
    const message = await exportError();
    expect(message).toContain('notes.version');
    expect(message).toContain('notes:n1');
    expect(message).not.toContain('not-a-revision');
  });
});
