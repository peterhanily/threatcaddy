import { test, expect } from '@playwright/test';
import { dismissInitialOverlays, createQuickNote, navigateToView } from './fixtures';
import { startOfflineOrigin } from './offline-origin';

const OFFLINE_CAVEAT = "This is the browser's worker status, not a check of cached files or the latest version. Cached data can be cleared or evicted. This is not a backup. Team servers, AI and other external services need a connection.";

test('failed first installation reports unconfirmed offline availability without losing saved content', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const { url, stop, serviceWorkerRequestCount } = await startOfflineOrigin({ serviceWorkerResponse: 'unavailable' });
  try {
    await page.goto(url);
    await dismissInitialOverlays(page);
    const notice = page.getByTestId('offline-status');
    await expect(notice).toHaveAttribute('data-status', 'checking');
    await expect.poll(serviceWorkerRequestCount).toBeGreaterThan(0);
    await navigateToView(page, 'Notes');
    await createQuickNote(page);
    await page.getByPlaceholder('Note title...').fill('Saved before offline installation');
    await page.getByPlaceholder('Start writing in markdown...').fill('This fictional local note is not dependent on an installed PWA.');
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await expect(notice).toHaveAttribute('data-status', 'unavailable', { timeout: 20_000 });
    await expect(notice.getByRole('status')).toHaveText('Offline availability not confirmed');
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null)).toBeNull();
    await notice.locator('summary').click();
    await expect(notice.getByText(OFFLINE_CAVEAT, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('offline-installation-unconfirmed.png'), animations: 'disabled' });
    await page.reload();
    await expect(page.getByPlaceholder('Note title...')).toHaveValue('Saved before offline installation');
    await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue('This fictional local note is not dependent on an installed PWA.');
  } finally { await stop(); }
});

test('late real worker installation recovers the notice without reloading the app', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const { url, stop, releaseServiceWorker, serviceWorkerRequestCount } = await startOfflineOrigin({ serviceWorkerResponse: 'deferred' });
  try {
    // Worker registration can remain in flight independently of page load.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissInitialOverlays(page);
    const notice = page.getByTestId('offline-status');
    await expect(notice).toHaveAttribute('data-status', 'checking');
    await expect.poll(serviceWorkerRequestCount).toBeGreaterThan(0);
    await expect(notice).toHaveAttribute('data-status', 'unavailable', { timeout: 20_000 });
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    const documentStarted = await page.evaluate(() => performance.timeOrigin);
    releaseServiceWorker();
    await expect(notice).toHaveAttribute('data-status', 'installed', { timeout: 20_000 });
    await expect(notice.getByRole('status')).toHaveText('Offline support installed');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
    expect((await page.evaluate(() => caches.keys())).length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const analyst = page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true });
    await expect(analyst).toBeVisible();
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-status', 'installed');
    await notice.locator('summary').click();
    await expect(notice.getByText(OFFLINE_CAVEAT, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('offline-late-installation-mobile-exec.png'), animations: 'disabled' });
    await analyst.click();
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-status', 'installed');
    await page.screenshot({ path: testInfo.outputPath('offline-late-installation-mobile-analyst.png'), animations: 'disabled' });
  } finally { await stop(); }
});

test('installed PWA reloads and reopens saved content with its origin stopped', async ({ page, context }, testInfo) => {
  // Stop a test-owned origin: unlike emulation, this exercises real network
  // failure without Firefox/WebKit service-worker navigation interception.
  const { origin, url, stop } = await startOfflineOrigin();
  try {
    await page.goto(url);
    await dismissInitialOverlays(page);
    await navigateToView(page, 'Notes');
    await createQuickNote(page);
    await page.getByPlaceholder('Note title...').fill('Offline investigation note');
    await page.getByPlaceholder('Start writing in markdown...').fill('This saved finding remains available without a connection.');
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
    await page.waitForFunction('Boolean(navigator.serviceWorker.controller)');
    await expect(page.getByTestId('offline-status')).toHaveAttribute('data-status', 'installed');
    await stop();
    await expect(fetch(origin + '/api/offline-smoke')).rejects.toThrow();
    await page.reload();
    await expect(page.getByTestId('offline-status')).toHaveAttribute('data-status', 'installed');
    await expect(page.getByPlaceholder('Note title...')).toHaveValue('Offline investigation note');
    await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue('This saved finding remains available without a connection.');
    expect(await page.evaluate(async () => {
      try { await fetch('/api/offline-smoke'); return 'unexpected response'; }
      catch { return 'network unavailable'; }
    })).toBe('network unavailable');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(origin + '/offline-reopen');
    await expect(reopened.locator('[data-tour="header"]')).toBeVisible();
    const notice = reopened.getByTestId('offline-status');
    await expect(notice).toHaveAttribute('data-status', 'installed');
    await expect(notice.getByRole('status')).toHaveText('Offline support installed');
    await notice.locator('summary').click();
    await expect(notice.getByText(OFFLINE_CAVEAT, { exact: true })).toBeVisible();
    await navigateToView(reopened, 'Notes');
    await expect(reopened.getByRole('heading', { name: 'Offline investigation note', exact: true })).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath('offline-installed-origin-stopped.png'), animations: 'disabled' });
  } finally { await stop(); }
});
