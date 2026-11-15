import { expect, test } from '@playwright/test';
import { seedRows } from './client-lifecycle-fixtures';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });

test('Executive Mode loads sharing only on request and generates a usable local share link', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Sharing checks require an isolated preview origin');
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  const errors: string[] = [];
  const sharingRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/assets\/ShareDialog-[^/]+\.js$/.test(request.url())) sharingRequests.push(request.url()); });
  await page.context().route(/^https?:/, route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
    localStorage.setItem('caddyai-onboarded', '1');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true })).toBeVisible();
  const now = Date.now();
  await seedRows(page, { notes: [{ id: 'synthetic-share-note', title: 'Synthetic share note', content: 'A local synthetic observation.', tags: [], pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now }] });
  await page.reload();
  await page.getByRole('button', { name: /^1\s*Notes$/ }).click();
  await page.getByRole('button', { name: /Synthetic share note/ }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic share note', exact: true })).toBeVisible();
  expect(sharingRequests).toEqual([]);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share', exact: true });
  await expect(dialog).toBeVisible();
  expect(sharingRequests).toHaveLength(1);
  await dialog.getByPlaceholder('Enter password...', { exact: true }).fill('synthetic-sharing-password');
  await dialog.getByRole('button', { name: 'Generate Share Link', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy URL', exact: true })).toBeVisible();
  await expect(dialog.getByText(/^https?:\/\/\S+#share=/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
