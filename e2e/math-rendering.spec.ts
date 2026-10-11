import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startOfflineOrigin } from './offline-origin';
import { exerciseMermaidMath } from './math-rendering-fixtures';

test.use({ serviceWorkers: 'block' });

test('the emitted patched math module renders, converts and exports an ordinary whiteboard', async ({ page }, info) => {
  const server = await startOfflineOrigin({ outputDir: process.env.MATH_TEST_DIST });
  try {
    const requests = new Set<string>();
    const errors: string[] = [];
    await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort());
    page.on('request', request => requests.add(new URL(request.url()).pathname.slice(1)));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await exerciseMermaidMath(page, info);
    const report = JSON.parse(readFileSync('node_modules/.cache/threatcaddy/dependency-provenance-hosted.json', 'utf8')) as {
      packages: { name: string; version: string; chunks: string[] }[];
    };
    const katex = report.packages.find(entry => entry.name === 'katex');
    expect(katex?.version).toBe('0.18.2');
    expect(katex?.chunks.some(file => requests.has(file))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await server.stop(); }
});

for (const basePath of ['/', '/ordinary-subpath/']) {
  test(`real HTTP locale loading retains regional RTL selection at ${basePath}`, async ({ page }) => {
    const server = await startOfflineOrigin({ basePath, outputDir: process.env.MATH_TEST_DIST });
    try {
      const loaded: string[] = [];
      const failures: string[] = [];
      await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort());
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.includes('/locales/')) {
          if (response.status() === 200) loaded.push(url.pathname);
          else failures.push(url.pathname + ':' + response.status());
        }
      });
      await page.addInitScript(() => localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'ar-EG', tiAutoExtractEnabled: false })));
      await page.goto(server.url);
      await expect(page.locator('[data-tour="header"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const common = JSON.parse(readFileSync('public/locales/ar/common.json', 'utf8')) as Record<string, string>;
      await expect(page.getByRole('button', { name: common['sidebar.settings'], exact: true })).toBeVisible();
      expect(loaded).toContain(basePath + 'locales/ar/common.json');
      expect(loaded.every(path => path.startsWith(basePath + 'locales/'))).toBe(true);
      expect(failures).toEqual([]);
    } finally { await server.stop(); }
  });
}
