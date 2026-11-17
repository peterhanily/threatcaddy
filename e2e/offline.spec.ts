import { test, expect, type Page } from '@playwright/test';
import { dismissInitialOverlays, createQuickNote, navigateToView, waitForAppReady } from './fixtures';
import { startOfflineOrigin } from './offline-origin';

const INSTALLING_NOTICE = 'ThreatCaddy is still saving itself for offline use. Keep this tab open.';
const FAILED_NOTICE = "ThreatCaddy couldn't finish saving itself for offline use. It still works online and will try again next time you open it.";
const UNAVAILABLE_NOTICE = "This browser can't keep ThreatCaddy available offline. It still works online. To keep a copy of your investigations, save a backup from Settings → Data.";
const INSTALLED_SETTING = 'ThreatCaddy opens in this browser without an internet connection; team sync, AI and other online services still need one.';
const FAILED_SETTING = "The last attempt to save ThreatCaddy for offline use didn't finish. ThreatCaddy still works online and tries again next time you open it.";
const UNAVAILABLE_SETTING = "This browser can't keep ThreatCaddy available offline, but it still works online.";
const UNCONFIRMED_SETTING = "Offline use isn't confirmed in this browser yet. ThreatCaddy still works online and tries again next time you open it.";

/** The app shell stays silent unless the user must act; Settings > General always reports the status. */
async function offlineSetting(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  const row = page.getByTestId('offline-status');
  await expect(row.getByRole('heading', { name: 'Offline use', exact: true })).toBeVisible();
  return row;
}
const activeWorkerState = (page: Page) =>
  page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null);

test('failed first installation says it will try again, remembers dismissal and keeps saved content', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  // The worker really starts installing, then its download fails.
  const { url, stop, failPrecache, precacheRequestCount } = await startOfflineOrigin({ precacheResponse: 'deferred' });
  try {
    await page.goto(url);
    await dismissInitialOverlays(page);
    const notice = page.getByTestId('offline-notice');
    await expect.poll(precacheRequestCount).toBeGreaterThan(0);
    await navigateToView(page, 'Notes');
    await createQuickNote(page);
    await page.getByPlaceholder('Note title...').fill('Saved before offline installation');
    await page.getByPlaceholder('Start writing in markdown...').fill('This fictional local note is not dependent on an installed PWA.');
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await expect(notice).toHaveAttribute('data-status', 'installing', { timeout: 10_000 });
    failPrecache();
    // The keep-this-tab-open notice turns into the failure note at once instead of vanishing.
    // One failed download is not a browser limit: the note says the next open tries again.
    await expect(notice).toHaveAttribute('data-status', 'failed', { timeout: 5_000 });
    await expect(notice.getByRole('status')).toHaveText(FAILED_NOTICE);
    expect(await activeWorkerState(page)).toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    // The phone layout loads lazily; measure only once it has replaced the desktop one.
    await expect(page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true })).toBeVisible();
    await expect(notice.getByRole('status')).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1)).toBe(true);
    const dismiss = notice.getByRole('button', { name: 'Dismiss', exact: true });
    await expect(dismiss).toBeVisible();
    expect((await dismiss.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('offline-installation-failed-mobile.png'), animations: 'disabled' });
    await dismiss.click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('threatcaddy-offline-unavailable-dismissed'))).toBe('1');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await expect(page.getByPlaceholder('Note title...')).toHaveValue('Saved before offline installation');
    await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue('This fictional local note is not dependent on an installed PWA.');
    // The reopened page tries again and fails again: the dismissed note stays hidden; Settings still states it.
    await expect.poll(precacheRequestCount).toBe(2);
    const row = await offlineSetting(page);
    await expect(row).toHaveAttribute('data-status', 'installing', { timeout: 10_000 });
    failPrecache();
    await expect(row).toHaveAttribute('data-status', 'failed', { timeout: 5_000 });
    await expect(row.getByRole('status')).toHaveText(FAILED_SETTING);
    await expect(notice).toHaveCount(0);
  } finally { await stop(); }
});

test('browser without offline support says so and points to a backup instead of promising saved data', async ({ page }) => {
  // Like a browser or window that offers no offline support at all.
  await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, 'serviceWorker'); });
  const { url, stop, serviceWorkerRequestCount } = await startOfflineOrigin();
  try {
    await page.goto(url);
    // dismissInitialOverlays would click this note's Dismiss button, which is visible from the start here.
    await waitForAppReady(page);
    const notice = page.getByTestId('offline-notice');
    await expect(notice).toHaveAttribute('data-status', 'unavailable');
    await expect(notice.getByRole('status')).toHaveText(UNAVAILABLE_NOTICE);
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);
    const row = await offlineSetting(page);
    await expect(row).toHaveAttribute('data-status', 'unavailable');
    await expect(row.getByRole('status')).toHaveText(UNAVAILABLE_SETTING);
    expect(serviceWorkerRequestCount()).toBe(0);
  } finally { await stop(); }
});

test('unreachable offline download stays out of the way and Settings says it is not confirmed', async ({ page }) => {
  test.setTimeout(60_000);
  const { url, stop, serviceWorkerRequestCount } = await startOfflineOrigin({ serviceWorkerResponse: 'unavailable' });
  try {
    await page.goto(url);
    await dismissInitialOverlays(page);
    await expect.poll(serviceWorkerRequestCount).toBeGreaterThan(0);
    // A failed and a slow download look the same to the page; neither means this browser can't work offline.
    const row = await offlineSetting(page);
    await expect(row).toHaveAttribute('data-status', 'unconfirmed', { timeout: 20_000 });
    await expect(row.getByRole('status')).toHaveText(UNCONFIRMED_SETTING);
    await expect(page.getByTestId('offline-notice')).toHaveCount(0);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    expect(await activeWorkerState(page)).toBeNull();
  } finally { await stop(); }
});

test('slow first installation asks to keep the tab open, then disappears when installed', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const { url, stop, releasePrecache, precacheRequestCount } = await startOfflineOrigin({ precacheResponse: 'deferred' });
  try {
    await page.goto(url);
    await dismissInitialOverlays(page);
    await expect.poll(precacheRequestCount).toBeGreaterThan(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state)).toBe('installing');
    const notice = page.getByTestId('offline-notice');
    // Shown only after the short delay that keeps fast installs silent.
    await expect(notice).toHaveAttribute('data-status', 'installing', { timeout: 10_000 });
    await expect(notice).toHaveText(INSTALLING_NOTICE);
    await expect(notice.getByRole('button')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('offline-installation-running.png'), animations: 'disabled' });
    const row = await offlineSetting(page);
    await expect(row).toHaveAttribute('data-status', 'installing');
    releasePrecache();
    await expect(row).toHaveAttribute('data-status', 'installed', { timeout: 20_000 });
    await expect(row.getByRole('status')).toHaveText(INSTALLED_SETTING);
    expect(await activeWorkerState(page)).toBe('activated');
    await expect(notice).toHaveCount(0);
  } finally { await stop(); }
});

test('late real worker installation is confirmed without reloading the app', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const { url, stop, releaseServiceWorker, serviceWorkerRequestCount } = await startOfflineOrigin({ serviceWorkerResponse: 'deferred' });
  try {
    // Worker registration can remain in flight independently of page load.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissInitialOverlays(page);
    const notice = page.getByTestId('offline-notice');
    await expect.poll(serviceWorkerRequestCount).toBeGreaterThan(0);
    const row = await offlineSetting(page);
    // Still downloading after the observer stops waiting: not confirmed, and no "can't" note.
    await expect(row).toHaveAttribute('data-status', 'unconfirmed', { timeout: 20_000 });
    await expect(row.getByRole('status')).toHaveText(UNCONFIRMED_SETTING);
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    const documentStarted = await page.evaluate(() => performance.timeOrigin);
    releaseServiceWorker();
    await expect(row).toHaveAttribute('data-status', 'installed', { timeout: 20_000 });
    await expect(row.getByRole('status')).toHaveText(INSTALLED_SETTING);
    expect(await activeWorkerState(page)).toBe('activated');
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted);
    expect((await page.evaluate(() => caches.keys())).length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const analyst = page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true });
    await expect(analyst).toBeVisible();
    await expect(notice).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('offline-late-installation-mobile-exec.png'), animations: 'disabled' });
    await analyst.click();
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await expect(notice).toHaveCount(0);
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
    await expect.poll(() => activeWorkerState(page)).toBe('activated');
    await expect(page.getByTestId('offline-notice')).toHaveCount(0);
    await stop();
    await expect(fetch(origin + '/api/offline-smoke')).rejects.toThrow();
    await page.reload();
    await expect(page.getByPlaceholder('Note title...')).toHaveValue('Offline investigation note');
    await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue('This saved finding remains available without a connection.');
    expect(await activeWorkerState(page)).toBe('activated');
    expect(await page.evaluate(async () => {
      try { await fetch('/api/offline-smoke'); return 'unexpected response'; }
      catch { return 'network unavailable'; }
    })).toBe('network unavailable');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(origin + '/offline-reopen');
    await expect(reopened.locator('[data-tour="header"]')).toBeVisible();
    const row = await offlineSetting(reopened);
    await expect(row).toHaveAttribute('data-status', 'installed');
    await expect(row.getByRole('status')).toHaveText(INSTALLED_SETTING);
    await expect(reopened.getByTestId('offline-notice')).toHaveCount(0);
    await row.scrollIntoViewIfNeeded();
    await reopened.screenshot({ path: testInfo.outputPath('offline-installed-origin-stopped-settings.png'), animations: 'disabled' });
    await reopened.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(reopened.getByText(/^Offline use is not a backup\./)).toBeVisible();
    await navigateToView(reopened, 'Notes');
    await expect(reopened.getByRole('heading', { name: 'Offline investigation note', exact: true })).toBeVisible();
    await reopened.screenshot({ path: testInfo.outputPath('offline-installed-origin-stopped.png'), animations: 'disabled' });
  } finally { await stop(); }
});
