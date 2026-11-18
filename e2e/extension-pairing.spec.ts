import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { seedRows } from './client-lifecycle-fixtures';

const catalog = (namespace: string) => JSON.parse(readFileSync(new URL(`../public/locales/en/${namespace}.json`, import.meta.url), 'utf8'));
const chat = catalog('chat');

test.use({ serviceWorkers: 'block' });

// Store 1.1.1 (66ec58f4 bridge.js:6) and 1.1.4 (extension/src/bridge.js:6).
const STORE_1_1_1_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];
const CAPS_1_1_4 = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

/** One installed bridge, as bridge.js behaves: it publishes its capabilities, answers pings from its
 *  listener, and records every request the page gives it. */
async function openChatWithBridge(page: Page, baseURL: string | undefined, caps: string[]) {
  const origin = new URL(String(baseURL)).origin;
  await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.context().routeWebSocket(/.*/, socket => socket.close());
  await page.addInitScript(caps => {
    const requests: string[] = [];
    Object.assign(window, { tcStubRequests: requests });
    const publish = () => { document.documentElement.dataset.tcBridgeLoaded = '1'; document.documentElement.dataset.tcBridgeCaps = caps.join(','); };
    if (document.documentElement) publish(); else document.addEventListener('DOMContentLoaded', publish);
    window.addEventListener('message', event => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === 'TC_EXTENSION_PING') window.postMessage({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: caps }, location.origin);
      else if (['TC_LLM_REQUEST', 'TC_PROXY_FETCH', 'TC_FETCH_URL'].includes(event.data.type)) requests.push(event.data.type);
    });
  }, caps);
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { folders: [{ id: 'pairing-case', name: 'Fictional pairing case', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    chatThreads: [{ id: 'pairing-thread', title: 'Fictional pairing thread', messages: [], provider: 'anthropic', model: 'claude-sonnet-4-6',
      folderId: 'pairing-case', mode: 'act', tags: [], createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false, llmAnthropicApiKey: 'synthetic-not-a-key' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat', selectedFolderId: 'pairing-case' }));
    sessionStorage.setItem('tc-chat-thread', 'pairing-thread');
  });
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible({ timeout: 15_000 });
  return page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
}
const stubRequests = (page: Page) => page.evaluate(() => (window as unknown as { tcStubRequests: string[] }).tcStubRequests);

test('store 1.1.1, which has no app pairing, gets no chat request', async ({ page, baseURL }) => {
  const input = await openChatWithBridge(page, baseURL, STORE_1_1_1_CAPS);
  await expect(page.getByText(chat.input.extensionRequiredTitle, { exact: true })).toBeVisible();
  await expect(input).toBeDisabled();
  expect(await stubRequests(page)).toEqual([]);
});

test('a paired 1.1.4 bridge gets the chat request', async ({ page, baseURL }) => {
  const input = await openChatWithBridge(page, baseURL, CAPS_1_1_4);
  await expect(page.getByText(chat.input.extensionRequiredTitle, { exact: true })).toHaveCount(0);
  await input.fill('Summarise the case');
  await input.press('Enter');
  await expect.poll(() => stubRequests(page)).toEqual(['TC_LLM_REQUEST']);
});
