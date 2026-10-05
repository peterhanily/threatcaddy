// Human-assisted native permission/OS display acceptance; synthetic loopback data only.
// Run after npm --prefix extension run build. Never opens an existing user profile.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const root = await mkdtemp(join(tmpdir(), 'threatcaddy-chrome-manual-'));
const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const timeout = 10 * 60 * 1000;
const servers = [];
let context;
const results = { status: 'incomplete', stage: 'startup', error: null, checks: [], acknowledgements: [], popupEvents: [], human: null, profileRemoved: false };
const check = label => { results.checks.push(label); console.log(`PASS: ${label}`); };

async function fixture(label) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ThreatCaddy manual check ${label}</title>
    <style>body{font:18px system-ui;max-width:760px;margin:48px auto;padding:24px}label{display:block;margin:24px 0}button{font:inherit;padding:12px;margin:8px}pre{white-space:pre-wrap}small{display:block}</style>
    <h1>ThreatCaddy manual check ${label}</h1>
    <p>This disposable page contains no investigation data. Follow the instructions in the assistant conversation.</p>
    <p id="status">Waiting for app approval in the extension Settings tab.</p>
    <label><input type="checkbox" id="host-prompt"> I saw and allowed Chrome's local-site access prompt.</label>
    <label><input type="checkbox" id="notification-prompt"> I saw and allowed Chrome's notification-permission prompt.</label>
    <p>After the synthetic notification is sent, confirm its actual operating-system display below. Do not count the message on this page as a desktop notification.</p>
    <button id="visible" disabled>I saw the desktop notification</button>
    <button id="not-visible" disabled>No desktop notification appeared</button>
    <small>Tick a prompt checkbox only if you actually saw that Chrome prompt.</small>
    <pre id="response"></pre>
    <script>
    window.received=[];window.manualResult=null;
    addEventListener('message',event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.type!=='TC_NOTIFICATION_RESULT')return;
      received.push(event.data);document.getElementById('response').textContent=JSON.stringify(event.data,null,2);
      if(event.data.requestId==='manual-positive'&&event.data.accepted){
        document.getElementById('status').textContent='Browser accepted the synthetic notification. Check the desktop/notification center, then report below.';
        document.getElementById('visible').disabled=false;document.getElementById('not-visible').disabled=false;
      }
    });
    for(const id of ['visible','not-visible'])document.getElementById(id).addEventListener('click',()=>{
      window.manualResult={hostPromptObserved:document.getElementById('host-prompt').checked,notificationPromptObserved:document.getElementById('notification-prompt').checked,osNotificationObserved:id==='visible'};
      document.getElementById('status').textContent='Observation recorded. Return to extension Settings and click Revoke all approved apps.';
    });
    </script></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function notify(page, requestId, message) {
  await page.evaluate(({ requestId, message }) => window.postMessage({
    type: 'TC_SEND_NOTIFICATION', requestId,
    payload: { title: 'ThreatCaddy local acceptance', message },
  }, location.origin), { requestId, message });
  await page.waitForFunction(id => window.received.some(item => item.requestId === id), requestId, { timeout: 10000 });
  const response = await page.evaluate(id => window.received.find(item => item.requestId === id), requestId);
  results.acknowledgements.push(response);
  return response;
}

try {
  const origins = [await fixture('A'), await fixture('B')];
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath: process.env.CHROME_BIN || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'),
    headless: false, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--disable-background-networking'],
  });
  process.once('SIGINT', () => { void context.close(); });
  const cdp = await context.browser().newBrowserCDPSession();
  // This loads the real unpacked extension only. No permission grant API,
  // native-prompt bypass flag, CDP permission override or OS setting is used.
  const extension = await cdp.send('Extensions.loadUnpacked', { path: `${repo}/extension/dist/chrome` });
  const first = await context.newPage();
  const other = await context.newPage();
  await first.goto(origins[0]);
  await other.goto(origins[1]);
  for (const page of [first, other]) assert.equal(await page.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  check('both unpaired origins start without bridge readiness');
  const popup = await context.newPage();
  // Observe this synthetic test UI only; do not intercept permission APIs or
  // manufacture user gestures. Native dialogs remain entirely human-operated.
  popup.on('pageerror', error => results.popupEvents.push({ type: 'pageerror', message: error.message }));
  await popup.exposeFunction('tcManualObserveClick', observation => {
    results.popupEvents.push(observation);
    console.log('Extension UI interaction:', JSON.stringify(observation));
  });
  await popup.goto(`chrome-extension://${extension.id}/popup.html`);
  await popup.evaluate(() => document.addEventListener('click', event => {
    const id = event.target.closest?.('button')?.id;
    if (['settings-save-url', 'settings-notifications', 'settings-revoke-apps'].includes(id)) {
      void window.tcManualObserveClick({ type: 'click', id, trusted: event.isTrusted });
    }
  }, { capture: true }));
  await popup.locator('#settings-btn').click();
  assert.equal(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] })), false);
  await popup.locator('#settings-target-url').fill(origins[0]);
  await popup.bringToFront();
  console.log(JSON.stringify({ profile: root, chrome: context.browser().version(), origins }));
  results.stage = 'app-approval';
  console.log('STEP 1: In the visible extension Settings tab, click Approve app and allow the localhost access prompt. Do not enable notifications yet.');
  await popup.waitForFunction(() => document.getElementById('settings-approval-status').textContent.startsWith('App approved.'), undefined, { timeout });
  await first.reload();
  await other.reload();
  await first.waitForFunction(() => document.documentElement.dataset.tcBridgeCaps?.includes('notification_ack'));
  assert.equal(await other.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  check('user-approved exact origin paired; other port remains unpaired');
  results.stage = 'notification-without-permission';
  const negative = await notify(first, 'manual-negative', 'Synthetic test with optional notification permission absent');
  assert.equal(negative.accepted, false);
  assert.match(negative.error, /Desktop notifications are disabled/);
  check('notification is explicitly rejected before optional permission');
  await popup.bringToFront();
  console.log('STEP 2: Click Enable desktop notifications and allow the Chrome prompt. Do not enable AI or URL-fetch permissions.');
  results.stage = 'notification-permission';
  // waitForFunction treats a Promise as truthy before its boolean resolves.
  // Poll from Node so each Chrome permission result is fully awaited.
  let previousStatus;
  await expect.poll(async () => {
    const state = await popup.evaluate(async () => ({
      granted: await chrome.permissions.contains({ permissions: ['notifications'] }),
      status: document.getElementById('settings-notification-status').textContent,
    }));
    results.notificationPermission = state.granted;
    results.notificationSettingsStatus = state.status;
    if (state.status !== previousStatus) {
      previousStatus = state.status;
      console.log('Extension Settings status:', state.status);
    }
    return state.granted;
  }, { timeout }).toBe(true);
  check('notification permission granted through user interaction in the real extension UI');
  results.stage = 'notification-api';
  const positive = await notify(first, 'manual-positive', 'Synthetic local test. No investigation data. Please confirm that you can see this desktop notification.');
  assert.equal(positive.accepted, true, `Notification rejected: ${positive.error || 'no error supplied'}`);
  check('browser notification API accepted the synthetic notification');
  await first.bringToFront();
  console.log('STEP 3: In manual check A, tick only the native prompts you actually saw, then click whether the desktop notification appeared.');
  results.stage = 'human-observation';
  await first.waitForFunction(() => window.manualResult !== null, undefined, { timeout });
  results.human = await first.evaluate(() => window.manualResult);
  console.log('Human observation:', JSON.stringify(results.human));
  await popup.bringToFront();
  console.log('STEP 4: Click Revoke all approved apps in extension Settings.');
  results.stage = 'revocation';
  await popup.waitForFunction(() => document.getElementById('settings-approval-status').textContent === 'All app connections revoked.', undefined, { timeout });
  await first.waitForFunction(() => !document.documentElement.dataset.tcBridgeCaps);
  assert.equal(await other.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  check('user revocation removes bridge readiness from the open app');
  if (!Object.values(results.human).every(Boolean)) {
    results.error = 'At least one native prompt or OS-display observation was not confirmed';
    console.log('INCOMPLETE: at least one native prompt or OS-display observation was not confirmed. API acceptance alone is not proof of desktop display.');
    process.exitCode = 2;
  } else {
    check('human confirmed both native permission prompts and actual OS notification display');
    results.status = 'passed';
  }
  results.stage = 'complete';
} catch (error) {
  results.status = 'failed';
  results.error = error.message;
  console.error('Manual acceptance incomplete:', error.message);
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
    // Only this run's mkdtemp-owned synthetic profile is removed; retain result.json.
    await rm(join(root, 'profile'), { recursive: true, force: true });
    results.profileRemoved = true;
  } catch (error) {
    results.status = 'failed';
    results.cleanupError = error.message;
    process.exitCode = 1;
  }
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await writeFile(join(root, 'result.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log('Local result:', join(root, 'result.json'));
}
