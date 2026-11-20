import { test, expect, type Page } from '@playwright/test';
import { goToApp } from './fixtures';

const LINK = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';

function savedElements(page: Page) {
  return page.evaluate(() => new Promise<Array<{ type: string; width: number; height: number; link?: string | null }>>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('whiteboards').objectStore('whiteboards').getAll();
      read.onsuccess = () => {
        db.close();
        resolve((read.result as Array<{ elements: string }>).flatMap(board => JSON.parse(board.elements)));
      };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

// ARTIFACTS-1: the editor frames no web embed. Excalidraw still offers the Web
// Embed tool; what it draws becomes an ordinary shape of the drawn size that
// keeps the link, which the analyst can open deliberately.
test('the Web Embed tool saves a linked shape of the drawn size and frames nothing', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost/').origin;
  const remote: string[] = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) remote.push(request.url());
  });
  await goToApp(page);
  await page.locator('header[data-tour="header"]').getByRole('button', { name: /Create new/i }).click();
  await page.getByRole('menuitem', { name: /Whiteboard/i }).click();
  const canvas = page.locator('.excalidraw canvas').last();
  await expect(canvas).toBeVisible();
  await page.locator('.App-toolbar__extra-tools-trigger').click();
  // Excalidraw also gives its Mermaid item this test id.
  await page.locator('.App-toolbar__extra-tools-dropdown').getByRole('button', { name: 'Web Embed', exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The whiteboard canvas has no box');
  // Right of centre, clear of the shape properties panel.
  const [x, y] = [box.x + box.width / 2 - 60, box.y + box.height / 2 - 120];
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Excalidraw handles one pointer move per animation frame; WebKit otherwise
  // drops the last moves of a quick drag.
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(x + (220 * step) / 8, y + (170 * step) / 8);
    await frame();
  }
  // Hold the end point for a few frames: on a loaded CI runner WebKit can
  // still drop the last moves (seen once as 220 x 137 on 19 November 2026).
  for (let settle = 0; settle < 3; settle++) {
    await page.mouse.move(x + 220, y + 170);
    await frame();
  }
  await page.mouse.up();
  const input = page.locator('.excalidraw-hyperlinkContainer-input');
  await input.fill(LINK);
  await input.press('Enter');
  // The guarded regression is a 0 x 0 shape; require a shape of about the
  // drawn size without depending on the exact last pointer event.
  await expect.poll(async () => (await savedElements(page)).filter(element => element.link === LINK)
    .map(({ type, width, height }) => ({ type, wide: width >= 180 && width <= 221, tall: height >= 120 && height <= 171 })))
    .toEqual([{ type: 'rectangle', wide: true, tall: true }]);
  expect((await savedElements(page)).filter(element => element.type !== 'rectangle')).toEqual([]);
  await expect(page.locator('.excalidraw iframe')).toHaveCount(0);
  expect(remote).toEqual([]);
});
