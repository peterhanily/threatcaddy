import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

const catalog = (namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../public/locales/en/${namespace}.json`, import.meta.url), 'utf8'));
const settings = catalog('settings');
const integrations = catalog('integrations');

test.use({ serviceWorkers: 'block' });

// Store 1.1.1 (66ec58f4 bridge.js:6) and 1.1.4 (extension/src/bridge.js:6).
const STORE_1_1_1_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];
const CAPS_1_1_4 = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

async function openAIDataFlow(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  const section = page.getByRole('region', { name: settings['ai.dataFlow.title'], exact: true });
  await expect(section).toBeVisible();
  return section;
}

// IR3: the section described only the default model's route, so it said requests stay local while a
// Claude thread went through the team server.
test('names the team server for cloud models when the default model is local, and a Claude thread does go there', async ({ page, context, baseURL }) => {
  const origin = new URL(String(baseURL)).origin;
  const llm: string[] = [];
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    if (url.pathname.startsWith('/fictional-team/') || url.pathname.startsWith('/fictional-local/')) {
      if (url.pathname.includes('/llm/') || url.pathname.startsWith('/fictional-local/')) llm.push(url.pathname);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic endpoint is offline' }) });
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { folders: [{ id: 'route-case', name: 'Fictional route case', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    chatThreads: [{ id: 'route-claude', title: 'Fictional Claude thread', messages: [], provider: 'anthropic', model: 'claude-sonnet-4-6',
      folderId: 'route-case', mode: 'act', tags: [], createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: location.origin + '/fictional-team',
      accessToken: 'synthetic-not-a-credential', refreshToken: 'synthetic-not-a-refresh-credential',
      user: { id: 'fictional-user', email: 'fictional@example.invalid', displayName: 'Fictional analyst', role: 'member' } }));
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false, serverUrl: location.origin + '/fictional-team',
      llmDefaultProvider: 'local', llmLocalEndpoint: location.origin + '/fictional-local', llmLocalModelName: 'fictional-local-model',
      llmAnthropicApiKey: 'synthetic-not-a-key' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat', selectedFolderId: 'route-case' }));
    sessionStorage.setItem('tc-chat-thread', 'route-claude');
  });
  await page.reload();
  const welcome = page.getByRole('dialog', { name: /^Welcome to / });
  await welcome.getByRole('button', { name: 'Get Started', exact: true }).click({ timeout: 15_000 });
  await expect(welcome).toHaveCount(0);

  const host = new URL(origin).host;
  const section = await openAIDataFlow(page);
  await expect(section.locator('p').nth(0)).toHaveText(settings['ai.dataFlow.routeLocal'].replace('{{host}}', host));
  await expect(section.locator('p').nth(1)).toHaveText(settings['ai.dataFlow.routeCloudServer'].replace('{{host}}', host));
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();

  const input = page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
  await input.fill('Summarise the case');
  await input.press('Enter');
  await expect.poll(() => llm.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(llm.every(path => path.startsWith('/fictional-team/api/llm/'))).toBe(true);
});

// One ThreatCaddy bridge owns the page listeners and answers pings; the page attribute may come from another.
for (const { name, owner, settingsLine, fetches } of [
  { name: 'store 1.1.1 owns the page while a newer copy published its capabilities', owner: STORE_1_1_1_CAPS,
    settingsLine: settings['ai.dataFlow.fetchUpdate'], fetches: 0 },
  { name: 'only a guarded 1.1.4 bridge answers', owner: CAPS_1_1_4, settingsLine: settings['ai.dataFlow.fetchSupported'], fetches: 1 },
]) test(`web fetch and Settings ask the bridge at call time: ${name}`, async ({ page, context, baseURL }) => {
  const origin = new URL(String(baseURL)).origin;
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket(/.*/, socket => socket.close());
  // The bridge that owns the page answers pings and relays fetches; the published capabilities stay guarded.
  await page.addInitScript(({ published, owner }) => {
    const fetched: string[] = [];
    Object.assign(window, { tcStubFetched: fetched });
    const publish = () => { document.documentElement.dataset.tcBridgeLoaded = '1'; document.documentElement.dataset.tcBridgeCaps = published.join(','); };
    if (document.documentElement) publish(); else document.addEventListener('DOMContentLoaded', publish);
    window.addEventListener('message', event => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === 'TC_EXTENSION_PING') {
        // Like bridge.js, answer from the listener.
        window.postMessage({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: owner }, location.origin);
      } else if (event.data.type === 'TC_FETCH_URL') {
        fetched.push(event.data.url);
        window.postMessage({ type: 'TC_FETCH_URL_RESULT', requestId: event.data.requestId, success: true, title: 'Fictional advisory', content: 'Fictional page' }, location.origin);
      }
    });
  }, { published: CAPS_1_1_4, owner });
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { folders: [{ id: 'fetch-case', name: 'Fictional fetch case', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    chatThreads: [{ id: 'fetch-thread', title: 'Fictional fetch thread', messages: [], provider: 'local', model: 'fictional-local-model',
      folderId: 'fetch-case', mode: 'act', tags: [], createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false,
      llmDefaultProvider: 'local', llmLocalEndpoint: location.origin + '/fictional-local', llmLocalModelName: 'fictional-local-model',
      agentHosts: [{ id: 'lab', name: 'lab', displayName: 'Fictional lab host', url: 'http://10.0.0.5:8080', enabled: true, skills: [] },
        { id: 'soc', name: 'soc', displayName: 'Fictional SOC host', url: 'https://soc.example', enabled: true, skills: [] }] }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat', selectedFolderId: 'fetch-case' }));
    sessionStorage.setItem('tc-chat-thread', 'fetch-thread');
  });
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible({ timeout: 15_000 });

  const section = await openAIDataFlow(page);
  await expect(section.getByText(settingsLine, { exact: true })).toBeVisible();
  await expect(section.getByText(owner === CAPS_1_1_4 ? settings['ai.dataFlow.fetchUpdate'] : settings['ai.dataFlow.fetchSupported'], { exact: true })).toHaveCount(0);
  const needsHttps = section.getByText(settings['ai.dataFlow.hostNeedsHttps'], { exact: true });
  await expect(needsHttps).toHaveCount(1);
  await expect(section.getByRole('listitem').filter({ hasText: 'http://10.0.0.5:8080' })).toContainText(settings['ai.dataFlow.hostNeedsHttps']);
  await expect(section.getByRole('listitem').filter({ hasText: 'https://soc.example' })).not.toContainText(settings['ai.dataFlow.hostNeedsHttps']);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();

  const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
  const input = page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
  await input.fill(`/fetch ${url}`);
  await input.press('Enter');
  if (fetches) {
    await expect.poll(async () => (await readRows(page, ['notes'])).notes.filter(note => note.title === 'Fictional advisory').length).toBe(1);
  } else {
    await expect(page.getByText(integrations['fetch.updateExtension'])).toBeVisible();
  }
  expect(await page.evaluate(() => (window as unknown as { tcStubFetched: string[] }).tcStubFetched)).toEqual(fetches ? [url] : []);
});
