/** Real HTTP/PostgreSQL + browser IndexedDB sync qualification. No application
 * credentials or browser profiles are used. Build the server before running. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from 'argon2';
import { chromium, type Page } from '@playwright/test';
import { build } from 'vite';
import { scratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = await mkdtemp(join(tmpdir(), 'threatcaddy-sync-client-'));
const source = (name: string) => JSON.stringify(resolve(root, 'src', name));
// This adapter invokes the actual client engine, sanitizers, durable outbox,
// backup exporter and cache eviction. Only the test page shell is synthetic.
const entry = `
import { db } from ${source('db.ts')};
import { SyncEngine } from ${source('lib/sync-engine.ts')};
import { configureServerApi } from ${source('lib/server-api.ts')};
import { exportJSON } from ${source('lib/export.ts')};
import { evictSyncedFolder } from ${source('lib/sync-cache.ts')};
const engine = new SyncEngine();
let errors = [], conflicts = [];
engine.setErrorHandler(error => { if (error) errors.push(error); });
engine.setConflictHandler(value => { conflicts = value; });
window.syncFixture = {
  async initialize({ url, token, userId }) {
    configureServerApi(url, async () => token);
    engine.setWorkspaceIdentity(url, userId);
    await engine.sync();
    if (errors.length) throw new Error(errors.join(' | '));
  },
  async put({ table, row }) { await db.table(table).put(row); },
  async get({ table, id }) { return await db.table(table).get(id) ?? null; },
  async sync() { errors = []; conflicts = []; await engine.sync(); if (errors.length) throw new Error(errors.join(' | ')); return conflicts; },
  async resolve(choice) { await engine.resolveConflicts(conflicts, choice); },
  async snapshot() { return JSON.parse(await exportJSON()); },
  async pending() { return await db.table('_syncQueue').count(); },
  async evict(id) { await evictSyncedFolder(id); },
  async download(id) { await engine.pullFolder(id); },
};
`;

await writeFile(join(evidence, 'sync-client-entry.js'), entry);
await build({
  configFile: false, root, envDir: false, publicDir: false,
  cacheDir: join(evidence, 'vite-cache'), logLevel: 'error',
  define: { __STANDALONE__: 'false' },
  build: { outDir: join(evidence, 'bundle'), emptyOutDir: true,
    lib: { entry: join(evidence, 'sync-client-entry.js'), formats: ['es'], fileName: () => 'sync-client.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const bundle = await readFile(join(evidence, 'bundle/sync-client.js'));
const database = await scratchDatabase({ maxConnections: 4 });
let artifact: Awaited<ReturnType<typeof stageBuiltServer>> | undefined;
const passed: string[] = [], external: string[] = [], pageErrors: string[] = [];
const calls: Array<{ path: string; status: number }> = [];
const check = (name: string) => { passed.push(name); console.log(JSON.stringify({ passed: name })); };
type Row = Record<string, unknown>;
async function invoke<T>(page: Page, method: string, argument?: unknown): Promise<T> {
  return page.evaluate(async ({ method, argument }) => {
    const fixture = (window as unknown as { syncFixture: Record<string, (value?: unknown) => Promise<unknown>> }).syncFixture;
    return fixture[method](argument);
  }, { method, argument }) as Promise<T>;
}
const get = (page: Page, table: string, id: string) => invoke<Row | null>(page, 'get', { table, id });
const put = (page: Page, table: string, row: Row) => invoke(page, 'put', { table, row });
const fieldsEqual = (row: Row | null, expected: Row, fields: string[]) => {
  assert.ok(row);
  for (const field of fields) assert.deepEqual(JSON.parse(JSON.stringify(row[field] ?? null)), JSON.parse(JSON.stringify(expected[field] ?? null)), `${expected.id}.${field}`);
};

try {
  await applyCurrentMigrations(database);
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hash(password);
  await database.sql`INSERT INTO users (id,email,display_name,password_hash,role)
    VALUES ('sync-owner','sync-owner@example.invalid','Synthetic owner',${passwordHash},'analyst')`;
  await database.sql`INSERT INTO folders (id,name,created_at,updated_at)
    VALUES ('sync-case','Synthetic sync case',now(),now())`;
  await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role)
    VALUES ('sync-owner-member','sync-case','sync-owner','owner')`;
  artifact = await stageBuiltServer();
  await bootBuiltServer(database, artifact, async ({ apiUrl }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const createDevice = async () => {
        const context = await browser.newContext();
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== apiUrl) { external.push(url.origin + url.pathname); return route.abort(); }
          if (url.pathname === '/__sync-test') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Isolated sync fixture</title><script type="module" src="/__sync-test.js"></script></html>' });
          if (url.pathname === '/__sync-test.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
          if (/^\/locales\/en\/[a-z-]+\.json$/.test(url.pathname)) return route.fulfill({ contentType: 'application/json', body: await readFile(join(root, 'public', url.pathname)) });
          return route.continue();
        });
        const login = await fetch(apiUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sync-owner@example.invalid', password }) });
        assert.equal(login.status, 200);
        const { accessToken } = await login.json() as { accessToken: string };
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) calls.push({ path: new URL(response.url()).pathname, status: response.status() }); });
        await page.goto(apiUrl + '/__sync-test');
        await page.waitForFunction(() => !!(window as unknown as { syncFixture?: unknown }).syncFixture);
        await invoke(page, 'initialize', { url: apiUrl, token: accessToken, userId: 'sync-owner' });
        return page;
      };
      const first = await createDevice();
      const now = Date.now();
      const common = { folderId: 'sync-case', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now };
      const comments = [{ id: 'comment', content: 'Verified synthetic observation', createdAt: now, userName: 'Synthetic analyst' }];
      const rows: Record<string, Row> = {
        folders: { ...await get(first, 'folders', 'sync-case'), id: 'sync-case', agentEnabled: true, agentStatus: 'idle', agentThreadId: 'agent-local', agentLastRunAt: now,
          agentPolicy: { autoApproveReads: true, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 30 }, noteTemplateIds: ['template-local'], playbookExecution: { templateId: 'playbook-local', templateName: 'Synthetic playbook', startedAt: now, steps: [{ stepIndex: 0, completed: true }] } },
        notes: { ...common, id: 'sync-note', title: 'Synthetic note', content: 'Preserved body', pinned: false, parentNoteId: 'note-folder', isFolder: true, reviewRequired: true },
        tasks: { ...common, id: 'sync-task', title: 'Original task', completed: false, priority: 'high', status: 'todo', order: 0,
          comments: [{ id: 'task-comment', text: 'Verified task observation', createdAt: now, authorName: 'Synthetic analyst' }],
          checklist: [{ id: 'item', text: 'Collect synthetic logs', done: true }], rejectionCount: 3, escalated: true,
          rejectionHistory: [{ at: now, quality: 'needs-redo', reason: 'Missing synthetic log', requestedDelta: 'Attach synthetic log' }] },
        standaloneIOCs: { ...common, id: 'sync-ioc', type: 'domain', value: 'example.invalid', confidence: 'high', firstSeen: now - 1, lastSeen: now, linkedEvidenceIds: ['evidence-local'], comments },
        timelineEvents: { ...common, id: 'sync-event', title: 'Synthetic event', timestamp: now, source: 'Synthetic proxy', confidence: 'high', eventType: 'other', timelineId: 'sync-timeline',
          linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false, latitude: 51.5072, longitude: -0.1276, comments },
        chatThreads: { ...common, id: 'sync-chat', title: 'Synthetic chat', model: 'fixture', provider: 'local', mode: 'plan', source: 'agent', contextSummary: 'Local summary', parentThreadId: 'chat-folder', isFolder: true,
          messages: [{ id: 'message', role: 'assistant', content: 'Synthetic result', createdAt: now,
            toolCalls: [{ id: 'tool', name: 'read_note', input: { id: 'sync-note' }, result: 'Synthetic output', isError: false }],
            agentCycleSummary: { startedAt: now, durationMs: 10, whyThisCycle: 'Synthetic', whatIDid: ['Read'], entitiesTouched: [], tokens: { input: 1, output: 1 }, costUSD: 0, toolCalls: { executed: 1, proposed: 0 }, toolHistogram: { read_note: 1 }, errorHistogram: {}, turns: 1, outcome: 'success', provider: 'local', model: 'fixture' },
            attachments: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] }] },
      };
      const localFields: Record<string, string[]> = {
        folders: ['agentEnabled', 'agentStatus', 'agentThreadId', 'agentLastRunAt', 'agentPolicy', 'noteTemplateIds', 'playbookExecution'],
        notes: ['parentNoteId', 'isFolder', 'reviewRequired'], tasks: ['checklist', 'rejectionCount', 'escalated', 'rejectionHistory'],
        standaloneIOCs: ['firstSeen', 'lastSeen', 'linkedEvidenceIds'], timelineEvents: [],
        chatThreads: ['mode', 'source', 'contextSummary', 'parentThreadId', 'isFolder'],
      };
      for (const [table, row] of Object.entries(rows)) await put(first, table, row);
      assert.deepEqual(await invoke(first, 'sync'), []);
      assert.equal(await invoke(first, 'pending'), 0);
      for (const [table, row] of Object.entries(rows)) fieldsEqual(await get(first, table, row.id as string), row, localFields[table]);
      const firstChat = await get(first, 'chatThreads', 'sync-chat');
      assert.deepEqual((firstChat?.messages as Row[])[0].toolCalls, (rows.chatThreads.messages as Row[])[0].toolCalls);
      assert.deepEqual((firstChat?.messages as Row[])[0].attachments, (rows.chatThreads.messages as Row[])[0].attachments);
      assert.deepEqual((firstChat?.messages as Row[])[0].agentCycleSummary, (rows.chatThreads.messages as Row[])[0].agentCycleSummary);
      fieldsEqual(await get(first, 'timelineEvents', 'sync-event'), rows.timelineEvents, ['latitude', 'longitude', 'comments']);
      fieldsEqual(await get(first, 'standaloneIOCs', 'sync-ioc'), rows.standaloneIOCs, ['comments']);
      check('accepted HTTP push and server echo preserve originating-device details in real IndexedDB');

      const [storedTask] = await database.sql`SELECT to_jsonb(tasks) AS record FROM tasks WHERE id='sync-task'`;
      assert.equal(Object.hasOwn(storedTask.record, 'checklist'), false);
      const [storedChat] = await database.sql`SELECT messages FROM chat_threads WHERE id='sync-chat'`;
      assert.equal(storedChat.messages[0].toolCalls, undefined);
      assert.equal(storedChat.messages[0].attachments, undefined);
      assert.equal(storedChat.messages[0].agentCycleSummary, undefined);
      check('PostgreSQL reflects the explicit shared-field contract, without uploading chat image/tool payloads');

      const second = await createDevice();
      for (const [table, row] of Object.entries(rows)) {
        const downloaded = await get(second, table, row.id as string);
        assert.ok(downloaded, `Fresh device receives ${table}`);
        for (const field of localFields[table]) assert.equal(downloaded[field], undefined, `Fresh device must not invent ${table}.${field}`);
      }
      fieldsEqual(await get(second, 'notes', 'sync-note'), rows.notes, ['content']);
      fieldsEqual(await get(second, 'tasks', 'sync-task'), rows.tasks, ['title', 'comments']);
      fieldsEqual(await get(second, 'timelineEvents', 'sync-event'), rows.timelineEvents, ['latitude', 'longitude', 'comments']);
      assert.equal(((await get(second, 'chatThreads', 'sync-chat'))?.messages as Row[])[0].toolCalls, undefined);
      assert.equal(((await get(second, 'chatThreads', 'sync-chat'))?.messages as Row[])[0].attachments, undefined);
      assert.equal(((await get(second, 'chatThreads', 'sync-chat'))?.messages as Row[])[0].agentCycleSummary, undefined);
      check('a fresh second browser receives shared content and accurately lacks device-only fields');

      for (const choice of ['theirs', 'mine']) {
        await put(first, 'tasks', { ...await get(first, 'tasks', 'sync-task'), title: `First device ${choice}`, updatedAt: Date.now() });
        await put(second, 'tasks', { ...await get(second, 'tasks', 'sync-task'), title: `Second device ${choice}`, updatedAt: Date.now() });
        assert.deepEqual(await invoke(second, 'sync'), []);
        const conflicts = await invoke<Row[]>(first, 'sync');
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].status, 'conflict');
        await invoke(first, 'resolve', choice);
        assert.deepEqual(await invoke(first, 'sync'), []);
        assert.deepEqual(await invoke(second, 'sync'), []);
        const expectedTitle = `${choice === 'mine' ? 'First' : 'Second'} device ${choice}`;
        assert.equal((await get(first, 'tasks', 'sync-task'))?.title, expectedTitle);
        assert.equal((await get(second, 'tasks', 'sync-task'))?.title, expectedTitle);
        fieldsEqual(await get(first, 'tasks', 'sync-task'), rows.tasks, localFields.tasks);
        assert.equal((await get(second, 'tasks', 'sync-task'))?.checklist, undefined);
        check(`real concurrent edits and Keep ${choice} preserve local task details and converge shared content`);
      }

      const backup = await invoke<Record<string, Row[]>>(first, 'snapshot');
      fieldsEqual(backup.tasks.find(row => row.id === 'sync-task') ?? null, rows.tasks, localFields.tasks);
      assert.deepEqual((backup.chatThreads.find(row => row.id === 'sync-chat')?.messages as Row[])[0].attachments, (rows.chatThreads.messages as Row[])[0].attachments);
      assert.deepEqual((backup.chatThreads.find(row => row.id === 'sync-chat')?.messages as Row[])[0].agentCycleSummary, (rows.chatThreads.messages as Row[])[0].agentCycleSummary);
      check('full client backup includes originating-device details omitted by team sync');

      await invoke(first, 'evict', 'sync-case');
      assert.equal(await get(first, 'tasks', 'sync-task'), null);
      await invoke(first, 'download', 'sync-case');
      assert.ok(await get(first, 'tasks', 'sync-task'));
      assert.equal((await get(first, 'tasks', 'sync-task'))?.checklist, undefined);
      check('removing a local copy then downloading again does not pretend to restore device-only data');
      assert.deepEqual(external, []);
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(calls.filter(call => call.status >= 400), []);
    } finally { await browser.close(); }
  });
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed, calls, external, pageErrors }, null, 2));
  console.log(JSON.stringify({ checks: passed.length, evidence }));
} finally {
  try { await artifact?.close(); } finally { await database.close(); }
}
