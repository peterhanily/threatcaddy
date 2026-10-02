import { test, expect } from '@playwright/test';
import { startOfflineOrigin } from './offline-origin';

test('packaged CJK fonts are base-aware and available on first canvas use offline', async ({ page, baseURL }) => {
  const offline = await startOfflineOrigin({ outputDir: process.env.TC_FONT_TEST_OUTPUT_DIR,
    basePath: new URL(baseURL ?? 'http://localhost/').pathname });
  try {
    const unexpected: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = request.url();
      if (/^https?:/.test(url) && !url.startsWith(offline.url)) unexpected.push(url);
    });
    await page.goto(offline.url);
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
    await page.waitForFunction('Boolean(navigator.serviceWorker.controller)');
    expect(await page.evaluate(async () => {
      const names = await caches.keys();
      const keys = await Promise.all(names.map(async name => (await caches.open(name)).keys()));
      return keys.flat().some(request => {
        const path = new URL(request.url).pathname;
        return path.includes('/fonts/Xiaolai/') && path.endsWith('.woff2');
      });
    })).toBe(true);
    // Stop before opening the canvas: no lazy chunk or font is warmed manually.
    // Intercepting routes/offline state can block SW cache hits in some engines.
    await offline.stop();
    await expect(fetch(offline.url + 'api/offline-font-smoke')).rejects.toThrow();
    await page.locator('header[data-tour="header"]').getByRole('button', { name: /Create new/i }).click();
    await page.getByRole('menuitem', { name: /Whiteboard/i }).click();
    await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
    await page.locator('.excalidraw canvas').last().dblclick({ position: { x: 350, y: 260 } });
    await page.locator('.excalidraw textarea').fill('中文 日本語');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(async () => {
      await document.fonts.load('20px Xiaolai', '中文 日本語');
      return [...document.fonts].filter(font => font.family === 'Xiaolai' && font.status === 'loaded').length;
    })).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH)).toBe(offline.url);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await offline.stop(); }
});
