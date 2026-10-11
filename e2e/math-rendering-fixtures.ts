import { readFile } from 'node:fs/promises';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { readRows } from './client-lifecycle-fixtures';

/** Observe the real renderer's transient DOM before Excalidraw converts it to
 * canvas elements. No renderer/API replacement or synthetic success signal.
 * The upstream editable-flowchart converter retains raw TeX labels (also true
 * with the prior KaTeX version). PNG checks qualify that existing conversion
 * and export path; they do not claim support for typeset mathematical exports. */
export async function exerciseMermaidMath(page: Page, info: TestInfo) {
  await page.evaluate(() => {
    const samples: string[] = [];
    Object.assign(window, { mathRenderSamples: samples });
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        for (const math of [ ...(node.matches('math') ? [node] : []), ...node.querySelectorAll('math') ]) {
          if (math.textContent?.includes('z') && samples.length < 10) samples.push(math.outerHTML);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('[data-tour="header"]').getByRole('button', { name: /Create new/i }).click();
  await page.getByRole('menuitem', { name: /Whiteboard/i }).click();
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();
  await page.getByPlaceholder('Whiteboard name').fill('Fictional mathematical diagram');
  await page.getByTitle('More tools', { exact: true }).click();
  await page.getByText('Mermaid to Excalidraw', { exact: true }).click();
  await page.getByPlaceholder('Write Mermaid diagram defintion here...').fill('flowchart LR\n A["$$x^2 + y^2 = z^2$$"] --> B["Fictional result"]');
  await expect.poll(() => page.evaluate(() => (window as unknown as { mathRenderSamples: string[] }).mathRenderSamples.join(''))).toContain('<msup>');
  const preview = page.locator('.ttd-dialog-output-wrapper canvas');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.width > 20 && canvas.height > 20)).toBe(true);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByPlaceholder('Write Mermaid diagram defintion here...')).toHaveCount(0);
  await expect.poll(async () => {
    const row = (await readRows(page, ['whiteboards'])).whiteboards.find(row => row.name === 'Fictional mathematical diagram');
    if (typeof row?.elements !== 'string') return false;
    const elements = JSON.parse(row.elements) as { type: string; text?: string; width: number; height: number }[];
    return elements.length >= 5 && elements.some(element => element.text === 'Fictional result')
      && elements.every(element => Number.isFinite(element.width) && Number.isFinite(element.height));
  }).toBe(true);
  await page.reload();
  await expect(page.getByPlaceholder('Whiteboard name')).toHaveValue('Fictional mathematical diagram');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PNG', exact: true }).click();
  const download = await downloadPromise;
  const path = info.outputPath('ordinary-math-diagram.png');
  await download.saveAs(path);
  const png = await readFile(path);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.length).toBeGreaterThan(1_000);
  expect(png.readUInt32BE(16)).toBeGreaterThan(20);
  expect(png.readUInt32BE(20)).toBeGreaterThan(20);
}
