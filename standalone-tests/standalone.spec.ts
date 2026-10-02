import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQuickNote, navigateToView } from '../e2e/fixtures';

let directory: string;
let fileURL: string;
let failures: string[];
test.beforeEach(async ({ page }) => {
  directory = await mkdtemp(join(tmpdir(), 'threatcaddy-standalone-'));
  const path = join(directory, 'ThreatCaddy.html');
  await copyFile('dist-single/index.html', path);
  expect(await readdir(directory)).toEqual(['ThreatCaddy.html']);
  fileURL = pathToFileURL(path).href;
  failures = [];
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('error', event => console.error(`Standalone worker: ${event.message}`));
      }
    };
  });
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text().slice(0, 500)); });
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(`${request.url().slice(0, 150)}: ${request.failure()?.errorText}`));
  page.on('request', request => { if (/^https?:/.test(request.url())) failures.push(`Unexpected remote request: ${request.url()}`); });
  await page.goto(fileURL);
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  expect(await page.locator('script[src]').count()).toBe(0);
  expect(await page.locator('link[rel="stylesheet"][href]').count()).toBe(0);
  const notices = JSON.parse(await page.locator('#standalone-third-party-notices').textContent() || '{}');
  expect(notices['excalidraw-fonts.txt']).toContain('Xiaolai');
  expect(notices['oasis-stix-common-objects.txt']).toBeTruthy();
});
test.afterEach(async ({}, info) => {
  await info.attach('standalone-browser-errors', { body: JSON.stringify(failures), contentType: 'application/json' });
  if (info.status !== info.expectedStatus) console.log(JSON.stringify(failures));
  await rm(directory, { recursive: true, force: true });
});

async function createSavedNote(page: Page) {
  await navigateToView(page, 'Notes');
  await createQuickNote(page);
  await page.getByPlaceholder('Note title...').fill('Standalone sentinel');
  await page.getByPlaceholder('Start writing in markdown...').fill('An ordinary offline observation. 中文 日本語 한국어');
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

test('copied HTML saves and reopens a note, and searches through its embedded worker offline', async ({ page, context }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await createSavedNote(page);
  await page.reload();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Standalone sentinel');
  await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue('An ordinary offline observation. 中文 日本語 한국어');
  await page.locator('[data-tour="search"]').click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByRole('textbox').first().fill('sentinel');
  await expect(search.getByText('Standalone sentinel', { exact: true })).toBeVisible();
  await search.getByRole('button', { name: 'Regex', exact: true }).click();
  await search.getByRole('textbox').first().fill('Stand[a-z]+ sentinel');
  await expect(search.getByText('Standalone sentinel', { exact: true })).toBeVisible();
  expect(workers.some(url => url.startsWith('blob:') || url.startsWith('data:'))).toBe(true);
  expect(failures).toEqual([]);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(fileURL);
  await navigateToView(reopened, 'Notes');
  await expect(reopened.getByRole('heading', { name: 'Standalone sentinel', exact: true })).toBeVisible();
});

test('simple and advanced search remain available if the browser disables workers', async ({ page }) => {
  await createSavedNote(page);
  await page.evaluate(() => { window.Worker = class { constructor() { throw new Error('Workers unavailable in this ordinary fixture'); } } as unknown as typeof Worker; });
  await page.locator('[data-tour="search"]').click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByRole('textbox').first().fill('sentinel');
  await expect(search.getByText('Standalone sentinel', { exact: true })).toBeVisible();
  await search.getByRole('button', { name: 'Advanced', exact: true }).click();
  await search.getByRole('textbox').first().fill('title:sentinel');
  await expect(search.getByText('Standalone sentinel', { exact: true })).toBeVisible();
  await search.getByRole('button', { name: 'Regex', exact: true }).click();
  await expect(search.getByText(/Regex search requires a working search worker/)).toBeVisible();
  expect(failures).toEqual([]);
});

test('whiteboard raster bytes, CJK fonts and locale selection work without sibling files', async ({ page }) => {
  // Avoid the deliberate dark-canvas image filter when comparing fixture pixels.
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.locator('header[data-tour="header"]').getByRole('button', { name: /Create new/i }).click();
  await page.getByRole('menuitem', { name: /Whiteboard/i }).click();
  await expect(page.getByPlaceholder('Whiteboard name')).toBeVisible();
  await page.getByPlaceholder('Whiteboard name').fill('Offline raster board');
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
  // Obtain a normal raster fixture from the browser's own canvas encoder.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4455cc'; ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  // Drag/drop is the browser-native image path and does not rely on automating
  // an operating-system showOpenFilePicker dialog.
  const transfer = await page.evaluateHandle(encoded => {
    const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'ordinary-fixture.png', { type: 'image/png' }));
    return transfer;
  }, png);
  const canvas = page.locator('.excalidraw canvas').last();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas is not visible');
  await canvas.dispatchEvent('drop', { dataTransfer: transfer, clientX: bounds.x + 360, clientY: bounds.y + 200 });
  await transfer.dispose();
  await expect.poll(async () => page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const name = databases.find(entry => entry.name?.startsWith('ThreatCaddy'))?.name;
    if (!name) return 0;
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const rows = db.transaction('whiteboards').objectStore('whiteboards').getAll();
        rows.onsuccess = () => { db.close(); resolve(rows.result.filter(row => row.name === 'Offline raster board' && Object.keys(JSON.parse(row.files || '{}')).length > 0).length); };
        rows.onerror = () => { db.close(); reject(rows.error); };
      };
    });
  })).toBe(1);
  await page.reload();
  await page.getByRole('heading', { name: 'Offline raster board', exact: true }).click();
  await expect(page.getByPlaceholder('Whiteboard name')).toHaveValue('Offline raster board');
  // A retained file record alone is insufficient: require actual raster pixels
  // after reopening the whiteboard, not Excalidraw's missing-image placeholder.
  await expect.poll(() => page.locator('.excalidraw canvas').evaluateAll(canvases => canvases.some(canvas => {
    const image = (canvas as HTMLCanvasElement).getContext('2d')?.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    if (!image) return false;
    for (let i = 0; i < image.length; i += 4) if (image[i] === 68 && image[i + 1] === 85 && image[i + 2] === 204 && image[i + 3] === 255) return true;
    return false;
  }))).toBe(true);
  await page.locator('.excalidraw canvas').last().dblclick({ position: { x: 380, y: 330 } });
  await page.locator('.excalidraw textarea').fill('中文 日本語 한국어');
  await page.keyboard.press('Escape');
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('20px Xiaolai', '中文 日本語');
    return [...document.fonts].filter(font => font.family === 'Xiaolai' && font.status === 'loaded').length;
  });
  expect(fonts).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('select').filter({ has: page.locator('option[value="zh-CN"]') }).selectOption('zh-CN');
  await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(failures).toEqual([]);
});
