import { test, expect } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// SITE-1 / ARTIFACTS-2: the download is also served on the app's own origin.
// There it must not start: it would open the hosted app's storage under the
// standalone policy. SITE-6: nor may a copy run inside another page's frame.

test('served from a web origin, the copy starts no app, touches no storage and links to the hosted app', async ({ browser }) => {
  const bytes = await readFile('dist/threatcaddy-standalone.html');
  const context = await browser.newContext({ offline: false, serviceWorkers: 'block' });
  const unexpected: string[] = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://threatcaddy.example/threatcaddy-standalone.html') return route.fulfill({ body: bytes, contentType: 'text/html' });
    if (url === 'https://threatcaddy.example/') return route.fulfill({ body: '<!doctype html><title>Fictional hosted app</title><p>Fictional hosted app</p>', contentType: 'text/html' });
    unexpected.push(url);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__storageCalls', { value: calls });
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      const original = Storage.prototype[name] as (...args: unknown[]) => unknown;
      Object.defineProperty(Storage.prototype, name, { configurable: true, value(this: Storage, ...args: unknown[]) { calls.push(name); return original.apply(this, args); } });
    }
    for (const name of ['open', 'deleteDatabase', 'databases'] as const) {
      const original = IDBFactory.prototype[name] as (...args: unknown[]) => unknown;
      Object.defineProperty(IDBFactory.prototype, name, { configurable: true, value(this: IDBFactory, ...args: unknown[]) { calls.push(`indexedDB.${name}`); return original.apply(this, args); } });
    }
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://threatcaddy.example/threatcaddy-standalone.html#share=fictional');
  const open = page.getByRole('link', { name: 'Open ThreatCaddy', exact: true });
  await expect(open).toBeVisible();
  await expect(page.getByText('This offline copy of ThreatCaddy runs only when you open the file saved on your computer.', { exact: true })).toBeVisible();
  await expect(open).toHaveAttribute('href', 'https://threatcaddy.example/');
  await expect(page.locator('[data-tour="header"]')).toHaveCount(0);
  await expect(page.locator('#root')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __storageCalls: string[] }).__storageCalls)).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  await open.click();
  await expect(page).toHaveURL('https://threatcaddy.example/');
  await context.close();
});

test('a copy opened inside another page\'s frame does not start', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'threatcaddy-framed-'));
  try {
    await copyFile('dist/threatcaddy-standalone.html', join(directory, 'ThreatCaddy.html'));
    await writeFile(join(directory, 'framing.html'), '<!doctype html><title>Fictional framing page</title><iframe src="ThreatCaddy.html" style="width:900px;height:600px"></iframe>');
    await page.goto(pathToFileURL(join(directory, 'framing.html')).href);
    const frame = page.frameLocator('iframe');
    const open = frame.getByRole('link', { name: 'Open ThreatCaddy', exact: true });
    await expect(open).toBeVisible();
    await expect(frame.getByText('For your safety, ThreatCaddy does not run inside another website.', { exact: true })).toBeVisible();
    await expect(open).toHaveAttribute('target', '_top');
    await expect(open).toHaveAttribute('href', pathToFileURL(join(directory, 'ThreatCaddy.html')).href);
    await expect(frame.locator('[data-tour="header"]')).toHaveCount(0);
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true });
  }
});
