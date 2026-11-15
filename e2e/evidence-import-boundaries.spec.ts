import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { readRows } from './client-lifecycle-fixtures';
import { evidenceDocx, importOrdinaryDocx, openEvidenceCase } from './evidence-import-fixtures';

test.use({ serviceWorkers: 'block' });
const diagnostics = new WeakMap<Page, { errors: string[]; console: string[]; failedRequests: string[]; external: string[] }>();
test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Evidence checks require an isolated preview origin');
  const origin = new URL(baseURL).origin;
  const data = { errors: [] as string[], console: [] as string[], failedRequests: [] as string[], external: [] as string[] };
  diagnostics.set(page, data);
  page.on('pageerror', error => data.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') data.console.push(message.text()); });
  page.on('requestfailed', request => data.failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.context().route(/^https?:/, route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    data.external.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false, tiAutoEnrichImportedIOCs: false }));
    localStorage.setItem('caddyai-onboarded', '1');
  });
  await goToApp(page);
  await openEvidenceCase(page);
});
test.afterEach(async ({ page }, info) => {
  const data = diagnostics.get(page);
  await info.attach('evidence-browser-diagnostics', { body: JSON.stringify(data), contentType: 'application/json' });
  expect(data?.errors).toEqual([]);
  expect(data?.external).toEqual([]);
});

test('real evidence workers persist ordinary DOCX and text with durable contents', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await importOrdinaryDocx(page);
  await page.locator('#main-content input[type="file"]').setInputFiles({ name: 'ordinary.txt', mimeType: 'text/plain', buffer: Buffer.from('Exact synthetic text café 中文.') });
  await expect.poll(async () => (await readRows(page, ['evidenceItems'])).evidenceItems.length).toBe(2);
  const rows = (await readRows(page, ['evidenceItems'])).evidenceItems;
  expect(rows.find(row => row.fileName === 'ordinary.txt')?.content).toEqual(expect.stringContaining('## Extracted Text\n\nExact synthetic text café 中文.'));
  expect(workers.some(url => url.includes('evidence-import.worker'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Evidence', exact: true })).toBeVisible();
  expect((await readRows(page, ['evidenceItems'])).evidenceItems).toEqual(rows);
  expect(diagnostics.get(page)?.console).toEqual([]);
  expect(diagnostics.get(page)?.failedRequests).toEqual([]);
});

test('compressed selected content beyond its bound rejects the whole batch and allows a later import', async ({ page }) => {
  await page.locator('#main-content input[type="file"]').setInputFiles([
    { name: 'valid-first.txt', mimeType: 'text/plain', buffer: Buffer.from('This must not persist when the next file is rejected.') },
    { name: 'bounded-attack.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: evidenceDocx('', true) },
  ]);
  await expect(page.getByText(/decoded part exceeds 8 MiB/)).toBeVisible();
  expect((await readRows(page, ['evidenceItems'])).evidenceItems).toEqual([]);
  await importOrdinaryDocx(page);
  expect(diagnostics.get(page)?.console).toHaveLength(1);
  expect(diagnostics.get(page)?.console[0]).toContain('Failed to import evidence:');
  expect(diagnostics.get(page)?.failedRequests).toEqual([]);
});

test('a pending real worker can be cancelled while controls remain responsive, without late records', async ({ page }) => {
  // Delay only delivery at the native Worker boundary. Cancelling a held network
  // route races the browser's own request cancellation; this gate instead keeps
  // the real worker alive and verifies that the app actually terminates it.
  await page.evaluate(() => {
    const state = { hold: true, pending: 0, terminated: 0 };
    (window as typeof window & { __evidenceGate: typeof state }).__evidenceGate = state;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      private readonly evidence: boolean;
      private waiting = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.evidence = String(url).includes('evidence-import.worker');
      }
      postMessage(message: unknown, transfer: Transferable[] = []) {
        if (this.evidence && state.hold) { this.waiting = true; state.pending++; return; }
        super.postMessage(message, transfer);
      }
      terminate() {
        if (this.evidence) { state.terminated++; if (this.waiting) state.pending--; }
        super.terminate();
      }
    };
  });
  await page.locator('#main-content input[type="file"]').setInputFiles({ name: 'cancelled.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: evidenceDocx() });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __evidenceGate: { pending: number } }).__evidenceGate.pending)).toBe(1);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => { let frames = 0; const tick = () => { if (++frames === 4) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __evidenceGate: { pending: number; terminated: number } }).__evidenceGate)).toMatchObject({ pending: 0, terminated: 1 });
  await page.evaluate(() => { (window as typeof window & { __evidenceGate: { hold: boolean } }).__evidenceGate.hold = false; });
  expect((await readRows(page, ['evidenceItems'])).evidenceItems).toEqual([]);
  await importOrdinaryDocx(page);
  expect((await readRows(page, ['evidenceItems'])).evidenceItems).toHaveLength(1);
  expect(diagnostics.get(page)?.console).toEqual([]);
});
