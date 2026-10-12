// Local, synthetic Chromium lab measurements. No production site, profiles,
// credentials or provider calls; not a field Core Web Vitals assessment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({ options: {
  dir: { type: 'string', default: 'dist' }, out: { type: 'string' },
  samples: { type: 'string', default: '3' },
  notes: { type: 'string', default: '0' },
} });
const samples = Number(values.samples);
const notes = Number(values.notes);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 10, 'samples must be 1–10');
assert(Number.isInteger(notes) && notes >= 0 && notes <= 2_000, 'notes must be 0–2000 synthetic records');
assert(values.out, '--out is required; keep lab evidence outside published artifacts');
const root = await realpath(resolve(values.dir));
const hostedIndexSHA256 = createHash('sha256').update(await readFile(resolve(root, 'index.html'))).digest('hex');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const bodies = new Map();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://fixture.invalid').pathname);
    const file = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (!bodies.has(file)) bodies.set(file, gzipSync(await readFile(file)));
    const bytes = bodies.get(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Encoding': 'gzip', 'Content-Length': bytes.length,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=3600, immutable' : 'no-cache' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const results = [];
try {
  browser = await chromium.launch();
  for (const profile of ['desktop', 'mobile']) {
    for (let sample = 1; sample <= samples; sample++) {
      const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US',
        viewport: profile === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        // Unlike request interception, CDP URL blocking preserves HTTP caching.
        // First-match allow only this task's loopback origin, then deny all HTTP(S).
        await cdp.send('Network.setBlockedURLs', { urlPatterns: [
          { urlPattern: origin + '/*', block: false },
          { urlPattern: 'http://*:*/*', block: true },
          { urlPattern: 'https://*:*/*', block: true },
        ] });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile === 'mobile' ? 4 : 1 });
        await cdp.send('Network.emulateNetworkConditions', { offline: false,
          latency: profile === 'mobile' ? 150 : 0,
          downloadThroughput: profile === 'mobile' ? 200_000 : -1,
          uploadThroughput: profile === 'mobile' ? 93_750 : -1 });
        await page.addInitScript(() => {
          localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
          const metrics = { lcp: 0, cls: 0, longTasks: [] };
          window.__startupMetrics = metrics;
          for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
            new PerformanceObserver(list => {
              for (const entry of list.getEntries()) {
                if (type === 'largest-contentful-paint') metrics.lcp = entry.startTime;
                if (type === 'layout-shift' && !entry.hadRecentInput) metrics.cls += entry.value;
                if (type === 'longtask') metrics.longTasks.push(entry.duration);
              }
            }).observe({ type, buffered: true });
          }
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const external = [];
        page.on('request', request => {
          if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url());
        });
        if (notes) {
          await page.goto(origin, { waitUntil: 'load', timeout: 90_000 });
          await page.locator(profile === 'mobile' ? '[aria-label="Switch to Analyst Mode"]' : '[data-tour="header"]').first().waitFor({ timeout: 90_000 });
          await page.evaluate(amount => new Promise((accept, reject) => {
            const request = indexedDB.open('ThreatCaddyDB');
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected initialized fixture database')); };
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction('notes', 'readwrite');
              transaction.onabort = () => { database.close(); reject(transaction.error); };
              transaction.oncomplete = () => { database.close(); accept(); };
              for (let index = 0; index < amount; index++) transaction.objectStore('notes').put({
                id: 'synthetic-lab-note-' + index, title: 'Fictional observation ' + index,
                content: 'Synthetic local-only lab record. '.repeat(30), tags: [],
                pinned: false, archived: false, trashed: false, createdAt: 1_780_000_000_000, updatedAt: 1_780_000_000_000,
              });
            };
          }), notes);
          // This Chromium instance belongs solely to the lab; never clear the
          // user's profile. Retain only synthetic DB rows, not warm HTTP assets.
          await cdp.send('Network.clearBrowserCache');
        }
        for (const cache of ['cold', 'warm']) {
          await page.goto(origin, { waitUntil: 'load', timeout: 90_000 });
          await page.locator(profile === 'mobile' ? '[aria-label="Switch to Analyst Mode"]' : '[data-tour="header"]').first().waitFor({ timeout: 90_000 });
          const ready = await page.evaluate(() => performance.now());
          await page.waitForTimeout(1_000);
          const measurement = await page.evaluate(() => {
            const navigation = performance.getEntriesByType('navigation')[0];
            const resources = performance.getEntriesByType('resource').map(entry => ({
              path: new URL(entry.name).pathname, kind: entry.initiatorType, start: entry.startTime,
              duration: entry.duration, transferred: entry.transferSize, encoded: entry.encodedBodySize,
              decoded: entry.decodedBodySize,
            }));
            return { ...window.__startupMetrics, dcl: navigation.domContentLoadedEventEnd,
              fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, resources };
          });
          assert.deepEqual(errors, [], 'startup page errors');
          assert.deepEqual(external, [], 'unexpected external requests (blocked)');
          const result = { profile, sample, cache, ready, ...measurement,
            transferred: measurement.resources.reduce((sum, row) => sum + row.transferred, 0),
            blockingTime: measurement.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0) };
          results.push(result);
          console.log(JSON.stringify({ profile, sample, cache, ready: Math.round(ready), lcp: measurement.lcp,
            cls: measurement.cls, transferred: result.transferred, blockingTime: result.blockingTime }));
        }
      } finally { await context.close(); }
    }
  }
  await writeFile(resolve(values.out), JSON.stringify({ browser: browser.version(), samples, notes, hostedIndexSHA256,
    method: 'Synthetic workspace, gzip loopback origin, service workers blocked to isolate foreground startup; cold then HTTP-cache-warm. Optional seeded notes are preserved while HTTP cache is cleared before cold visits. Ready measures the visible UI shell, not every deferred query/view. Transfer totals cover subresources, excluding navigation HTML. LCP can precede shell readiness on populated views. Mobile: 4x CPU, 150ms latency, 1.6Mbps down. Lab only; no field INP claim.', results }, null, 2) + '\n');
} finally {
  await browser?.close();
  const closed = new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  server.closeAllConnections();
  await closed;
}
