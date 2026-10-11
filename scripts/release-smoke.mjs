// Post-publication verification only. Never builds, publishes, logs in, or writes
// to a server. All application changes are synthetic browser-local notes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, lstat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';
import {
  CRITICAL_FILES, OFFLINE_PROBE_PATH, expectedOfflineFailure, loadVerifiedArtifact,
  requestPolicy, sha256, validateSiteURL, validateSourceSHA, waitForRelease,
} from './release-contract.mjs';

const usage = 'node scripts/release-smoke.mjs --url https://your-owned-site.example/ --source-sha <40hex> --artifact-dir <verified-client> [--output-dir test-results/release-smoke] [--propagation-timeout-ms 180000]';
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (key === '--help') { console.log(usage); process.exit(0); }
  if (!['--url', '--source-sha', '--artifact-dir', '--output-dir', '--propagation-timeout-ms'].includes(key)
      || options[key] !== undefined || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(usage);
  options[key] = process.argv[i + 1];
}
if (!options['--url'] || !options['--source-sha'] || !options['--artifact-dir']) throw new Error(usage);
const site = validateSiteURL(options['--url']);
const sourceSHA = validateSourceSHA(options['--source-sha']);
const propagationTimeout = Number(options['--propagation-timeout-ms'] ?? 180_000);
if (!Number.isInteger(propagationTimeout) || propagationTimeout < 1 || propagationTimeout > 600_000) throw new Error('Propagation timeout must be 1..600000ms');

// Evidence must stay in the ignored repository test-results tree. A unique run
// directory prevents accidentally overwriting previous evidence or user files.
const outputBase = resolve(options['--output-dir'] ?? 'test-results/release-smoke');
const outputRelative = relative(resolve('test-results'), outputBase);
if (outputRelative.startsWith('..') || isAbsolute(outputRelative)) throw new Error('output-dir must be inside test-results');
for (let current = outputBase; current !== dirname(current); current = dirname(current)) {
  try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Output path cannot traverse a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(outputBase, { recursive: true });
const output = await mkdtemp(join(outputBase, 'run-'));
const result = { status: 'running', sourceSHA, site: site.href, startedAt: new Date().toISOString(), propagation: [], stages: [] };
let browser;

async function notes(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('notes', 'readonly');
      const read = transaction.objectStore('notes').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function createNote(page, stage) {
  await expect(page.locator('header[data-tour="header"]')).toBeVisible();
  const previous = await page.evaluate(() => JSON.parse(sessionStorage.getItem('threatcaddy-nav-state') ?? '{}').selectedNoteId);
  await page.locator('header[data-tour="header"]').getByRole('button', { name: 'Create new...', exact: true }).click();
  await page.getByRole('menuitem', { name: /Quick Note/ }).click();
  await page.waitForFunction(previousId => {
    const navigation = JSON.parse(sessionStorage.getItem('threatcaddy-nav-state') ?? '{}');
    return navigation.view === 'notes' && typeof navigation.selectedNoteId === 'string' && navigation.selectedNoteId !== previousId;
  }, previous);
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Untitled Note');
  const title = `Synthetic ${stage} release check`;
  const content = 'Disposable browser-local observation. Saved text remains identical after reload. 中文 日本語 한국어';
  await page.getByPlaceholder('Note title...').fill(title);
  await page.getByPlaceholder('Start writing in markdown...').fill(content);
  await expect.poll(async () => (await notes(page)).find(note => note.title === title)?.content).toBe(content);
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  return (await notes(page)).find(note => note.title === title);
}

async function assertSaved(page, saved) {
  await expect(page.getByPlaceholder('Note title...')).toHaveValue(saved.title);
  await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue(saved.content);
  assert.deepEqual((await notes(page)).find(note => note.id === saved.id), saved);
}

async function reopenNote(context, url, saved) {
  const page = await context.newPage();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('nav[aria-label="Views"]').getByRole('button', { name: /^Notes(?: \d+)?$/ }).click();
  await page.getByRole('heading', { name: saved.title, exact: true }).click();
  await assertSaved(page, saved);
  return { page, response };
}

async function runStage(name, artifact, operation, { standalone = false, serviceWorkers = 'block' } = {}) {
  const stage = { name, status: 'running', errors: [], expectedOfflineFailures: [], verifiedRequests: 0, workerDiagnostics: [] };
  result.stages.push(stage);
  let context;
  let tracingStarted = false;
  let operationFailure;
  const cleanupErrors = [];
  const state = { offline: standalone, closing: false };
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers, offline: standalone });
    context.setDefaultTimeout(20_000);
    const pending = new Set();
    const monitor = promise => {
      pending.add(promise);
      promise.catch(error => stage.errors.push({ kind: 'monitor', message: error.message })).finally(() => pending.delete(promise));
    };
    const recordFailure = (kind, url, message) => {
      if (state.closing) return;
      const event = { kind, url, message };
      if (expectedOfflineFailure(url, message, { offline: state.offline && !standalone, site })) stage.expectedOfflineFailures.push(event);
      else stage.errors.push(event);
    };
    // Context listeners include newly opened tabs; service-worker requests are
    // audited too. PWA requests served internally by the worker bypass routing,
    // so their response identity is independently checked below.
    context.on('weberror', event => recordFailure('exception', event.page()?.url() ?? '', event.error().message));
    context.on('console', message => {
      if (message.type() === 'error') recordFailure('console', message.location().url, message.text());
    });
    context.on('requestfailed', request => recordFailure('request', request.url(), request.failure()?.errorText ?? 'unknown failure'));
    context.on('request', request => {
      if (!/^https?:/.test(request.url())) return;
      const policy = requestPolicy(request.url(), request.method(), site, artifact.files, { offline: state.offline, standalone });
      if (!policy.allowed) recordFailure('unexpected-request', request.url(), policy.reason);
    });
    context.on('response', response => monitor((async () => {
      if (!/^https?:/.test(response.url()) || state.closing) return;
      const request = response.request();
      const policy = requestPolicy(response.url(), request.method(), site, artifact.files, { offline: state.offline, standalone });
      if (policy.probe) throw new Error('The disconnected NetworkOnly probe unexpectedly returned a response');
      if (!policy.allowed || response.status() !== 200) throw new Error(`Unexpected response: ${response.status()} ${response.url()}`);
      if (request.method() === 'GET') assert.equal(sha256(await response.body()), artifact.files.get(policy.path).hash, `Artifact response: ${policy.path}`);
      stage.verifiedRequests++;
    })()));
    await context.routeWebSocket(/.*/, socket => {
      recordFailure('websocket', socket.url(), 'WebSocket network access is forbidden');
      socket.close(); // Never connectToServer().
    });
    await context.route(/^https?:\/\//, async route => {
      const request = route.request();
      const policy = requestPolicy(request.url(), request.method(), site, artifact.files, { offline: state.offline, standalone });
      if (!policy.allowed) { await route.abort(); return; }
      // Offline behavior must use the real worker/cache and the browser's failed
      // network, not APIRequestContext (which is independent of setOffline).
      if (state.offline) { await route.continue(); return; }
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
        assert.equal(response.status(), 200, `Static response: ${request.url()}`);
        if (request.method() === 'GET') assert.equal(sha256(await response.body()), artifact.files.get(policy.path).hash, `Static artifact: ${policy.path}`);
        await route.fulfill({ response });
        await response.dispose();
      } catch (error) {
        recordFailure('route', request.url(), error.message);
        await route.abort().catch(() => {});
      }
    });
    await context.addInitScript(({ origin, standalone }) => {
      if ((standalone && location.protocol === 'file:') || (!standalone && location.origin === origin)) {
        if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({ editorMode: 'edit', tiAutoExtractEnabled: false }));
      }
    }, { origin: site.origin, standalone });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    tracingStarted = true;
    const page = await context.newPage();
    await operation({ context, page, state, stage });
    while (pending.size) await Promise.allSettled([...pending]);
    assert.deepEqual(stage.errors, [], `${name}: unexpected browser/network errors`);
    stage.status = 'passed';
  } catch (error) {
    stage.status = 'failed';
    stage.failure = error.message;
    const page = context?.pages().at(-1);
    if (page) await page.screenshot({ path: join(output, `${name}-failure.png`) }).catch(() => {});
    operationFailure = { error };
  } finally {
    state.closing = true;
    const cleanupFailures = [];
    const recordCleanupFailure = (kind, error) => { cleanupErrors.push(error); cleanupFailures.push({ kind, message: error.message }); };
    if (tracingStarted) await context.tracing.stop({ path: join(output, `${name}-trace.zip`) }).catch(error => recordCleanupFailure('trace', error));
    if (context) await context.close().catch(error => recordCleanupFailure('context-close', error));
    if (cleanupFailures.length) {
      stage.errors.push(...cleanupFailures);
      stage.status = 'failed';
      stage.failure ??= 'Browser cleanup or evidence capture failed';
    }
  }
  throwIfFailed(operationFailure, cleanupErrors, `${name}: verification and cleanup failed`);
  console.log(`PASS ${name}`);
}

try {
  const artifact = await loadVerifiedArtifact(options['--artifact-dir'], sourceSHA);
  result.archiveHash = artifact.archiveHash;
  result.expectedHashes = Object.fromEntries(CRITICAL_FILES.map(path => [path, artifact.files.get(path).hash]));
  const published = await waitForRelease(site, artifact.files, {
    timeoutMs: propagationTimeout,
    onAttempt: observation => {
      result.propagation.push(observation);
      console.log(`Propagation attempt ${observation.attempt}: ${observation.files.filter(file => file.matches).length}/${CRITICAL_FILES.length} exact files`);
    },
  });
  result.publication = 'verified';
  browser = await chromium.launch({ headless: true });
  await runStage('hosted', artifact, async ({ page }) => {
    const response = await page.goto(site.href, { waitUntil: 'domcontentloaded' });
    assert.equal(sha256(await response.body()), artifact.files.get('index.html').hash);
    const saved = await createNote(page, 'hosted');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertSaved(page, saved);
  });

  await runStage('pwa', artifact, async ({ context, page, state, stage }) => {
    await page.goto(site.href, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 180_000;
    while (true) {
      const diagnostic = await page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations[0];
        const cachesPresent = await caches.keys();
        const precache = cachesPresent.find(name => name.includes('precache'));
        const cache = precache ? await caches.open(precache) : null;
        const cachedIndex = cache ? await cache.match(new URL('index.html', location.href).href, { ignoreSearch: true }) : null;
        const cachedHash = cachedIndex ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await cachedIndex.arrayBuffer()))]
          .map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
        return { installing: registration?.installing?.state, waiting: registration?.waiting?.state, active: registration?.active?.state,
          script: registration?.active?.scriptURL, controller: navigator.serviceWorker.controller?.scriptURL,
          entries: cache ? (await cache.keys()).length : 0, cachedIndexHash: cachedHash };
      });
      stage.workerDiagnostics.push({ at: new Date().toISOString(), ...diagnostic });
      console.log(`PWA readiness: ${diagnostic.active ?? diagnostic.installing ?? 'unregistered'}, cached entries ${diagnostic.entries}`);
      if (diagnostic.active === 'activated' && diagnostic.controller && diagnostic.cachedIndexHash === artifact.files.get('index.html').hash) {
        assert.equal(diagnostic.script, new URL('sw.js', site).href);
        assert.equal(diagnostic.controller, diagnostic.script);
        break;
      }
      assert.ok(Date.now() < deadline, 'PWA activation/cache deadline exceeded');
      assert.deepEqual(stage.errors, [], 'Unexpected error during PWA installation');
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    const saved = await createNote(page, 'PWA');
    await context.setOffline(true);
    state.offline = true;
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.evaluate(async path => {
      try { await fetch(path, { cache: 'no-store', credentials: 'omit' }); return false; } catch { return true; }
    }, OFFLINE_PROBE_PATH), true, 'Uncached offline probe must fail');
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(response.fromServiceWorker(), true);
    assert.equal(sha256(await response.body()), artifact.files.get('index.html').hash);
    await assertSaved(page, saved);
    await page.close();
    const reopened = await reopenNote(context, site.href, saved);
    assert.equal(reopened.response.fromServiceWorker(), true);
    assert.equal(sha256(await reopened.response.body()), artifact.files.get('index.html').hash);
  }, { serviceWorkers: 'allow' });

  // Keep exactly one downloaded HTML file in this directory; no dist/ sibling
  // files can accidentally satisfy an external asset reference.
  const standaloneDirectory = await mkdtemp(join(output, 'standalone-'));
  const standalonePath = join(standaloneDirectory, 'ThreatCaddy.html');
  await writeFile(standalonePath, published.get('threatcaddy-standalone.html').bytes, { flag: 'wx' });
  await runStage('standalone', artifact, async ({ context, page }) => {
    const url = pathToFileURL(standalonePath).href;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('script[src], link[rel="stylesheet"][href]').count(), 0);
    const saved = await createNote(page, 'standalone');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertSaved(page, saved);
    await page.close();
    await reopenNote(context, url, saved);
  }, { standalone: true });
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.failure = error.message;
  // This command never publishes. If verification fails after deployment, the
  // publication may still be live; do not label it unpublished or roll it back.
  console.error(`Post-publication verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(error => {
    result.status = 'failed'; result.cleanupFailure = error.message; process.exitCode = 1;
  });
  result.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Release smoke ${result.status}; evidence: ${relative(process.cwd(), output).split(sep).join('/')}`);
}
