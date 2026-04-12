import { readFileSync } from 'fs';
import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView, createQuickNote, getSidebar } from './fixtures';

test.describe('Export and import', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('export JSON backup via settings', async ({ page }) => {
    // Create some data first
    await createInvestigation(page, 'Export Test Case');
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Export test note');
    await page.waitForTimeout(1_500);

    // Open settings
    const sidebar = getSidebar(page);
    const settingsButton = sidebar.getByRole('button', { name: /settings/i });
    await settingsButton.click();

    // Navigate to the Data tab in settings
    const dataTab = page.getByText('Data').or(
      page.getByRole('button', { name: /data/i })
    );
    if (await dataTab.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dataTab.first().click();
    }

    // Find the "Export JSON Backup" button
    const exportButton = page.getByRole('button', { name: /export json/i }).or(
      page.getByText('Export JSON Backup')
    );
    await expect(exportButton.first()).toBeVisible({ timeout: 5_000 });

    // Set up download listener and click export
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      exportButton.first().click(),
    ]);

    // Verify the download happened
    expect(download.suggestedFilename()).toMatch(/threatcaddy-backup.*\.json/);

    // Read the downloaded file and verify it contains our data
    const downloadPath = await download.path();
    const content = downloadPath ? readFileSync(downloadPath, 'utf-8') : null;

    if (content) {
      const data = JSON.parse(content);
      // The export should contain notes
      expect(data.notes).toBeDefined();
      expect(data.notes.length).toBeGreaterThan(0);
      // It should contain our specific note
      const exportedNote = data.notes.find((n: { title: string }) => n.title === 'Export test note');
      expect(exportedNote).toBeTruthy();
    }
  });

  test('import JSON button exists and opens file dialog', async ({ page }) => {
    // Open settings
    const sidebar = getSidebar(page);
    const settingsButton = sidebar.getByRole('button', { name: /settings/i });
    await settingsButton.click();

    // Navigate to the Data tab in settings
    const dataTab = page.getByText('Data').or(
      page.getByRole('button', { name: /data/i })
    );
    if (await dataTab.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dataTab.first().click();
    }

    // Verify the "Import JSON Backup" button/label exists
    const importButton = page.getByText(/import json/i);
    await expect(importButton.first()).toBeVisible({ timeout: 5_000 });

    // The import button contains a hidden file input — verify it exists
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await expect(fileInput).toBeAttached();
  });

  test('quick save backup button is accessible in header', async ({ page }) => {
    // The backup/save button should be in the header
    const backupButton = page.locator('[data-tour="backup"]');
    await expect(backupButton).toBeVisible({ timeout: 5_000 });

    // Set up download listener and click the quick save button
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      backupButton.click(),
    ]);

    // Verify a backup file was downloaded
    expect(download.suggestedFilename()).toMatch(/threatcaddy.*\.json/);
  });
});
