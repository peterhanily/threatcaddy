import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation } from './fixtures';

// Smoke test for the newly-wired Evidence and Products surfaces: confirm each
// mounts, resolves i18n (raw keys would not match these strings), and captures
// a screenshot for visual inspection.
//
// CaddyAI's CTI slash commands (/vt, /cti, …) are not exercised here: CaddyAI's
// "New Chat" is disabled without the browser extension (see chat.spec.ts), so a
// chat thread can't be created headlessly. The CTI formatter is covered by
// cti-source-formatting.test.ts, and the handler bypasses the LLM key/budget
// gates so it runs deterministically once a thread exists.

test('Evidence tab mounts and renders translated empty state', async ({ page }) => {
  await goToApp(page);
  await createInvestigation(page, 'Smoke Op');

  const views = page.locator('nav[aria-label="Views"]');
  await views.getByRole('button', { name: 'Evidence' }).click();

  await expect(page.getByRole('heading', { name: 'No evidence yet' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder('Search evidence')).toBeVisible();
  await expect(page.getByText('Drop evidence files here')).toBeVisible();
  // shell intact (no white-screen crash)
  await expect(views.getByRole('button', { name: 'Products' })).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-evidence.png', fullPage: true });
});

test('Products tab mounts and renders translated empty state', async ({ page }) => {
  await goToApp(page);
  await createInvestigation(page, 'Smoke Op Products');

  const views = page.locator('nav[aria-label="Views"]');
  await views.getByRole('button', { name: 'Products' }).click();

  await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Product Baselines')).toBeVisible();
  await expect(page.getByPlaceholder('Search products')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-products.png', fullPage: true });
});
