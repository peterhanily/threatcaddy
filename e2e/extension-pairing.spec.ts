import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

const catalog = (namespace: string) => JSON.parse(readFileSync(new URL(`../public/locales/en/${namespace}.json`, import.meta.url), 'utf8'));
const chat = catalog('chat');
const common = catalog('common');
const agent = catalog('agent');
const toast = catalog('toast');
const RELEASES = 'https://github.com/peterhanily/threatcaddy/releases/latest';
const STEPS = 'https://github.com/peterhanily/threatcaddy/blob/main/extension/README.md#install--chrome';

test.use({ serviceWorkers: 'block' });

// Store 1.1.1 (66ec58f4 bridge.js:6) and 1.1.4 (extension/src/bridge.js:6).
const STORE_1_1_1_CAPS = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];
const CAPS_1_1_4 = ['llm_streaming', 'fetch_url', 'fetch_url_public_v1', 'clip_import', 'clip_import_ack_v2', 'proxy_fetch', 'proxy_fetch_abort', 'notification_ack'];

/** One installed bridge, as bridge.js behaves: it publishes its capabilities, answers pings from its
 *  listener, and records every request the page gives it. */
async function openChatWithBridge(page: Page, baseURL: string | undefined, caps: string[], onboarded = true, withThread = true) {
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
  if (onboarded) await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { folders: [{ id: 'pairing-case', name: 'Fictional pairing case', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    chatThreads: withThread ? [{ id: 'pairing-thread', title: 'Fictional pairing thread', messages: [], provider: 'anthropic', model: 'claude-sonnet-4-6',
      folderId: 'pairing-case', mode: 'act', tags: [], createdAt: now, updatedAt: now }] : [] });
  await page.evaluate(withThread => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false, llmAnthropicApiKey: 'synthetic-not-a-key' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat', selectedFolderId: 'pairing-case' }));
    if (withThread) sessionStorage.setItem('tc-chat-thread', 'pairing-thread');
  }, withThread);
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible({ timeout: 15_000 });
  return page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
}
const stubRequests = (page: Page) => page.evaluate(() => (window as unknown as { tcStubRequests: string[] }).tcStubRequests);

/** The release link and its install steps, with the note that the store version is older. */
async function expectInstallLinks(place: Locator, releaseName: string) {
  await expect(place.getByRole('link', { name: releaseName, exact: true })).toHaveAttribute('href', RELEASES);
  await expect(place.getByRole('link', { name: common['extension.installSteps'], exact: true })).toHaveAttribute('href', STEPS);
  await expect(place.getByText(common['extension.storeOlder'])).toBeVisible();
  await expect(place.locator('a[href*="chromewebstore"]')).toHaveCount(0);
}

test('store 1.1.1, which has no app pairing, gets no chat request, and chat names the version and where to get it', async ({ page, baseURL }) => {
  const input = await openChatWithBridge(page, baseURL, STORE_1_1_1_CAPS);
  const banner = page.getByText(chat.input.extensionRequiredTitle, { exact: true }).locator('..');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(chat.input.extensionRequiredVersion);
  await expectInstallLinks(banner, common['extension.githubRelease']);
  await expect(input).toBeDisabled();
  expect(await stubRequests(page)).toEqual([]);
});

test('the onboarding and the help menu link the GitHub release, not the store', async ({ page, baseURL }) => {
  await openChatWithBridge(page, baseURL, STORE_1_1_1_CAPS, false);
  const onboarding = page.getByText(chat.view.onboardingStep2Title, { exact: true }).locator('..');
  await expectInstallLinks(onboarding, common['extension.githubRelease']);
  await page.getByRole('button', { name: chat.view.onboardingDismiss, exact: true }).click();
  await page.getByRole('button', { name: common['header.helpMenu'], exact: true }).click();
  const menu = page.getByRole('link', { name: common['extension.menuLink'], exact: true }).locator('..');
  await expectInstallLinks(menu, common['extension.menuLink']);
});

test('a paired 1.1.4 bridge gets the chat request', async ({ page, baseURL }) => {
  const input = await openChatWithBridge(page, baseURL, CAPS_1_1_4);
  await expect(page.getByText(chat.input.extensionRequiredTitle, { exact: true })).toHaveCount(0);
  await input.fill('Summarise the case');
  await input.press('Enter');
  await expect.poll(() => stubRequests(page)).toEqual(['TC_LLM_REQUEST']);
});

// Store 1.1.1's users already have an extension installed and turned on: where chat or AgentCaddy cannot run,
// the app says which version it needs and where to get it, not only that an extension is required.
test('with store 1.1.1, the chat start view and AgentCaddy name the version and link the release', async ({ page, baseURL }) => {
  await openChatWithBridge(page, baseURL, STORE_1_1_1_CAPS, true, false);
  const start = page.getByText(common['extension.updateRequired'], { exact: true }).locator('..');
  await expect(start).toBeVisible();
  await expect(page.getByText(chat.view.extensionRequired, { exact: true })).toHaveCount(0);
  await expect(start.getByRole('link', { name: common['extension.githubRelease'], exact: true })).toHaveAttribute('href', RELEASES);
  await expect(start.getByRole('link', { name: common['extension.installSteps'], exact: true })).toHaveAttribute('href', STEPS);
  await page.screenshot({ path: test.info().outputPath('chat-start-store-1.1.1.png') });

  await page.evaluate(() => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'agent', selectedFolderId: 'pairing-case' })));
  await page.reload();
  const banner = page.getByText(agent['panel.updateExtension'], { exact: true }).locator('..');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText(common['extension.updateRequired']);
  await expect(banner.getByRole('link', { name: common['extension.githubRelease'], exact: true })).toHaveAttribute('href', RELEASES);
  await expect(banner.getByRole('link', { name: common['extension.installSteps'], exact: true })).toHaveAttribute('href', STEPS);
  await expect(page.getByText(agent['panel.installExtension'], { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('agent-store-1.1.1.png') });
  expect(await stubRequests(page)).toEqual([]);
});

// Store 1.1.1 sends clips without a receipt and marks them sent. The app imports nothing from it and says where
// the clips stay.
test('clips from store 1.1.1 are not imported, and a toast says why and where they stay', async ({ page, baseURL }) => {
  await openChatWithBridge(page, baseURL, STORE_1_1_1_CAPS);
  await page.evaluate(() => window.postMessage({ type: 'THREATCADDY_IMPORT_CLIPS', clips: [{ id: 'legacy-fixture-clip', title: 'Fictional legacy clip',
    content: 'Fictional clip body', sourceUrl: 'https://example.com/fictional', sourceTitle: 'Fictional page', createdAt: 1 }] }, location.origin));
  const notice = page.getByText(toast.clip.outdatedExtensionRefused, { exact: true });
  await expect(notice).toBeVisible();
  // The import channel answers ready only when no delivery is in progress.
  const ready = await page.evaluate(() => new Promise<boolean>(resolve => {
    const requestId = 'fictional-probe';
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.type === 'TC_CLIP_IMPORT_READY' && event.data.requestId === requestId) resolve(event.data.ready);
    });
    window.postMessage({ type: 'TC_CLIP_IMPORT_PROBE', protocol: 2, requestId }, location.origin);
  }));
  expect(ready).toBe(true);
  const { notes } = await readRows(page, ['notes']);
  expect(JSON.stringify(notes)).not.toContain('Fictional clip body');
  await page.screenshot({ path: test.info().outputPath('clip-toast-store-1.1.1.png') });
  // It stays until dismissed: it is the only sign the clips were not imported.
  await page.waitForTimeout(4_500);
  await expect(notice).toBeVisible();
});
