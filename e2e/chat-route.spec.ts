import { expect, test } from '@playwright/test';
import { goToApp } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

test.use({ serviceWorkers: 'block' });

test('server-only chat keeps its custom model and unsent draft when another tab signs out', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  const llmRequests: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Only the server transport is a fixture. Authentication storage, the native
  // cross-tab storage event, chat components, drafts and IndexedDB are real.
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
    if (url.pathname.startsWith('/fictional-team/') || url.pathname.startsWith('/fictional-local/')) {
      if (url.pathname.endsWith('/api/llm/chat') || url.pathname.startsWith('/fictional-local/')) llmRequests.push(route.request().postData() || '');
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic server is offline' }) });
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { chatThreads: [{ id: 'fictional-server-route', title: 'Fictional server route', messages: [],
    provider: 'anthropic', model: 'fictional-server-custom-model', mode: 'plan', tags: [], createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: location.origin + '/fictional-team',
      accessToken: 'synthetic-not-a-credential', refreshToken: 'synthetic-not-a-refresh-credential',
      user: { id: 'fictional-user', email: 'fictional@example.invalid', displayName: 'Fictional analyst', role: 'member' } }));
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', llmRoutingMode: 'server', tiAutoExtractEnabled: false,
      llmLocalEndpoint: location.origin + '/fictional-local/', llmLocalModelName: 'fictional-local-model' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat' }));
    sessionStorage.setItem('tc-chat-thread', 'fictional-server-route');
  });
  await page.reload();
  // The first signed-in visit has a genuine onboarding dialog. Dismiss it
  // before interacting with the background composer on every browser engine.
  const welcome = page.getByRole('dialog', { name: /^Welcome to / });
  await welcome.getByRole('button', { name: 'Get Started', exact: true }).click();
  await expect(welcome).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
  const send = page.getByRole('button', { name: 'Send message (Enter)', exact: true });
  const draft = 'Fictional unsent server-only draft — keep this exactly.';
  await input.fill(draft);
  await expect(page.getByText('Team server route', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'AI model', exact: true })).toHaveValue('fictional-server-custom-model');
  await expect(send).toBeEnabled();

  const otherTab = await context.newPage();
  await otherTab.goto('/privacy.html');
  await otherTab.evaluate(() => localStorage.removeItem('threatcaddy-auth'));
  await expect(page.getByText('Team server route', { exact: true })).toHaveCount(0);
  await expect(send).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'AI model', exact: true })).toHaveValue('fictional-server-custom-model');
  await expect(input).toHaveValue(draft);
  await input.press('Enter');
  await expect(input).toHaveValue(draft);
  const thread = (await readRows(page, ['chatThreads'])).chatThreads.find(row => row.id === 'fictional-server-route');
  expect(thread).toMatchObject({ provider: 'anthropic', model: 'fictional-server-custom-model', messages: [] });
  expect(llmRequests).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
