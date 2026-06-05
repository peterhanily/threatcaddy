import { test, expect } from '@playwright/test';
import { goToApp } from './fixtures';

// Verifies the demo "FERMENTED PERSISTENCE" investigation now showcases the
// new surfaces: evidence files, a product baseline + bulletin, enriched IOCs.

test('sample investigation includes evidence, products, and enriched IOCs', async ({ page }) => {
  await goToApp(page);

  // Settings → General → Load Sample Investigation
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: /Load Sample Investigation/i }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

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
