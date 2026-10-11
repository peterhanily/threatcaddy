import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { exerciseMermaidMath } from '../e2e/math-rendering-fixtures';

test('copied standalone HTML renders Mermaid math and exports without network or sibling assets', async ({ page }, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'threatcaddy-math-standalone-'));
  try {
    const path = join(directory, 'Math fixture.html');
    await copyFile(join(process.env.MATH_TEST_STANDALONE ?? 'dist-single', 'index.html'), path);
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path).href);
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await exerciseMermaidMath(page, info);
    const report = JSON.parse(await readFile('node_modules/.cache/threatcaddy/dependency-provenance-standalone.json', 'utf8')) as {
      packages: { name: string; version: string }[];
    };
    expect(report.packages.find(entry => entry.name === 'katex')?.version).toBe('0.18.2');
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); await rm(directory, { recursive: true, force: true }); }
});
