import { expect, test, type Page } from '@playwright/test';
import { dismissInitialOverlays, navigateToView, waitForAppReady } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

test.use({ serviceWorkers: 'block' });

// A team investigation opened from Shared With Me without syncing it (remote mode) has no local
// folder row, yet a conversation started there is pushed to the team server under its id. CaddyAI
// there works in an investigation that syncs: a read of other investigations asks first, and a
// local-only investigation stays invisible, so none of its text reaches the team server.
// The team server and the local model are fixtures on this loopback origin.
const PREFIX = '/fictional-remote-team';
const LLM = '/fictional-remote-llm/v1';
const REMOTE = 'fictional-remote-team-case';
const REMOTE_NAME = 'Fictional remote team case';
const LOCAL = 'fictional-remote-private';
const LOCAL_NAME = 'Fictional private local-only case';
const CANARY = 'CANARY-REMOTE-SCOPE-5D2E';
const REPLY = 'Search finished.';

type Change = { table: string; entityId: string; op: string; data?: Record<string, unknown> };

async function fictionalTeam(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const pushed: Change[] = [];
  const serverThreads = new Map<string, Record<string, unknown>>();
  const llm: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const unexpected: string[] = [];
  const external: string[] = [];
  const now = new Date().toISOString();
  await page.routeWebSocket(/.*/, socket => {
    socket.onMessage(message => {
      if (typeof message !== 'string' || JSON.parse(message).type !== 'auth') return;
      socket.send(JSON.stringify({ type: 'auth-ok' }));
      // An invitation refreshes the list of team investigations at once.
      setTimeout(() => { try { socket.send(JSON.stringify({ type: 'folder-invite', folderId: REMOTE })); } catch { /* Closed. */ } }, 500);
    });
  });
  await page.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
    if (url.pathname === `${LLM}/chat/completions`) {
      const body = JSON.parse(request.postData() || '{}');
      llm.push(body);
      const tool = (body.messages as Array<{ role: string; content: unknown }>).find(message => message.role === 'tool');
      // The model quotes what the search found, as a reply normally does.
      const events = tool
        ? [{ choices: [{ delta: { content: `${REPLY} ${String(tool.content)}` } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_scope', function: { name: 'search_across_investigations', arguments: JSON.stringify({ query: 'informant' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
      return;
    }
    if (!url.pathname.startsWith(PREFIX + '/')) { await route.continue(); return; }
    const path = url.pathname.slice(PREFIX.length);
    let body: unknown;
    if (path === '/api/sync/pull') body = { changes: [], serverTimestamp: now, cursor: '0', generation: '0d0c0b0a-1111-4222-8333-444455556666', hasMore: false };
    else if (path === '/api/sync/push') {
      const { changes } = request.postDataJSON() as { changes: Change[] };
      for (const change of changes) {
        pushed.push(change);
        if (change.table === 'chatThreads' && change.data?.folderId === REMOTE) serverThreads.set(change.entityId, change.data);
      }
      body = { results: changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: pushed.length })) };
    } else if (path === '/api/investigations') body = { total: 1, offset: 0, limit: 50, data: [{ folderId: REMOTE, role: 'editor', joinedAt: now,
      folder: { name: REMOTE_NAME, status: 'active', description: 'Shared with the whole team.', tags: [], createdAt: now, updatedAt: now },
      entityCounts: { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: serverThreads.size }, memberCount: 6 }] };
    // As the real server's snapshot does, it returns the conversations pushed to the investigation.
    else if (path === `/api/sync/snapshot/${REMOTE}`) body = { folders: [{ id: REMOTE, name: REMOTE_NAME, order: 0, status: 'active', tags: [], createdAt: Date.now(), updatedAt: Date.now() }],
      notes: [], tasks: [], timelineEvents: [], whiteboards: [], standaloneIOCs: [], evidenceItems: [], chatThreads: [...serverThreads.values()] };
    else if (/^\/api\/investigations\/[^/]+\/members$/.test(path)) body = [];
    else if (['/api/notifications', '/api/audit/team', '/api/caddyshack'].includes(path)) body = [];
    else if (path === '/api/llm/config') body = { providers: [] };
    else if (path === '/api/server/info') body = { serverName: 'Fictional remote team' };
    else if (path === '/api/saved-searches') body = { searches: [] };
    else if (path.startsWith('/api/caddy-agents/status/')) body = { registered: false, serverRunning: false, serverExecutionAvailable: false, heartbeatStale: false, botCount: 0, lastHeartbeat: null };
    if (body === undefined) { unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 404, json: { error: 'Unconfigured fictional endpoint' } }); return; }
    await route.fulfill({ json: body });
  });
  return { serverUrl: origin + PREFIX, pushed, serverThreads, llm, unexpected, external };
}

async function openRemote(page: Page) {
  await navigateToView(page, 'Investigations');
  const remoteCard = page.getByRole('group', { name: REMOTE_NAME });
  await expect(remoteCard).toBeVisible({ timeout: 20_000 });
  await remoteCard.getByRole('button', { name: REMOTE_NAME, exact: true }).click();
  await expect(page.getByText(/Viewing a remote investigation/)).toBeVisible();
  await navigateToView(page, 'CaddyAI');
}

test('CaddyAI in a remote team investigation asks before reading other investigations and keeps local-only text off the team server', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const team = await fictionalTeam(page, String(baseURL));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ serverUrl, llm }) => {
    localStorage.setItem('caddyai-onboarded', '1');
    localStorage.setItem('caddyshack-onboarded', '1');
    localStorage.setItem(`tc-server-onboarded-${serverUrl}`, '1');
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl, accessToken: 'fictional-not-a-credential', refreshToken: 'fictional-not-a-refresh-credential',
      user: { id: 'fictional-remote-analyst', email: 'fictional@example.invalid', displayName: 'Fictional analyst', role: 'analyst' } }));
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', theme: 'dark', tiAutoExtractEnabled: false,
      llmLocalEndpoint: location.origin + llm, llmLocalModelName: 'fictional-local-model', llmDefaultProvider: 'local', llmDefaultModel: 'fictional-local-model' }));
  }, { serverUrl: team.serverUrl, llm: LLM });

  await page.goto('/');
  await dismissInitialOverlays(page);
  const welcome = page.getByRole('dialog', { name: /^Welcome to / });
  if (await welcome.isVisible({ timeout: 2_000 }).catch(() => false)) await welcome.getByRole('button', { name: 'Get Started', exact: true }).click();
  await waitForAppReady(page);
  // The app binds this workspace to the team server on its first connection.
  await expect.poll(async () => JSON.stringify((await readRows(page, ['_syncMeta']))._syncMeta), { timeout: 30_000 }).toContain('syncWorkspaceIdentityV1');
  const now = Date.now();
  await seedRows(page, {
    folders: [{ id: LOCAL, name: LOCAL_NAME, order: 0, status: 'active', tags: [], localOnly: true, createdAt: now, updatedAt: now }],
    notes: [{ id: 'fictional-remote-private-note', folderId: LOCAL, title: 'Private source', content: `Informant ${CANARY} must never leave this device.`,
      tags: [], pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now }],
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await waitForAppReady(page);

  // New Chat in the remote view files the conversation under the team investigation, which has no local row.
  await openRemote(page);
  await page.getByRole('button', { name: 'New Chat', exact: true }).first().click();
  await expect.poll(async () => (await readRows(page, ['chatThreads'])).chatThreads.filter(thread => thread.folderId === REMOTE).length, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => team.serverThreads.size, { timeout: 30_000 }).toBe(1);
  expect((await readRows(page, ['folders'])).folders.map(folder => folder.id)).not.toContain(REMOTE);

  // The remote view lists the conversation from the team server's snapshot, so open the investigation again.
  await navigateToView(page, 'Investigations');
  await page.getByRole('group', { name: LOCAL_NAME }).getByRole('button', { name: LOCAL_NAME, exact: true }).click();
  await openRemote(page);
  const composer = page.getByRole('textbox', { name: /CaddyAI$/ });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill('Anything relevant in my other cases?');
  await composer.press('Enter');

  // Act mode asks before the search, and the card says the conversation syncs.
  const card = page.getByRole('group', { name: 'Read other investigations?', exact: true });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(`What it reads becomes part of this conversation, which syncs to the members of "${REMOTE}".`, { exact: true })).toBeVisible();
  expect(team.llm).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath('1-remote-cross-read-card.png') });
  const approve = card.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeEnabled();
  await approve.click();

  // The approved search does not see the local-only investigation.
  await expect.poll(() => team.llm.length, { timeout: 15_000 }).toBe(2);
  const toolResult = String(team.llm[1].messages.find(message => message.role === 'tool')?.content);
  expect(toolResult).toContain('"hiddenLocalOnly":1');
  for (const leaked of [CANARY, LOCAL_NAME]) expect(toolResult).not.toContain(leaked);

  // The reply, which quotes the search result, reaches the team server; nothing local-only does.
  await expect.poll(() => team.pushed.some(change => change.table === 'chatThreads' && change.data?.folderId === REMOTE
    && JSON.stringify(change.data).includes(REPLY)), { timeout: 30_000 }).toBe(true);
  for (const leaked of [CANARY, LOCAL_NAME, LOCAL]) expect(JSON.stringify(team.pushed)).not.toContain(leaked);
  await page.screenshot({ path: testInfo.outputPath('2-after-push.png') });
  expect(team.unexpected).toEqual([]);
  expect(team.external).toEqual([]);
  expect(errors).toEqual([]);
});
