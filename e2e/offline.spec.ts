import { test, expect } from '@playwright/test';
import { dismissInitialOverlays, createQuickNote, navigateToView } from './fixtures';
import { startOfflineOrigin } from './offline-origin';

test('installed PWA reloads and reopens saved content with its origin stopped', async ({ page, context }) => {
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
    await stop();
    await expect(fetch(origin + '/api/offline-smoke')).rejects.toThrow();
    await page.reload();
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
    await navigateToView(reopened, 'Notes');
    await expect(reopened.getByRole('heading', { name: 'Offline investigation note', exact: true })).toBeVisible();
  } finally { await stop(); }
});
