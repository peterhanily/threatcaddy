// Real installed-browser adapters for synthetic, loopback-only clip acceptance.
// These never use a user's profile or request notification permission.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
export const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}; last result ${JSON.stringify(last)}`);
}

async function listen(server) {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  const closed = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  server.closeAllConnections();
  await closed;
}

/** This proxy never forwards anything. Browser background traffic cannot reach
 * external services, even outside page-level interception (e.g. an MV3 worker). */
async function deniedEgress() {
  const denied = [];
  const server = createServer((request, response) => {
    let target = request.url;
    try { const url = new URL(target); target = url.origin + url.pathname; } catch { /* CONNECT authority or malformed request. */ }
    denied.push({ method: request.method, target });
    response.writeHead(502).end('External network disabled in clip acceptance');
  });
  server.on('connect', (request, socket) => {
    // Browsers commonly reset rejected CONNECT tunnels during startup; this
    // expected denied-egress outcome must not crash the acceptance runner.
    socket.on('error', () => socket.destroy());
    denied.push({ method: 'CONNECT', target: request.url });
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
  const origin = await listen(server);
  return { origin, denied, close: () => closeServer(server) };
}

async function appOrigin(noReceiver = false) {
  const root = resolve(repo, 'dist');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid');
      // A deliberate non-app target tests missing readiness, never forged success.
      if (noReceiver) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><title>Fictional page without import receiver</title><h1>No app receiver</h1>');
        return;
      }
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  const origin = await listen(server);
  return { origin, close: () => closeServer(server) };
}

const seedPageSettings = () => {
  if (!/^https?:$/.test(location.protocol) || location.hostname !== '127.0.0.1') return;
  if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({
    tiAutoExtractEnabled: false, tiAutoEnrichImportedIOCs: false, editorMode: 'edit',
  }));
};

function chromePage(page) {
  return {
    id: page,
    goto: url => page.goto(url),
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    click: selector => page.locator(selector).click(),
    fill: (selector, value) => page.locator(selector).fill(value),
    clickText: (name, role = 'button') => page.getByRole(role, { name, exact: true }).click(),
    screenshot: path => page.screenshot({ path, fullPage: true }),
    url: () => page.url(),
    close: () => page.close(),
  };
}

async function chromeRuntime(root, proxy) {
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    executablePath: process.env.CHROME_BIN || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'),
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--lang=en-US',
      `--proxy-server=${proxy.origin}`, '--proxy-bypass-list=127.0.0.1;localhost;[::1]'],
  });
  try {
    await context.addInitScript(seedPageSettings);
    const cdp = await context.browser().newBrowserCDPSession();
    const extension = await cdp.send('Extensions.loadUnpacked', { path: join(repo, 'extension/dist/chrome') });
    const manager = await context.newPage();
    await manager.goto(`chrome://extensions/?id=${extension.id}`);
    // Only this disposable profile gets a loopback host grant. Native prompt UI
    // is intentionally out of scope; real extension permission checks still run.
    await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extension.id);
    await manager.close();
    return {
      version: context.browser().version(), extensionOrigin: `chrome-extension://${extension.id}`,
      newPage: async () => chromePage(await context.newPage()),
      pages: async () => context.pages().map(chromePage),
      close: () => context.close(),
    };
  } catch (error) { await context.close(); throw error; }
}

async function firefoxRuntime(root, proxy) {
  const profile = join(root, 'profile');
  await mkdir(profile);
  const uuid = 'f03dcd35-0081-47c4-bb91-fdf22192e617';
  const proxyPort = Number(new URL(proxy.origin).port);
  const preferences = {
    'extensions.webextOptionalPermissionPrompts': false,
    'extensions.webextensions.uuids': JSON.stringify({ 'threatcaddy@threatcaddy.com': uuid }),
    'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore',
    'intl.locale.requested': 'en-US', 'intl.accept_languages': 'en-US,en',
    'datareporting.healthreport.uploadEnabled': false, 'toolkit.telemetry.enabled': false,
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': proxyPort,
    'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': proxyPort,
    'network.proxy.no_proxies_on': '127.0.0.1,localhost,::1', 'network.dns.disablePrefetch': true,
    'network.prefetch-next': false, 'network.http.speculative-parallel-limit': 0,
  };
  await writeFile(join(profile, 'user.js'), '// Disposable clip-test profile only. No native permission UI assertion.\n'
    + Object.entries(preferences).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  const browser = spawn(process.env.FIREFOX_BIN || (process.platform === 'darwin'
    ? '/Applications/Firefox.app/Contents/MacOS/firefox' : '/usr/bin/firefox'),
  ['--headless', '--no-remote', '--remote-allow-system-access', '--profile', profile,
    '--remote-debugging-port', '0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let socket;
  try {
    const address = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Firefox startup timed out')), 20000);
      browser.stderr.on('data', chunk => {
        const match = chunk.toString().match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); done(match[1]); }
      });
      browser.on('error', error => { clearTimeout(timer); fail(error); });
      browser.on('exit', code => { clearTimeout(timer); fail(new Error(`Firefox exited ${code}`)); });
    });
    socket = new WebSocket(`${address}/session`);
    await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    };
    const send = (method, params = {}) => new Promise((done, fail) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 60000);
      pending.set(id, message => {
        clearTimeout(timer);
        if (message.type === 'error') fail(new Error(JSON.stringify(message)));
        else done(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (context, fn, arg) => {
      const expression = `Promise.resolve((${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})).then(value => JSON.stringify(value))`;
      const result = await send('script.evaluate', { target: { context }, expression, awaitPromise: true });
      if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.type === 'undefined' ? undefined : JSON.parse(result.result.value);
    };
    const pointClick = async (context, point) => send('input.performActions', { context, actions: [{
      type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: point.x, y: point.y, duration: 0 },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ],
    }] });
    // Unlike Playwright locators, raw BiDi evaluate does not wait for lazy
    // React panels or actionability. Wait for the same visible, enabled target
    // before native input; never treat an absent/covered control as a success.
    const actionTarget = async (context, locator) => {
      await send('browsingContext.activate', { context });
      return until(() => evaluate(context, ({ selector, name, role, editable }) => {
        const candidates = [...document.querySelectorAll(selector || (role === 'button' ? 'button' : `[role="${role}"]`))];
        const matches = candidates.filter(element => {
          if (!selector && (element.getAttribute('aria-label') || element.textContent.trim()) !== name) return false;
          if (element.closest('[hidden], [inert], [aria-hidden="true"]') || element.matches(':disabled')
            || element.getAttribute('aria-disabled') === 'true' || (editable && element.readOnly)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0
            && rect.width > 0 && rect.height > 0;
        });
        if (matches.length !== 1) return false;
        const element = matches[0];
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        const hit = document.elementFromPoint(point.x, point.y);
        return hit && (hit === element || element.contains(hit)) ? point : false;
      }, locator), `actionable ${locator.selector || `${locator.role}: ${locator.name}`}`);
    };
    const page = context => ({
      id: context,
      goto: url => send('browsingContext.navigate', { context, url, wait: 'complete' }),
      evaluate: (fn, arg) => evaluate(context, fn, arg),
      click: async selector => pointClick(context, await actionTarget(context, { selector })),
      clickText: async (name, role = 'button') => pointClick(context, await actionTarget(context, { name, role })),
      fill: async (selector, value) => {
        await pointClick(context, await actionTarget(context, { selector, editable: true }));
        return evaluate(context, ({ selector, value }) => {
          const element = document.activeElement;
          if (!element?.matches(selector)) throw new Error('Input did not receive focus: ' + selector);
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }, { selector, value });
      },
      screenshot: async path => {
        const result = await send('browsingContext.captureScreenshot', { context, origin: 'document' });
        await writeFile(path, Buffer.from(result.data, 'base64'));
      },
      url: () => evaluate(context, () => location.href),
      close: () => send('browsingContext.close', { context }),
    });
    const session = await send('session.new', { capabilities: {} });
    await send('script.addPreloadScript', { functionDeclaration: seedPageSettings.toString() });
    await send('webExtension.install', { extensionData: { type: 'path', path: join(repo, 'extension/dist/firefox') } });
    return {
      version: session.capabilities.browserVersion, extensionOrigin: `moz-extension://${uuid}`,
      newPage: async () => page((await send('browsingContext.create', { type: 'tab' })).context),
      pages: async () => (await send('browsingContext.getTree', {})).contexts.map(item => page(item.context)),
      close: async () => {
        try { await send('browser.close'); } finally {
          socket.close();
          if (browser.exitCode === null) browser.kill('SIGTERM');
        }
      },
    };
  } catch (error) {
    socket?.close();
    if (browser.exitCode === null) browser.kill('SIGTERM');
    throw error;
  }
}

export async function withClipRuntime(browserName, suite) {
  const root = await mkdtemp(join(tmpdir(), `threatcaddy-clip-${browserName}-`));
  const result = { browser: browserName, status: 'incomplete', checks: [], error: null };
  console.log('Task-owned profile and evidence:', root);
  const proxy = await deniedEgress();
  const app = await appOrigin();
  // A distinct origin cannot be replaced by the app PWA's navigation fallback.
  const unavailable = await appOrigin(true);
  let runtime;
  const check = label => { result.checks.push(label); console.log('PASS:', label); };
  try {
    runtime = browserName === 'chrome' ? await chromeRuntime(root, proxy) : await firefoxRuntime(root, proxy);
    result.version = runtime.version;
    result.origin = app.origin;
    await suite({ runtime, origin: app.origin, unavailableOrigin: unavailable.origin, root, check });
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error.stack ?? String(error);
    if (runtime) {
      const pages = await runtime.pages().catch(() => []);
      result.failurePages = [];
      for (const [index, page] of pages.entries()) {
        const url = await Promise.resolve().then(() => page.url()).catch(() => '');
        if (!url || url === 'about:blank') continue;
        const path = join(root, `failure-page-${index}.png`);
        await page.screenshot(path).catch(() => {});
        result.failurePages.push({ url, screenshot: path });
      }
    }
    throw error;
  } finally {
    await runtime?.close().catch(error => { result.cleanupError = String(error); });
    await app.close();
    await unavailable.close();
    await proxy.close();
    result.blockedExternalRequests = proxy.denied;
    await writeFile(join(root, 'results.json'), JSON.stringify(result, null, 2));
    console.log('Evidence:', join(root, 'results.json'));
  }
}
