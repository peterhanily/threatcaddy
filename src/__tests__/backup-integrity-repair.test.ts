import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, runWorkspaceContentMigrations } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { exportJSON } from '../lib/export';
import { generateMasterKey } from '../lib/crypto';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { initializeWorkspace, isWorkspaceInitialized } from '../lib/workspace-initialization';

const action = { investigationId: 'f', toolName: 'create_note', toolInput: { title: 'Draft' }, rationale: 'History', createdAt: 1 };
const summary = { startedAt: 1, durationMs: 1, whyThisCycle: 'Cycle', whatIDid: [], entitiesTouched: [], tokens: { input: NaN, output: 2 }, costUSD: NaN,
  toolCalls: { executed: 0, proposed: 0 }, toolHistogram: {}, errorHistogram: {}, turns: 1, outcome: 'success', provider: 'anthropic', model: 'model' };

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add({ id: 'f', name: 'Case', order: 0, createdAt: 1 });
});
afterEach(() => { vi.restoreAllMocks(); });

const entity = { folderId: 'f', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 5 };
const extracted = (...confidence: unknown[]) => ({ extractedAt: 1, iocs: confidence.map((value, index) =>
  ({ id: `x${index}`, type: 'domain', value: `x${index}.example`, confidence: value, firstSeen: 1, dismissed: false })) });
const event = { ...entity, timestamp: 1, title: 'Event', source: 'CaddyAI', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false, timelineId: 'tl' };

/** Enum values AI tool writes stored before 2.0.2 checked them. */
async function seedOffEnumRows() {
  await db.table('tasks').bulkAdd([
    { ...entity, id: 'ticket', title: 'Ticket', completed: false, priority: 'critical', status: 'todo', order: 0 },
    { ...entity, id: 'spelled', title: 'Spelled', completed: false, priority: 'High', status: 'IN_PROGRESS', order: 1 },
    { ...entity, id: 'finished', title: 'Finished', completed: false, priority: 'low', status: 'Done', order: 2 },
    { ...entity, id: 'closed', title: 'Closed', completed: true, priority: 'urgent', status: 'complete', order: 3, iocAnalysis: extracted('High', 'sure') },
  ]);
  await db.table('standaloneIOCs').bulkAdd([
    { ...entity, id: 'cased', type: 'domain', value: 'a.example', confidence: 'High' },
    { ...entity, id: 'unknown', type: 'domain', value: 'b.example', confidence: 'certain' },
  ]);
  await db.table('timelineEvents').bulkAdd([
    { ...event, id: 'pivot', eventType: 'lateral_movement', confidence: 'maybe', iocAnalysis: extracted('CONFIRMED') },
    { ...event, id: 'phish', eventType: 'phishing', confidence: 'Medium' },
  ]);
  await db.table('notes').add({ ...entity, id: 'note', title: 'Note', content: 'Body', pinned: false, iocAnalysis: extracted('low', 'Medium', 7) });
  await db.table('agentDeployments').bulkAdd([
    { id: 'cased-mode', investigationId: 'f', profileId: 'p', status: 'idle', order: 0, createdAt: 1, updatedAt: 5, competitiveness: 'Competitive' },
    { id: 'unknown-mode', investigationId: 'f', profileId: 'p', status: 'idle', order: 1, createdAt: 1, updatedAt: 5, competitiveness: 'aggressive' },
  ]);
}

/** enrich_ioc stored one object per provider before 2.0.2, where every reader expects a snapshot list. */
async function seedEnrichedIOC() {
  await db.table('standaloneIOCs').add({ ...entity, id: 'enriched', type: 'domain', value: 'c.example', confidence: 'high',
    enrichment: { virusTotal: { malicious: '3' }, shodan: [{ org: 'Example', ts: 1 }, 'stray'], urlhaus: 'none' } });
}

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

  it('turns off-enum values into what the fixed tools store, else the sync sanitizer default, without touching modification times', async () => {
    await seedOffEnumRows();
    await expect(buildFullBackupPayload('all')).rejects.toThrow();
    await runWorkspaceContentMigrations();

    const confidences = (row: { iocAnalysis?: { iocs: { confidence: string }[] } } | undefined) => row?.iocAnalysis?.iocs.map(ioc => ioc.confidence);
    const tasks = Object.fromEntries((await db.tasks.toArray()).map(task => [task.id, task]));
    expect(tasks.ticket).toMatchObject({ priority: 'high', status: 'todo', completed: false });
    expect(tasks.spelled).toMatchObject({ priority: 'high', status: 'in-progress', completed: false });
    expect(tasks.finished).toMatchObject({ priority: 'low', status: 'done', completed: true });
    expect(tasks.closed).toMatchObject({ priority: 'none', status: 'done', completed: true });
    expect(confidences(tasks.closed)).toEqual(['high', 'low']);
    expect((await db.standaloneIOCs.toArray()).map(ioc => [ioc.id, ioc.confidence])).toEqual([['cased', 'high'], ['unknown', 'low']]);
    expect(await db.timelineEvents.get('pivot')).toMatchObject({ eventType: 'lateral-movement', confidence: 'low' });
    expect(confidences(await db.timelineEvents.get('pivot'))).toEqual(['confirmed']);
    expect(await db.timelineEvents.get('phish')).toMatchObject({ eventType: 'other', confidence: 'medium' });
    expect(confidences(await db.notes.get('note'))).toEqual(['low', 'medium', 'low']);
    // Like the import sanitizer, an unknown mode is dropped; agents read a missing one as cooperative.
    expect((await db.agentDeployments.get('cased-mode'))?.competitiveness).toBe('competitive');
    expect(await db.agentDeployments.get('unknown-mode')).not.toHaveProperty('competitiveness');
    for (const table of [db.tasks, db.standaloneIOCs, db.timelineEvents, db.notes, db.agentDeployments] as const) {
      for (const row of await table.toArray()) expect(row.updatedAt).toBe(5);
    }

    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(exportJSON()).resolves.toContain('threatcaddy-backup');
  });

  it('turns enrichment stored as one object per provider into a snapshot list, keeping earlier snapshots', async () => {
    await seedEnrichedIOC();
    await expect(buildFullBackupPayload('all')).rejects.toThrow('standaloneIOCs.enrichment');
    await runWorkspaceContentMigrations();

    const ioc = await db.standaloneIOCs.get('enriched');
    expect(ioc?.enrichment).toEqual({ virusTotal: [{ malicious: '3' }], shodan: [{ org: 'Example', ts: 1 }] });
    expect(ioc).toMatchObject({ confidence: 'high', updatedAt: 5 });
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(exportJSON()).resolves.toContain('threatcaddy-backup');
  });

  it('repairs encrypted fields such as extracted IOC confidence once the workspace is unlocked', async () => {
    setEncryptionMeta({ version: 1, salt: '', wrappedKey: '', recoverySalt: '', recoveryWrappedKey: '', enabledAt: 1 });
    setSessionKey(await generateMasterKey());
    try {
      await seedOffEnumRows();
      await seedEnrichedIOC();
      await runWorkspaceContentMigrations();
      expect((await db.notes.get('note'))?.iocAnalysis?.iocs.map(ioc => ioc.confidence)).toEqual(['low', 'medium', 'low']);
      expect((await db.tasks.get('closed'))?.iocAnalysis?.iocs.map(ioc => ioc.confidence)).toEqual(['high', 'low']);
      expect((await db.tasks.get('closed'))?.title).toBe('Closed');
      expect((await db.standaloneIOCs.get('enriched'))?.enrichment).toEqual({ virusTotal: [{ malicious: '3' }], shodan: [{ org: 'Example', ts: 1 }] });
    } finally {
      setSessionKey(null);
      clearEncryptionMeta();
    }
  });

  it('does not block initialization when the repair fails, and retries on the next load', async () => {
    await seedOffEnumRows();
    const transaction = db.transaction.bind(db) as (...args: unknown[]) => unknown;
    const failing = vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => Array.isArray(args[1]) && args[1].includes('agentMeetings')
      ? Promise.reject(new Error('Private stored detail')) : transaction(...args)) as typeof db.transaction);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(initializeWorkspace()).resolves.toBeUndefined();
    expect(isWorkspaceInitialized()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retry'), 'Error');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Private stored detail');
    expect(await db.table('_localMigrations').get('backup-integrity-v1')).toBeUndefined();

    failing.mockRestore();
    await initializeWorkspace();
    expect(await db.table('_localMigrations').get('backup-integrity-v1')).toBeDefined();
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
  });

  it('never blocks startup on unexpected stored shapes', async () => {
    await db.table('chatThreads').add({ id: 'odd', title: 'Odd', messages: [null, 'text', { id: 'x', tokenCount: 'n/a', agentCycleSummary: 'none' },
      { id: 'y', tokenCount: { input: NaN }, agentCycleSummary: { tokens: null, costUSD: null } }], model: 'm', provider: 'anthropic', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    await db.table('agentDeployments').add({ id: 'odd', investigationId: 'f', profileId: 'p', status: 'idle', order: 0, createdAt: 1, updatedAt: 1, metrics: 'none' });
    await expect(runWorkspaceContentMigrations()).resolves.toBeUndefined();
    const messages = (await db.table('chatThreads').get('odd')).messages;
    expect(messages.slice(0, 3)).toEqual([null, 'text', { id: 'x', tokenCount: 'n/a', agentCycleSummary: 'none' }]);
    expect(messages[3]).toEqual({ id: 'y', tokenCount: { input: 0 }, agentCycleSummary: { tokens: null, costUSD: 0 } });
  });

  it('runs once and never queues sync work', async () => {
    await db.table('_syncMeta').put({ key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl: 'https://team.example', userId: 'alice' } });
    await seedAffectedRows();
    await seedOffEnumRows();
    await seedEnrichedIOC();
    await db.table('_syncQueue').clear();
    await runWorkspaceContentMigrations();
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect(await db.table('_localMigrations').get('backup-integrity-v1')).toBeDefined();
    await db.table('agentMeetings').update('purged-minutes', { updatedAt: 10 });
    await runWorkspaceContentMigrations();
    expect(await db.agentMeetings.get('purged-minutes')).toHaveProperty('updatedAt', 10);
  });
});
