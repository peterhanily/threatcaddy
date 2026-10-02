// Run after: npm --prefix extension run build. Synthetic localhost fixtures only.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(), 'threatcaddy-firefox-acceptance-'));
const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
console.log('Task-owned profile/artifacts:', root);
const servers = []; let browser, socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture() {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Synthetic extension acceptance</title><h1>Local fixture</h1><script>window.received=[];addEventListener("message",e=>{if(e.source===window)received.push(e.data)})</script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server); return `http://127.0.0.1:${server.address().port}`;
}
try {
  const origins = [await fixture(), await fixture()];
  await mkdir(`${root}/firefox-smoke`);
  await writeFile(`${root}/firefox-smoke/user.js`, "// Test-owned profile only: exercise permission API grants without native UI.\nuser_pref(\"extensions.webextOptionalPermissionPrompts\", false);\nuser_pref(\"extensions.webextensions.uuids\", \"{\\\"threatcaddy@threatcaddy.com\\\":\\\"f03dcd35-0081-47c4-bb91-fdf22192e617\\\"}\");\nuser_pref(\"browser.shell.checkDefaultBrowser\", false);\nuser_pref(\"browser.startup.homepage_override.mstone\", \"ignore\");\nuser_pref(\"datareporting.healthreport.uploadEnabled\", false);\nuser_pref(\"toolkit.telemetry.enabled\", false);\n");
  browser = spawn(process.env.FIREFOX_BIN || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : '/usr/bin/firefox'), ['--headless', '--no-remote', '--remote-allow-system-access', '--profile', `${root}/firefox-smoke`, '--remote-debugging-port', '0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firefox startup timeout')), 20000);
    browser.stderr.on('data', chunk => { const match = chunk.toString().match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    browser.on('error', error => { clearTimeout(timer); reject(error); });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Firefox exited ${code}`)); });
  });
  socket = new WebSocket(`${address}/session`); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const result = JSON.parse(event.data); if (pending.has(result.id)) { pending.get(result.id)(result); pending.delete(result.id); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const sequence = ++id; const timer = setTimeout(() => { pending.delete(sequence); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(sequence, message => { clearTimeout(timer); message.type === 'error' ? reject(new Error(JSON.stringify(message))) : resolve(message.result); });
    socket.send(JSON.stringify({ id: sequence, method, params }));
  });
  const evaluate = async (context, expression, userActivation = false) => {
    const result = await send('script.evaluate', { target: { context }, expression: `Promise.resolve(${expression}).then(value => JSON.stringify(value))`, awaitPromise: true, userActivation });
    if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.type === 'undefined' ? undefined : JSON.parse(result.result.value);
  };
  const until = async (context, expression) => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await evaluate(context, expression)) return; await pause(100); } throw new Error(`Condition timed out: ${expression}`); };
  const navigate = (context, url) => send('browsingContext.navigate', { context, url, wait: 'complete' });
  const click = async (context, selector) => {
    const rect = await evaluate(context, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:'center'}); const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) }; })()`);
    await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: rect.x, y: rect.y, duration: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
  };
  const fill = (context, selector, value) => evaluate(context, `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`);
  const session = await send('session.new', { capabilities: {} });
  console.log('Firefox version:', session.capabilities.browserVersion);
  await send('webExtension.install', { extensionData: { type: 'path', path: `${repo}/extension/dist/firefox` } });
  const first = (await send('browsingContext.create', { type: 'tab' })).context;
  const second = (await send('browsingContext.create', { type: 'tab' })).context;
  await navigate(first, origins[0]); await navigate(second, origins[1]);
  assert.equal(await evaluate(first, 'document.documentElement.dataset.tcBridgeCaps'), undefined);
  assert.equal(await evaluate(second, 'document.documentElement.dataset.tcBridgeCaps'), undefined);
  console.log('PASS Firefox: unpaired localhost pages have no readiness');
  const popup = (await send('browsingContext.create', { type: 'tab' })).context;
  await navigate(popup, 'moz-extension://f03dcd35-0081-47c4-bb91-fdf22192e617/popup.html');
  await click(popup, '#settings-btn'); await fill(popup, '#settings-target-url', origins[0]); await click(popup, '#settings-save-url');
  await until(popup, 'document.querySelector("#settings-approval-status").textContent.length > 0');
  const approval = await evaluate(popup, 'document.querySelector("#settings-approval-status").textContent'); console.log('FIREFOX APPROVAL', approval); assert.match(approval, /App approved/);
  await navigate(first, origins[0]); await navigate(second, origins[1]);
  await until(first, 'document.documentElement.dataset.tcBridgeCaps?.includes("notification_ack")');
  assert.equal(await evaluate(second, 'document.documentElement.dataset.tcBridgeCaps'), undefined);
  console.log('PASS Firefox: exact paired origin ready; other port unpaired');
  await evaluate(first, 'window.postMessage({ type: "TC_SET_PROXY_DOMAINS", domains: ["first.example.test"] }, location.origin)');
  await fill(popup, '#settings-target-url', origins[1]); await click(popup, '#settings-save-url');
  await until(popup, `chrome.storage.local.get("approvedAppsV1").then(data => !!data.approvedAppsV1?.[${JSON.stringify(origins[1])}])`);
  await navigate(second, origins[1]); await until(second, '!!document.documentElement.dataset.tcBridgeCaps');
  await evaluate(second, 'window.postMessage({ type: "TC_SET_PROXY_DOMAINS", domains: ["second.example.test"] }, location.origin)');
  await until(popup, `chrome.storage.local.get(null).then(data => data[${JSON.stringify('proxyPolicyV1:' + origins[0])}]?.domains[0] === "first.example.test" && data[${JSON.stringify('proxyPolicyV1:' + origins[1])}]?.domains[0] === "second.example.test")`);
  console.log('PASS Firefox: two paired app policies isolated');
  await evaluate(first, 'window.postMessage({ type: "TC_SEND_NOTIFICATION", requestId: "denied", payload: { title: "Synthetic acceptance", message: "Permission absent" } }, location.origin)');
  await until(first, 'received.some(item => item.type === "TC_NOTIFICATION_RESULT" && item.requestId === "denied")');
  const denied = await evaluate(first, 'received.find(item => item.type === "TC_NOTIFICATION_RESULT" && item.requestId === "denied")'); assert.equal(denied.accepted, false);
  console.log('PASS Firefox: notification without optional permission returns failure');
  await click(popup, '#settings-notifications'); await until(popup, 'document.querySelector("#settings-approval-status").textContent.includes("Desktop notifications enabled")');
  await evaluate(first, 'window.postMessage({ type: "TC_SEND_NOTIFICATION", requestId: "granted", payload: { title: "Synthetic local acceptance", message: "Browser API acknowledgement only" } }, location.origin)');
  await until(first, 'received.some(item => item.type === "TC_NOTIFICATION_RESULT" && item.requestId === "granted")');
  const granted = await evaluate(first, 'received.find(item => item.type === "TC_NOTIFICATION_RESULT" && item.requestId === "granted")'); console.log('FIREFOX NOTIFICATION API', granted); assert.equal(granted.accepted, true);
  await click(popup, '#settings-revoke-apps'); await until(first, '!document.documentElement.dataset.tcBridgeCaps'); await until(second, '!document.documentElement.dataset.tcBridgeCaps');
  console.log('PASS Firefox: revocation removes readiness in both existing tabs');
  await send('browser.close');
} finally {
  socket?.close(); if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
}
