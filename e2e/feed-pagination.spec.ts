import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { navigateToView } from './fixtures';

// The server transport is fictional. The authenticated app, feed, reply
// composer, native interactions and async rendering paths are production code.
test.use({ serviceWorkers: 'block' });

const userId = 'fictional-feed-viewer';
const rootA = 'fictional-thread-a';
const rootB = 'fictional-thread-b';
const rootContent = (id: string) => id === rootA ? 'Fictional root A' : 'Fictional root B';
const replyContent = (id: string, index: number) => `Fictional ${id === rootA ? 'A' : 'B'} reply ${String(index + 1).padStart(3, '0')}`;

function post(id: string, content: string, parentId: string | null = null) {
  return { id, content, parentId, replyToId: parentId, folderId: null, authorId: 'fictional-colleague',
    authorDisplayName: 'Fictional colleague', attachments: [], mentions: [], pinned: false, deleted: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function thread(id: string, continuation: boolean, reacted: boolean) {
  const total = id === rootA ? 52 : 1;
  const start = continuation ? 50 : 0;
  const count = continuation ? 2 : Math.min(total, 50);
  return { ...post(id, rootContent(id)), replyCount: total,
    reactions: id === rootA ? { '👍': { count: reacted ? 2 : 1, userIds: reacted ? [userId] : [],
      reactedByMe: reacted, userIdsScope: 'viewer', userIdsComplete: false } } : {},
    replies: Array.from({ length: count }, (_, offset) => post(`${id}-reply-${start + offset}`, replyContent(id, start + offset), id)),
    replyPage: { total, limit: 50, hasMore: !continuation && total > 50, nextCursor: !continuation && total > 50 ? 'fictional-page-two' : null } };
}

async function fictionalFeed(page: Page, context: BrowserContext, baseURL: string | undefined) {
  if (!baseURL) throw new Error('A loopback test origin is required');
  const parsed = new URL(baseURL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('Feed fixtures may only use loopback origins');
  const origin = parsed.origin;
  const prefix = '/fictional-feed-team';
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const requests: Array<{ path: string; method: string; cursor: string | null }> = [];
  const held: Array<{ route: Route; id: string; continuation: boolean }> = [];
  const state = { nextStatus: 200, holdNext: false, holdInitial: false, reacted: false };
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.routeWebSocket(/.*/, socket => {
    socket.onMessage(message => {
      if (typeof message === 'string' && JSON.parse(message).type === 'auth') socket.send(JSON.stringify({ type: 'auth-ok' }));
    });
  });
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(url.origin); await route.abort(); return; }
    if (!url.pathname.startsWith(prefix + '/')) { await route.continue(); return; }
    const path = url.pathname.slice(prefix.length);
    requests.push({ path, method: request.method(), cursor: url.searchParams.get('cursor') });
    const match = path.match(/^\/api\/caddyshack\/posts\/(fictional-thread-[ab])$/);
    if (match && request.method() === 'GET') {
      expect(url.searchParams.get('replies')).toBe('page');
      expect(url.searchParams.get('reactions')).toBe('summary');
      expect(url.searchParams.get('limit')).toBe('50');
      const continuation = url.searchParams.has('cursor');
      if ((continuation && state.holdNext) || (!continuation && state.holdInitial)) {
        if (continuation) state.holdNext = false; else state.holdInitial = false;
        held.push({ route, id: match[1], continuation });
        return;
      }
      if (continuation && state.nextStatus !== 200) {
        const status = state.nextStatus; state.nextStatus = 200;
        await route.fulfill({ status, json: { error: status === 403 ? 'Fictional access was removed' : 'Fictional temporary unavailability' } });
      } else await route.fulfill({ json: thread(match[1], continuation, state.reacted) });
      return;
    }
    if (path === `/api/caddyshack/posts/${rootA}/reactions` && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ emoji: '👍' });
      state.reacted = true;
      await route.fulfill({ json: { ok: true } }); return;
    }
    let body: unknown;
    if (path === '/api/caddyshack') body = [post(rootA, rootContent(rootA)), post(rootB, rootContent(rootB))];
    else if (path === '/api/server/info') body = { serverName: 'Fictional feed transport' };
    else if (['/api/notifications', '/api/audit/team'].includes(path)) body = [];
    else if (path === '/api/investigations') body = { data: [], total: 0, offset: 0, limit: 50 };
    else if (path === '/api/saved-searches') body = { searches: [] };
    else if (path === '/api/llm/config') body = { providers: [] };
    else if (path === '/api/sync/pull') body = { changes: [], serverTimestamp: new Date().toISOString(), cursor: '0',
      generation: '11111111-2222-4333-8444-555555555555', hasMore: false };
    else { unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: { error: 'Unconfigured fictional endpoint' } }); return; }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(({ prefix, userId }) => {
    localStorage.setItem('caddyshack-onboarded', '1');
    localStorage.setItem('caddyai-onboarded', '1');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: location.origin + prefix,
      accessToken: 'fictional-not-a-credential', refreshToken: 'fictional-not-a-refresh-credential',
      user: { id: userId, email: 'fictional@example.invalid', displayName: 'Fictional viewer', role: 'member' } }));
  }, { prefix, userId });
  // Do not use the generic initial-overlay helper here: on a fast load its
  // Close match can dismiss the very onboarding dialog exercised below.
  await page.goto('/');
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  const welcome = page.getByRole('dialog', { name: /^Welcome to / });
  await welcome.getByRole('button', { name: 'Get Started', exact: true }).click();
  await expect(welcome).toHaveCount(0);
  await navigateToView(page, 'Team Feed');
  await expect(page.getByText(rootContent(rootA), { exact: true })).toBeVisible();
  await page.getByText(rootContent(rootA), { exact: true }).click();
  await expect(page.getByPlaceholder('Write a reply...', { exact: true })).toBeVisible();
  return { state, held, requests, unexpected, pageErrors,
    async releaseHeld() {
      for (const entry of held.splice(0)) await entry.route.fulfill({ json: thread(entry.id, entry.continuation, state.reacted) });
    } };
}

test('reply pages show the full total and keep the draft through transient retry, continuation and reaction refresh', async ({ page, context, baseURL }, testInfo) => {
  const fixture = await fictionalFeed(page, context, baseURL);
  const draft = 'Fictional reply draft — preserve through every loading state.';
  const input = page.getByPlaceholder('Write a reply...', { exact: true });
  const replies = page.getByText(/^Fictional A reply \d{3}$/);
  await input.fill(draft);
  await expect(page.getByText('52 Replies', { exact: true })).toBeVisible();
  await expect(replies).toHaveCount(50);
  fixture.state.nextStatus = 503;
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: 'Something went wrong' });
  await expect(error).toBeVisible();
  await expect(input).toHaveValue(draft);
  await expect(replies).toHaveCount(50);
  await error.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(input).toHaveValue(draft);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(replies).toHaveCount(52);
  await expect(page.getByText(replyContent(rootA, 51), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expect(input).toHaveValue(draft);

  fixture.state.holdInitial = true;
  await page.getByRole('button', { name: '👍 1', exact: true }).click();
  await expect.poll(() => fixture.held.length).toBe(1);
  await expect(input).toHaveValue(draft);
  const newerDraft = draft + ' Typed while the refreshed first page is pending.';
  await input.fill(newerDraft);
  await fixture.releaseHeld();
  await expect(page.getByRole('button', { name: '👍 2', exact: true })).toBeVisible();
  await expect(input).toHaveValue(newerDraft);
  await expect(replies).toHaveCount(50);
  expect(fixture.requests.filter(row => row.cursor === 'fictional-page-two')).toHaveLength(2);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('feed-paging-retained-draft.png'), animations: 'disabled' });
});

test('a delayed continuation cannot replace another selected thread or its draft', async ({ page, context, baseURL }) => {
  const fixture = await fictionalFeed(page, context, baseURL);
  fixture.state.holdNext = true;
  const continuationResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/posts/${rootA}`) && url.searchParams.get('cursor') === 'fictional-page-two';
  });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => fixture.held.length).toBe(1);
  await page.getByRole('button', { name: 'Back to Team Feed', exact: true }).click();
  await page.getByText(rootContent(rootB), { exact: true }).click();
  const input = page.getByPlaceholder('Write a reply...', { exact: true });
  await input.fill('Fictional B draft must remain scoped to B.');
  await fixture.releaseHeld();
  await (await continuationResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText(rootContent(rootB), { exact: true })).toBeVisible();
  await expect(page.getByText(replyContent(rootB, 0), { exact: true })).toBeVisible();
  await expect(page.getByText(/^Fictional A reply \d{3}$/)).toHaveCount(0);
  await expect(page.getByText(rootContent(rootA), { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('Fictional B draft must remain scoped to B.');
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
});

test('access denial on a continuation clears the denied root, replies and reply composer', async ({ page, context, baseURL }) => {
  const fixture = await fictionalFeed(page, context, baseURL);
  await page.getByPlaceholder('Write a reply...', { exact: true }).fill('Fictional draft in an inaccessible thread.');
  fixture.state.nextStatus = 403;
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Something went wrong', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  await expect(page.getByText(rootContent(rootA), { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Fictional A reply \d{3}$/)).toHaveCount(0);
  await expect(page.getByPlaceholder('Write a reply...', { exact: true })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.pageErrors).toEqual([]);
});
