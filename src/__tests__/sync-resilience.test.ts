import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { disableSync, revisionKey, suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { SyncEngine } from '../lib/sync-engine';
import { ensureSyncWorkspace } from '../lib/sync-workspace';
import { executeTool } from '../lib/llm-tools';
import { TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { IntegrationExecutor } from '../lib/integration-executor';
import { IOC_TYPE_LABELS } from '../types';

const GENERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const api = vi.hoisted(() => ({ push: vi.fn(), pull: vi.fn() }));
vi.mock('../lib/server-api', () => ({
  syncPush: api.push, syncSnapshot: vi.fn(),
  syncPull: async (...args: unknown[]) => ({ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...await api.pull(...args) }),
}));

const note = (id: string, title = 'Local note') => ({ id, title, content: 'body', folderId: 'f1', tags: [] as string[], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
const ioc = (id: string, type: string, value: string) => ({ id, type, value, confidence: 'medium', folderId: 'f1', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const task = (id: string) => ({ id, title: 'Delegated', completed: false, priority: 'medium', folderId: 'f1', tags: ['agent-delegated'], status: 'todo', order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
const remote = (table: string, row: Record<string, unknown>, version: number) => ({ ...row, table, op: 'put', version, createdBy: 'u2', updatedBy: 'u2', deletedAt: null });
const seed = (table: string, row: Record<string, unknown>) => db.transaction('rw', db.table(table), async () => { suppressSyncInCurrentTransaction(); await db.table(table).put(row); });
const acceptAll = async (changes: Array<{ table: string; entityId: string }>) => ({
  results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })),
});
/** Values visited by the server's structure budget (server/src/lib/sync-data-budget.ts). */
const nodes = (value: unknown): number => value === null || typeof value !== 'object' ? 1
  : 1 + (Array.isArray(value) ? value : Object.values(value)).reduce((sum: number, item) => sum + nodes(item), 0);

let engine: SyncEngine;
let onError: ReturnType<typeof vi.fn<(message: string | null) => void>>;
beforeEach(async () => {
  disableSync();
  setSessionKey(null);
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.folders.add({ id: 'f1', name: 'Phishing case', order: 0, createdAt: 1 });
  vi.clearAllMocks();
  api.push.mockImplementation(acceptAll);
  api.pull.mockImplementation(async (_since, _folder, cursor) => ({ changes: [], cursor, hasMore: false }));
  engine = new SyncEngine();
  await ensureSyncWorkspace('https://test.invalid', 'u1');
  await db.table('_syncMeta').put({ key: 'syncHistoryGenerationV1', value: GENERATION });
  engine.setWorkspaceIdentity('https://test.invalid', 'u1');
  onError = vi.fn<(message: string | null) => void>();
  engine.setErrorHandler(onError);
});
afterEach(() => { engine.stop(); disableSync(); });

describe('a server row this client cannot read', () => {
  const unreadable = [
    ['an IOC type outside the client list', 'standaloneIOCs', ioc('bad', 'ip', '203.0.113.7')],
    ['whiteboard elements over 500,000 UTF-8 bytes', 'whiteboards', { id: 'bad', name: 'Board', folderId: 'f1', elements: JSON.stringify(['界'.repeat(200_000)]), tags: [] }],
    ['whiteboard elements that are not an array', 'whiteboards', { id: 'bad', name: 'Board', folderId: 'f1', elements: '{}', tags: [] }],
  ] as const;

  it.each(unreadable)('skips %s, applies the rest of the page, moves the cursor and keeps uploading', async (_label, table, row) => {
    await engine.enqueue('notes', 'mine', 'put', note('mine', 'My queued edit'));
    api.pull.mockResolvedValueOnce({ changes: [remote(table, row, 1), remote('notes', note('n2', 'Teammate note'), 2)], cursor: '2', hasMore: false });
    await engine.sync();
    expect(await db.table(table).get('bad')).toBeUndefined();
    expect((await db.notes.get('n2'))?.title).toBe('Teammate note');
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('2');
    expect(api.push).toHaveBeenCalledTimes(1);
    expect(await db.table('_syncQueue').count()).toBe(0);
    // The skipped revision is not recorded: a later local edit still conflicts with it.
    expect(await db.table('_syncMeta').get(revisionKey(table, 'bad'))).toBeUndefined();
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Phishing case'));
  });

  it("keeps the author's own copy when its echo is unreadable, and names it until a readable revision arrives", async () => {
    await seed('standaloneIOCs', ioc('i1', 'ip', '203.0.113.7'));
    await db.table('_syncMeta').put({ key: revisionKey('standaloneIOCs', 'i1'), value: 1 });
    api.pull.mockResolvedValueOnce({ changes: [remote('standaloneIOCs', ioc('i1', 'ip', '203.0.113.7'), 1)], cursor: '1', hasMore: false });
    await engine.sync();
    expect(await db.standaloneIOCs.get('i1')).toMatchObject({ type: 'ip', value: '203.0.113.7' });
    expect((await db.table('_syncMeta').get('syncCursorV2'))?.value).toBe('1');
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('203.0.113.7'));

    onError.mockClear();
    await engine.sync(); // still reported on later cycles: never silently lost
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('203.0.113.7'));

    onError.mockClear();
    api.pull.mockResolvedValueOnce({ changes: [remote('standaloneIOCs', ioc('i1', 'ipv4', '203.0.113.7'), 2)], cursor: '3', hasMore: false });
    await engine.sync();
    expect(await db.standaloneIOCs.get('i1')).toMatchObject({ type: 'ipv4' });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('skips an unreadable row while re-downloading an investigation', async () => {
    api.pull.mockImplementation(async (_since, folderId, cursor) => folderId
      ? { changes: [remote('standaloneIOCs', ioc('bad', 'hash', 'abc'), 1), remote('notes', note('n2'), 2)], cursor: '2', hasMore: false }
      : { changes: [], cursor, hasMore: false });
    await engine.pullFolder('f1');
    expect(await db.notes.get('n2')).toBeDefined();
    expect(await db.standaloneIOCs.get('bad')).toBeUndefined();
  });

  it('resolves the other conflicts when Keep theirs meets an unreadable server version', async () => {
    await seed('standaloneIOCs', ioc('i1', 'domain', 'mine.test'));
    await seed('notes', note('n1', 'Mine'));
    await engine.enqueue('standaloneIOCs', 'i1', 'put', ioc('i1', 'domain', 'mine.test'));
    await engine.enqueue('notes', 'n1', 'put', note('n1', 'Mine'));
    await engine.resolveConflicts([
      { table: 'standaloneIOCs', entityId: 'i1', serverVersion: 3, serverData: { ...ioc('i1', 'ip', '198.51.100.1'), version: 3 } },
      { table: 'notes', entityId: 'n1', serverVersion: 4, serverData: { ...note('n1', 'Theirs'), version: 4 } },
    ], 'theirs');
    expect((await db.notes.get('n1'))?.title).toBe('Theirs');
    expect(await db.standaloneIOCs.get('i1')).toMatchObject({ type: 'domain', value: 'mine.test' });
    expect((await db.table('_syncQueue').toArray()).map(entry => entry.table)).toEqual(['standaloneIOCs']);
  });
});

describe('uploads the server would refuse', () => {
  // A server without per-change rejection refuses the whole request when one change breaks a limit.
  beforeEach(() => {
    api.push.mockImplementation(async (changes: Array<{ table: string; entityId: string; data?: Record<string, unknown> }>) => {
      const tooLong = changes.some(change => Object.values(change.data ?? {}).some(value => typeof value === 'string' && value.length > 500_000));
      if (tooLong || changes.reduce((sum, change) => sum + nodes(change.data), 0) > 100_000) throw new Error('Sync field exceeds the supported value limits');
      return acceptAll(changes);
    });
  });

  it('keeps a row other devices cannot read on this device, names it and uploads the rest', async () => {
    await seed('standaloneIOCs', ioc('i1', 'ip', '203.0.113.7'));
    await engine.enqueue('standaloneIOCs', 'i1', 'put', ioc('i1', 'ip', '203.0.113.7'));
    await engine.enqueue('notes', 'n1', 'put', note('n1'));
    await engine.sync();
    expect(api.push.mock.calls.flatMap(([changes]) => changes.map((change: { entityId: string }) => change.entityId))).toEqual(['n1']);
    expect((await db.table('_syncQueue').toArray()).map(entry => entry.entityId)).toEqual(['i1']);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('203.0.113.7'));
  });

  it('keeps a field over the server value limits on this device instead of failing the whole batch', async () => {
    await seed('notes', { ...note('big', 'Pasted log'), content: 'x'.repeat(500_001) });
    await engine.enqueue('notes', 'big', 'put', { ...note('big', 'Pasted log'), content: 'x'.repeat(500_001) });
    await engine.enqueue('notes', 'small', 'put', note('small'));
    await engine.enqueue('tasks', 't9', 'put', { ...task('t9'), tags: [] });
    await engine.sync();
    expect(api.push.mock.calls.flatMap(([changes]) => changes.map((change: { entityId: string }) => change.entityId)).sort()).toEqual(['small', 't9']);
    expect((await db.table('_syncQueue').toArray()).map(entry => entry.entityId)).toEqual(['big']);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Pasted log'));
  });

  it('keeps every request inside the server structure budget', async () => {
    for (let index = 0; index < 30; index++) {
      await engine.enqueue('notes', `n${index}`, 'put', { ...note(`n${index}`), tags: Array(4000).fill('t') });
    }
    await engine.sync();
    expect(api.push.mock.calls.length).toBeGreaterThan(1);
    for (const [changes] of api.push.mock.calls) {
      expect(changes.reduce((sum: number, change: { data: unknown }) => sum + nodes(change.data), 0)).toBeLessThanOrEqual(100_000);
    }
    expect(await db.table('_syncQueue').count()).toBe(0);
  });
});

describe('agent delegation and the server user foreign key', () => {
  const deployment = { id: 'dep-1', investigationId: 'f1', profileId: 'ap-ioc-enricher', status: 'idle', createdAt: 1, updatedAt: 1 };
  const pushedTasks = () => api.push.mock.calls.flatMap(([changes]) => changes).filter((change: { table: string }) => change.table === 'tasks');

  it('delegate_task records the agent on this device only and never uploads it as an assignee', async () => {
    await db.agentDeployments.add(deployment as never);
    const result = await executeTool({ type: 'tool_use', id: 'call-1', name: 'delegate_task',
      input: { title: 'Enrich the beacon IP', description: 'Look it up', assignToProfile: 'IOC Enricher' } }, 'f1', { profileId: 'ap-lead-analyst' });
    const { taskId, found } = JSON.parse(result.result);
    expect(found).toBe(true);
    expect(await db.tasks.get(taskId)).toMatchObject({ assignedDeploymentId: 'dep-1' });
    expect((await db.tasks.get(taskId))?.assigneeId).toBeUndefined();
    await engine.sync();
    expect(pushedTasks()).toHaveLength(1);
    expect(pushedTasks()[0].data).not.toHaveProperty('assigneeId');
  });

  it('does not upload a legacy agent assignee and moves it to the device-only field when the echo has none', async () => {
    await db.agentDeployments.add(deployment as never);
    await seed('tasks', { ...task('t1'), assigneeId: 'dep-1' });
    await engine.enqueue('tasks', 't1', 'put', { ...task('t1'), assigneeId: 'dep-1' });
    api.pull.mockResolvedValueOnce({ changes: [], cursor: '0', hasMore: false })
      .mockResolvedValueOnce({ changes: [{ ...remote('tasks', task('t1'), 1), assigneeId: null }], cursor: '1', hasMore: false });
    await engine.sync();
    expect(pushedTasks()).toHaveLength(1);
    expect(pushedTasks()[0].data).not.toHaveProperty('assigneeId');
    expect(await db.tasks.get('t1')).toMatchObject({ assignedDeploymentId: 'dep-1' });
    expect((await db.tasks.get('t1'))?.assigneeId).toBeUndefined();
  });

  it('create_task and update_task refuse an agent deployment as the assignee', async () => {
    await db.agentDeployments.add(deployment as never);
    const create = await executeTool({ type: 'tool_use', id: 'c', name: 'create_task', input: { title: 'X', assigneeId: 'dep-1' } }, 'f1');
    expect(JSON.parse(create.result).error).toContain('delegate_task');
    await seed('tasks', task('t2'));
    const update = await executeTool({ type: 'tool_use', id: 'u', name: 'update_task', input: { id: 't2', assigneeId: 'dep-1' } }, 'f1');
    expect(JSON.parse(update.result).error).toContain('delegate_task');
    expect((await db.tasks.get('t2'))?.assigneeId).toBeUndefined();
  });
});

describe('IOC types every client can read', () => {
  it('enrichment output cannot create or retype an IOC with a type other clients skip', async () => {
    await seed('standaloneIOCs', ioc('i1', 'domain', 'beacon.test'));
    await db.integrationTemplates.add({ id: 'template', schemaVersion: '1.0', version: '1.0.0', name: 'Fixture enrichment', description: 'Synthetic', author: 'test', icon: 'search', color: '#000', category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: [], steps: [], outputs: [], requiredDomains: [], source: 'user', createdAt: 1, updatedAt: 1 });
    await db.installedIntegrations.add({ id: 'installed', templateId: 'template', name: 'Fixture', enabled: true, config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    const outputs: PromiseSettledResult<unknown>[] = [];
    const run = vi.spyOn(IntegrationExecutor.prototype, 'run').mockImplementation(async (_template, _installation, _input, callbacks) => {
      outputs.push(...await Promise.allSettled([
        callbacks.onCreateEntity?.('ioc', { type: 'ip', value: '203.0.113.7' }),
        callbacks.onUpdateEntity?.('ioc', 'i1', { type: 'ip' }),
      ]));
      throw new Error('Fixture run finished');
    });
    try {
      await executeTool({ type: 'tool_use', id: 'e', name: 'enrich_ioc', input: { iocId: 'i1' } }, 'f1');
    } finally { run.mockRestore(); }
    expect(outputs.map(output => output.status === 'rejected' ? String(output.reason) : output.status)).toEqual([
      expect.stringContaining('unsupported IOC type'), expect.stringContaining('unsupported IOC type')]);
    expect((await db.standaloneIOCs.toArray()).map(row => [row.id, row.type])).toEqual([['i1', 'domain']]);
  });

  it('the server, its bot tool and the AI tool schemas accept exactly the IOC types clients read', () => {
    const source = (path: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..', path), 'utf8');
    const quoted = (list = '') => [...list.matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
    const client = Object.keys(IOC_TYPE_LABELS).sort();
    expect(quoted(source('server/src/services/sync-service.ts').match(/const IOC_TYPES = new Set\(\[([^\]]*)\]\)/)?.[1])).toEqual(client);
    expect(quoted(source('server/src/bots/bot-tools.ts').match(/name: 'create_ioc'[\s\S]*?type: \{ type: 'string', enum: \[([^\]]*)\]/)?.[1])).toEqual(client);
    type Schema = { properties: Record<string, { enum?: string[]; items?: Schema }> };
    const schema = (name: string) => TOOL_DEFINITIONS.find(tool => tool.name === name)?.input_schema as unknown as Schema;
    for (const types of [schema('create_ioc').properties.type.enum, schema('update_ioc').properties.type.enum,
      schema('bulk_create_iocs').properties.iocs.items?.properties.type.enum]) {
      expect([...types ?? []].sort()).toEqual(client);
    }
  });
});
