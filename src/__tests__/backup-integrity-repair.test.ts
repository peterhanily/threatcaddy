import { beforeEach, describe, expect, it } from 'vitest';
import { db, runWorkspaceContentMigrations } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { exportJSON } from '../lib/export';

const action = { investigationId: 'f', toolName: 'create_note', toolInput: { title: 'Draft' }, rationale: 'History', createdAt: 1 };
const summary = { startedAt: 1, durationMs: 1, whyThisCycle: 'Cycle', whatIDid: [], entitiesTouched: [], tokens: { input: NaN, output: 2 }, costUSD: NaN,
  toolCalls: { executed: 0, proposed: 0 }, toolHistogram: {}, errorHistogram: {}, turns: 1, outcome: 'success', provider: 'anthropic', model: 'model' };

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add({ id: 'f', name: 'Case', order: 0, createdAt: 1 });
});

/** Rows already written by 2.0.0/2.0.1 before the writers were fixed. */
async function seedAffectedRows() {
  await db.chatThreads.add({ id: 't', title: 'Audit', messages: [
    { id: 'm1', role: 'assistant', content: 'Turn', createdAt: 1, tokenCount: { input: NaN, output: NaN } },
    { id: 'm2', role: 'assistant', content: 'Summary', createdAt: 2, tokenCount: { input: NaN, output: 2 }, agentCycleSummary: summary as never },
    { id: 'm3', role: 'user', content: 'Untouched', createdAt: 3, tokenCount: { input: 7, output: 8 } },
  ], model: 'model', provider: 'anthropic', folderId: 'f', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 5 });
  await db.agentDeployments.add({ id: 'd', investigationId: 'f', profileId: 'p', status: 'idle', order: 0, createdAt: 1, updatedAt: 5,
    metrics: { cyclesRun: 2, toolCallsExecuted: 0, toolCallsProposed: 0, tasksCompleted: 0, tasksRejected: 0, tokensUsed: { input: NaN, output: 4 }, lastCycleAt: 1, costUSD: NaN } });
  await db.table('agentMeetings').bulkAdd([
    { id: 'purged-minutes', investigationId: 'f', participantDeploymentIds: [], threadId: 'mt', agenda: 'A', status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1, updatedAt: 9 },
    { id: 'deleted-thread', investigationId: 'f', participantDeploymentIds: [], agenda: 'B', status: 'completed', roundsCompleted: 1, maxRounds: 1, createdAt: 1, updatedAt: 9 },
  ]);
  await db.table('agentActions').bulkAdd([
    { ...action, id: 'deleted-thread', status: 'executed', updatedAt: 9 },
    { ...action, id: 'recovered', threadId: 't', status: 'rejected', result: 'Recovered from archive; request and review a new approval before execution.' },
    { ...action, id: 'recovered-with-summary', threadId: 't', status: 'rejected', result: 'Recovered from archive', resultSummary: 'Earlier summary' },
  ]);
}

describe('one-time backup integrity repair', () => {
  it('turns already-affected rows backup-valid without touching modification times', async () => {
    await seedAffectedRows();
    await expect(buildFullBackupPayload('all')).rejects.toThrow();
    await runWorkspaceContentMigrations();

    const thread = await db.chatThreads.get('t');
    expect(thread?.updatedAt).toBe(5);
    expect(thread?.messages.map(message => message.tokenCount)).toEqual([{ input: 0, output: 0 }, { input: 0, output: 2 }, { input: 7, output: 8 }]);
    expect(thread?.messages[1].agentCycleSummary).toMatchObject({ tokens: { input: 0, output: 2 }, costUSD: 0 });
    const deployment = await db.agentDeployments.get('d');
    expect(deployment?.updatedAt).toBe(5);
    expect(deployment?.metrics).toMatchObject({ tokensUsed: { input: 0, output: 4 }, costUSD: 0, cyclesRun: 2 });
    const meetings = await db.agentMeetings.toArray();
    for (const meeting of meetings) expect(meeting).not.toHaveProperty('updatedAt');
    expect((await db.agentMeetings.get('purged-minutes'))?.threadId).toBe('mt');
    expect((await db.agentMeetings.get('deleted-thread'))?.threadId).toBe('');
    expect(await db.agentActions.get('deleted-thread')).toMatchObject({ threadId: '', status: 'executed' });
    expect(await db.agentActions.get('deleted-thread')).not.toHaveProperty('updatedAt');
    expect(await db.agentActions.get('recovered')).toMatchObject({ resultSummary: expect.stringContaining('Recovered from archive') });
    expect(await db.agentActions.get('recovered')).not.toHaveProperty('result');
    expect(await db.agentActions.get('recovered-with-summary')).toMatchObject({ resultSummary: 'Earlier summary' });
    expect(await db.agentActions.get('recovered-with-summary')).not.toHaveProperty('result');

    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(buildFullBackupPayload('investigation', 'f')).resolves.toBeDefined();
    await expect(exportJSON()).resolves.toContain('threatcaddy-backup');
  });

  it('runs once and never queues sync work', async () => {
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://team.example', userId: 'alice' } });
    await seedAffectedRows();
    await db.table('_syncQueue').clear();
    await runWorkspaceContentMigrations();
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect(await db.table('_localMigrations').get('backup-integrity-v1')).toBeDefined();
    await db.table('agentMeetings').update('purged-minutes', { updatedAt: 10 });
    await runWorkspaceContentMigrations();
    expect(await db.agentMeetings.get('purged-minutes')).toHaveProperty('updatedAt', 10);
  });
});
