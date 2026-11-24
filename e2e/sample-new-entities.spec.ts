import { test, expect } from '@playwright/test';
import { goToApp } from './fixtures';

// Verifies the demo "FERMENTED PERSISTENCE" investigation now showcases the
// new surfaces: evidence files, a product baseline + bulletin, enriched IOCs.

test('parody sample investigation includes evidence and products', async ({ page }) => {
  await goToApp(page);

  // These evidence filenames and product baseline belong to the parody, not
  // the default realistic mailbox case. Select the distinct accessible name.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Load Sample Investigation — Parody — FERMENTED PERSISTENCE', exact: true }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Executive Summary — FERMENTED PERSISTENCE');

  const views = page.locator('nav[aria-label="Views"]');

  // Evidence — the imported source files
  await views.getByRole('button', { name: 'Evidence' }).click();
  await expect(page.getByText('splunk_export_fermented.csv').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('vinegar_conversion_chart.pdf').first()).toBeVisible();
  await expect(page.getByText('slaw_advisor_injection.png').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/sample-evidence.png', fullPage: true });

  // Products — baseline + finished bulletin
  await views.getByRole('button', { name: 'Products' }).click();
  await expect(page.getByText('Condiment Sector ISAC').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/sample-products.png', fullPage: true });
});

test('treats the parody sample\'s adversary as a threat actor, not an identity to add, without changing Settings', async ({ page }) => {
  await goToApp(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}').attributionActors ?? null);
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Load Sample Investigation — Parody — FERMENTED PERSISTENCE', exact: true }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Executive Summary — FERMENTED PERSISTENCE');
  await page.locator('nav[aria-label="Views"]').getByRole('button', { name: 'Identities' }).click();
  // Rai Sinn is named as an event's Actor and @-mentioned in a note: both are listed in the profile's Activity.
  await page.getByRole('region', { name: 'Identities', exact: true }).getByRole('button', { name: /^Rai Sinn/ }).click();
  const activity = page.getByRole('article', { name: 'Rai Sinn' }).getByRole('region', { name: /Activity/ });
  await expect(activity).toContainText('approves the "Slaw Freshness" cron change');
  await expect(activity).toContainText('Interview — how the cron change was approved');
  await expect(page.getByRole('button', { name: /VINEGAR PANDA/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}').attributionActors ?? null)).toEqual(before);
});
