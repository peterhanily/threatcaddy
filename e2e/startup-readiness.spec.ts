import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { goToApp } from './fixtures';

test.use({ serviceWorkers: 'block' });

// WebKit reports an intercepted request that a reload cancels as a page error.
// Many specs seed data and reload right after goToApp, so it must not return
// while the always-mounted chat view is still fetching its lazy locale.
test('goToApp returns only after the lazy chat locale request has finished', async ({ page }) => {
  let requested!: () => void;
  const chatRequested = new Promise<void>(resolve => { requested = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const finished: string[] = [];
  page.on('requestfinished', request => {
    if (new URL(request.url()).pathname === '/locales/en/chat.json') finished.push(request.url());
  });
  await page.route('**/locales/en/chat.json', async route => {
    requested();
    await held;
    await route.continue();
  });

  const ready = goToApp(page);
  await chatRequested;
  // The page has loaded and shows its header while the chat locale is pending.
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  expect(await page.evaluate(() => document.readyState)).toBe('complete');
  // The main view's fallback is the readiness signal goToApp waits on.
  await expect(page.getByText('Loading…', { exact: true })).toBeVisible();
  // Showing that goToApp has not returned needs a window; a header-only
  // helper returns within milliseconds of the header appearing.
  const outcome = await Promise.race([ready.then(() => 'returned'), page.waitForTimeout(1_000).then(() => 'pending')]);
  expect(outcome).toBe('pending');

  release();
  await ready;
  expect(finished).toHaveLength(1);
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
});

// The fallback is translated, so a check for the English text alone returns early in other languages.
test('goToApp also waits for the main view in the analyst\'s language', async ({ page }) => {
  const loading = (JSON.parse(readFileSync(new URL('../public/locales/de/common.json', import.meta.url), 'utf8')) as Record<string, string>).loadingView;
  await page.addInitScript(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'de', tiAutoExtractEnabled: false }));
  });
  let requested!: () => void;
  const chatRequested = new Promise<void>(resolve => { requested = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/locales/de/chat.json', async route => {
    requested();
    await held;
    await route.continue();
  });

  const ready = goToApp(page);
  await chatRequested;
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByText(loading, { exact: true })).toBeVisible();
  const outcome = await Promise.race([ready.then(() => 'returned'), page.waitForTimeout(1_000).then(() => 'pending')]);
  expect(outcome).toBe('pending');

  release();
  await ready;
  await expect(page.getByText(loading, { exact: true })).toHaveCount(0);
});
