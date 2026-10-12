// Shared boundary assertions use the same denied-egress, disposable-profile
// runtime as clip acceptance. These pages contain no app or provider code.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { until } from './verify-clip-delivery-runtime.mjs';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';

async function openFixture(servers) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Synthetic extension boundary acceptance</title>'
      + '<h1>Local fixture</h1><script>window.boundaryMessages=[];addEventListener("message",event=>{'
      + 'if(event.source===window && event.origin===location.origin)boundaryMessages.push(event.data)})</script>');
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function closeFixture(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

const readiness = page => page.evaluate(() => document.documentElement.dataset.tcBridgeCaps);

async function notificationResult(page, requestId) {
  await page.evaluate(requestId => window.postMessage({ type: 'TC_SEND_NOTIFICATION', requestId,
    payload: { title: 'Synthetic local acceptance', message: 'Browser API acknowledgement only' },
  }, location.origin), requestId);
  return until(() => page.evaluate(requestId => window.boundaryMessages.find(message =>
    message.type === 'TC_NOTIFICATION_RESULT' && message.requestId === requestId), requestId),
  `notification acknowledgement ${requestId}`);
}

export async function verifyExtensionBoundaries({ runtime, check }, browserName) {
  assert.ok(['chrome', 'firefox'].includes(browserName));
  const servers = [];
  let operationFailure;
  const cleanupErrors = [];
  try {
    const origins = [await openFixture(servers), await openFixture(servers)];
    const first = await runtime.newPage();
    const second = await runtime.newPage();
    await first.goto(origins[0]);
    await second.goto(origins[1]);
    assert.equal(await readiness(first), undefined);
    assert.equal(await readiness(second), undefined);
    check('unpaired localhost pages have no bridge readiness');

    const popup = await runtime.newPage();
    const approve = async origin => {
      // A new popup document starts with fresh feedback, so a previous app's
      // identical success message cannot acknowledge this approval action.
      await popup.goto(runtime.extensionOrigin + '/popup.html');
      await popup.click('#settings-btn');
      await until(() => popup.evaluate(async () => {
        const { settings = {} } = await chrome.storage.local.get('settings');
        return document.querySelector('#settings-target-url').value === (settings.targetUrl || 'https://threatcaddy.com');
      }), 'initial target settings loaded');
      assert.equal(await popup.evaluate(() => document.querySelector('#settings-approval-status').textContent), '');
      await popup.fill('#settings-target-url', origin);
      await popup.click('#settings-save-url');
      // Storage is written before bridge registration finishes. The real UI
      // acknowledgement waits for the whole action before suggesting reload.
      await until(() => popup.evaluate(async origin => {
        const data = await chrome.storage.local.get('approvedAppsV1');
        return !!data.approvedAppsV1?.[origin]
          && document.querySelector('#settings-approval-status').textContent === chrome.i18n.getMessage('appApproved');
      }, origin), 'exact app approval persisted and acknowledged');
    };
    await approve(origins[0]);
    await first.goto(origins[0]);
    await second.goto(origins[1]);
    await until(async () => (await readiness(first))?.includes('notification_ack'), 'first exact origin ready');
    assert.equal(await readiness(second), undefined);
    check('first exact origin is paired while another loopback port remains unpaired');

    await first.evaluate(() => window.postMessage({ type: 'TC_SET_PROXY_DOMAINS', domains: ['first.example.test'] }, location.origin));
    await approve(origins[1]);
    await second.goto(origins[1]);
    await until(() => readiness(second), 'second exact origin ready');
    await second.evaluate(() => window.postMessage({ type: 'TC_SET_PROXY_DOMAINS', domains: ['second.example.test'] }, location.origin));
    await until(() => popup.evaluate(origins => chrome.storage.local.get(null).then(data =>
      data['proxyPolicyV1:' + origins[0]]?.domains?.[0] === 'first.example.test'
      && data['proxyPolicyV1:' + origins[1]]?.domains?.[0] === 'second.example.test'), origins),
    'independent proxy policies persisted');
    check('two paired app policies remain isolated');

    assert.equal(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] })), false);
    const denied = await notificationResult(first, 'boundary-denied');
    assert.equal(denied.accepted, false);
    check('notification without optional permission returns explicit failure');

    if (browserName === 'firefox') {
      // The disposable Firefox profile disables optional-permission prompts.
      // This verifies real permission/notification APIs, not OS delivery or UI.
      await popup.click('#settings-notifications');
      await until(() => popup.evaluate(async () =>
        await chrome.permissions.contains({ permissions: ['notifications'] })
        && document.querySelector('#settings-notification-status').textContent
          === chrome.i18n.getMessage('notificationEnabledDesc')), 'notification permission reflected in real UI');
      const granted = await notificationResult(first, 'boundary-granted');
      assert.equal(granted.accepted, true);
      check('Firefox granted notification API acknowledges acceptance; native prompt and OS delivery are not asserted');
    } else {
      console.log('NOT RUN Chrome: positive notification grant needs a human native prompt check.');
    }

    await popup.click('#settings-revoke-apps');
    await until(() => popup.evaluate(() => document.activeElement.id === 'modal-cancel'), 'revocation confirmation visible');
    await popup.click('#modal-cancel');
    await until(() => popup.evaluate(() => document.activeElement.id === 'settings-revoke-apps'
      && !document.getElementById('settings-page').inert), 'revocation cancellation closes the modal');
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get('approvedAppsV1')
      .then(data => Object.keys(data.approvedAppsV1 || {}).sort())), [...origins].sort());
    // Fresh documents must obtain readiness from the preserved approvals;
    // stale markers in the original tabs are not evidence of cancellation.
    await first.goto(origins[0]);
    await second.goto(origins[1]);
    await until(async () => (await readiness(first))?.includes('notification_ack')
      && (await readiness(second))?.includes('notification_ack'), 'cancelled revocation preserves approvals on fresh documents');
    await popup.click('#settings-revoke-apps');
    await popup.click('#modal-confirm');
    await until(async () => !(await readiness(first)) && !(await readiness(second)), 'confirmed revocation removes both readiness markers');
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get('approvedAppsV1')
      .then(data => Object.keys(data.approvedAppsV1 || {}))), []);
    check('revocation cancellation preserves both apps; explicit confirmation removes both app approvals and readiness');
  } catch (error) {
    operationFailure = { error };
  } finally {
    for (const server of servers) {
      try { await closeFixture(server); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  throwIfFailed(operationFailure, cleanupErrors, 'Extension boundary verification and fixture cleanup failed');
}
