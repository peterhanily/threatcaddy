// Run after: npm --prefix extension run build. Synthetic localhost fixtures only.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const root = await mkdtemp(join(tmpdir(), 'threatcaddy-chrome-acceptance-'));
const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
console.log('Task-owned profile/artifacts:', root);
const servers = [];
async function fixture() {
  const server = createServer((_req, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Synthetic extension acceptance</title><h1>Local fixture</h1><script>window.received=[];addEventListener("message",e=>{if(e.source===window)received.push(e.data)})</script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
let context;
try {
  const origins = [await fixture(), await fixture()];
  context = await chromium.launchPersistentContext(`${root}/chrome-smoke`, { executablePath: process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'), headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--disable-background-networking'] });
  console.log('Chrome version:', context.browser().version());
  const cdp = await context.browser().newBrowserCDPSession();
  const extension = await cdp.send('Extensions.loadUnpacked', { path: `${repo}/extension/dist/chrome` });
  const first = await context.newPage(); const second = await context.newPage();
  await first.goto(origins[0]); await second.goto(origins[1]);
  for (const page of [first, second]) assert.equal(await page.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  console.log('PASS Chrome: unpaired localhost pages have no bridge readiness');
  // Grant only the synthetic localhost host through the browser's own extension
  // settings API. Headless Chrome cannot interact with the native permission
  // prompt; this is explicitly not a test of that native prompt UI.
  const manager = await context.newPage(); await manager.goto(`chrome://extensions/?id=${extension.id}`);
  await manager.evaluate(async id => { await chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'); }, extension.id);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extension.id}/popup.html`); await popup.locator('#settings-btn').click();
  await popup.locator('#settings-target-url').fill(origins[0]); await popup.locator('#settings-save-url').click();
  await popup.waitForFunction(() => document.querySelector('#settings-approval-status').textContent.length > 0, undefined, { timeout: 10000 });
  console.log('CHROME APPROVAL', await popup.locator('#settings-approval-status').innerText());
  assert.match(await popup.locator('#settings-approval-status').innerText(), /App approved/);
  await first.reload(); await second.reload(); await first.waitForFunction(() => document.documentElement.dataset.tcBridgeCaps?.includes('notification_ack'));
  assert.equal(await second.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  console.log('PASS Chrome: first exact origin paired, other port remains unpaired');
  await first.evaluate(() => window.postMessage({ type: 'TC_SET_PROXY_DOMAINS', domains: ['first.example.test'] }, location.origin));
  await popup.locator('#settings-target-url').fill(origins[1]); await popup.locator('#settings-save-url').click();
  await expect.poll(() => popup.evaluate(origin => chrome.storage.local.get('approvedAppsV1').then(data => !!data.approvedAppsV1?.[origin]), origins[1]), { timeout: 10000 }).toBe(true);
  await second.reload(); await second.waitForFunction(() => !!document.documentElement.dataset.tcBridgeCaps);
  await second.evaluate(() => window.postMessage({ type: 'TC_SET_PROXY_DOMAINS', domains: ['second.example.test'] }, location.origin));
  await expect.poll(() => popup.evaluate(origins => chrome.storage.local.get(null).then(data => data['proxyPolicyV1:' + origins[0]]?.domains?.[0] === 'first.example.test' && data['proxyPolicyV1:' + origins[1]]?.domains?.[0] === 'second.example.test'), origins), { timeout: 10000 }).toBe(true);
  console.log('PASS Chrome: two paired app policies remain separate');
  await first.evaluate(() => window.postMessage({ type: 'TC_SEND_NOTIFICATION', requestId: 'denied', payload: { title: 'Synthetic local acceptance', message: 'Permission absent' } }, location.origin));
  await first.waitForFunction(() => received.some(item => item.type === 'TC_NOTIFICATION_RESULT' && item.requestId === 'denied'));
  assert.equal(await first.evaluate(() => received.find(item => item.requestId === 'denied' && item.type === 'TC_NOTIFICATION_RESULT').accepted), false);
  console.log('PASS Chrome: denied notification returns explicit failure');
  console.log('NOT RUN Chrome: positive notification permission grant requires native prompt interaction; covered separately in Firefox API test.');
  await popup.locator('#settings-revoke-apps').click();
  await first.waitForFunction(() => !document.documentElement.dataset.tcBridgeCaps); await second.waitForFunction(() => !document.documentElement.dataset.tcBridgeCaps);
  console.log('PASS Chrome: revocation removes both apps readiness');
} finally { await context?.close().catch(() => {}); await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
