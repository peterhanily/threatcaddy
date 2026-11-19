import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQuickNote, navigateToView } from '../e2e/fixtures';
import { importOrdinaryDocx, openEvidenceCase } from '../e2e/evidence-import-fixtures';

let directory: string | undefined;
let fileURL: string;
let failures: string[] = [];
test.beforeEach(async ({ page }) => {
  directory = await mkdtemp(join(tmpdir(), 'threatcaddy-standalone-'));
  const path = join(directory, 'ThreatCaddy.html');
  await copyFile('dist/threatcaddy-standalone.html', path);
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
  expect(notices['react-leaflet.txt']).toContain('Hippocratic License Version Number: 2.1');
});
test.afterEach(async ({}, info) => {
  await info.attach('standalone-browser-errors', { body: JSON.stringify(failures), contentType: 'application/json' });
  if (info.status !== info.expectedStatus) console.log(JSON.stringify(failures));
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
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

test('a note cannot load remote images, audio or video in the copied file', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not apply a meta Content-Security-Policy to file:// pages.');
  const beacons = ['img', 'poster', 'audio', 'video', 'source'].map(path => `https://collector.example/${path}`);
  await navigateToView(page, 'Notes');
  await createQuickNote(page);
  await page.getByPlaceholder('Note title...').fill('Media sentinel');
  await page.getByPlaceholder('Start writing in markdown...').fill([
    `![x](${beacons[0]})`,
    `<video poster="${beacons[1]}" preload="auto"></video>`,
    `<audio src="${beacons[2]}" preload="auto"></audio>`,
    `<video src="${beacons[3]}" preload="auto"></video>`,
    `<video preload="auto"><source src="${beacons[4]}"></video>`,
  ].join('\n\n'));
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Preview mode', exact: true }).click();
  await expect(page.locator('.markdown-preview audio')).toHaveCount(1);
  // Chromium logs each load the policy refuses; a refused image also shows as a request that
  // failed with "csp". A load that reached the network fails with ERR_INTERNET_DISCONNECTED instead.
  const violation = (text: string, url: string) => text.includes(`'${url}'`) && text.includes('Content Security Policy');
  await expect.poll(() => beacons.filter(url => failures.some(text => violation(text, url)))).toEqual(beacons);
  const refused = (text: string) => beacons.some(url => violation(text, url) || text === `${url}: csp` || text === `Unexpected remote request: ${url}`);
  expect(failures.filter(text => !refused(text))).toEqual([]);
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

test('copied HTML shows none of the hosted offline notices, Settings row or backup note', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline use', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Export & Import', exact: true })).toBeVisible();
  await expect(page.getByText(/^Offline use is not a backup\./)).toHaveCount(0);
  await expect(page.getByTestId('offline-notice')).toHaveCount(0);
  await expect(page.getByTestId('offline-status')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('copied HTML imports DOCX through its embedded evidence worker without sibling assets or network', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await openEvidenceCase(page);
  await importOrdinaryDocx(page);
  expect(workers.some(url => url.startsWith('blob:') || url.startsWith('data:'))).toBe(true);
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
  // Hydration retains the selected editor; reload must not fall back to the list.
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

// ARTIFACTS-1: Excalidraw frames allowlisted embed links (YouTube, X, Reddit and
// others) with no click, and the X and Reddit widgets run with this file's origin.
test('a whiteboard holding web embeds makes no third-party request and keeps their links', async ({ page }) => {
  const element = { angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, locked: false, y: 0, width: 400, height: 300 };
  const embeds = [
    { id: 'fictional-video', link: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { id: 'fictional-post', link: 'https://x.com/fictional/status/1' },
    { id: 'fictional-thread', link: 'https://www.reddit.com/r/fictional/comments/abc123/fictional_thread/' },
  ].map((embed, index) => ({ ...element, ...embed, type: 'embeddable', x: index * 420 }));
  await page.evaluate(elements => new Promise<void>((resolve, reject) => {
    void indexedDB.databases().then(databases => {
      const name = databases.find(entry => entry.name?.startsWith('ThreatCaddy'))?.name;
      if (!name) return reject(new Error('No ThreatCaddy database'));
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('whiteboards', 'readwrite');
        transaction.objectStore('whiteboards').put({ id: 'fictional-embed-board', name: 'Embedded links board', elements: JSON.stringify(elements),
          tags: [], order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    }, reject);
  }), embeds);
  await page.reload();
  await navigateToView(page, 'Whiteboards');
  await page.getByText('Embedded links board', { exact: true }).click();
  await expect(page.getByPlaceholder('Whiteboard name')).toHaveValue('Embedded links board');
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
  // The editor saves each embed as an ordinary shape that keeps its link.
  await expect.poll(() => page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    void indexedDB.databases().then(databases => {
      const request = indexedDB.open(databases.find(entry => entry.name?.startsWith('ThreatCaddy'))?.name ?? 'ThreatCaddyDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('whiteboards').objectStore('whiteboards').get('fictional-embed-board');
        read.onsuccess = () => { db.close(); resolve((JSON.parse(read.result.elements) as Array<{ id: string; type: string; link: string }>).map(({ id, type, link }) => ({ id, type, link }))); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    }, reject);
  }))).toEqual(embeds.map(({ id, link }) => ({ id, type: 'rectangle', link })));
  await expect(page.locator('.excalidraw iframe')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('the copied file refuses frames, plugins and base URL changes', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit does not apply a meta Content-Security-Policy to file:// pages.');
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__violations', { value: seen });
    document.addEventListener('securitypolicyviolation', event => seen.push(event.effectiveDirective));
    const frame = document.createElement('iframe');
    frame.src = 'https://collector.example/frame';
    const object = document.createElement('object');
    object.data = 'https://collector.example/object';
    const base = document.createElement('base');
    base.href = 'https://collector.example/';
    document.body.append(frame, object);
    document.head.append(base);
  });
  await expect.poll(() => page.evaluate(() => [...new Set((window as unknown as { __violations: string[] }).__violations)].sort()))
    .toEqual(['base-uri', 'frame-src', 'object-src']);
  await page.evaluate(() => document.querySelectorAll('iframe, object, base').forEach(node => node.remove()));
});
