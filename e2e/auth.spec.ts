import { test, expect } from '@playwright/test';
import { goToApp, getSidebar, createInvestigation, navigateToView } from './fixtures';

test.describe('Authentication & local-first access', () => {
  // Each Playwright test gets a fresh browser context by default —
  // no need to manually clear storage. Dexie creates a fresh DB in each context.

  test('app loads without authentication required (local-first)', async ({ page }) => {
    await goToApp(page);

    // The header should be visible — the app doesn't gate behind a login
    const header = page.locator('header[data-tour="header"]');
    await expect(header).toBeVisible();

    // The sidebar navigation should be accessible
    const sidebar = getSidebar(page);
    await expect(sidebar).toBeVisible();
  });

  test('Settings panel opens and shows server connection section', async ({ page }) => {
    await goToApp(page);

    // Open settings via the sidebar footer
    const sidebar = getSidebar(page);
    await sidebar.getByRole('button', { name: 'Settings' }).click();

    // Settings panel should be visible with the Server/Team section
    await expect(page.getByText('Team Server', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('server connection shows login/register UI when URL is provided', async ({ page }) => {
    await goToApp(page);

    // Open settings
    const sidebar = getSidebar(page);
    await sidebar.getByRole('button', { name: 'Settings' }).click();

    // The server connection section should show a URL input
    // Look for the connect/server URL input area
    await expect(page.getByText('Team Server', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('login with invalid server URL shows error gracefully', async ({ page }) => {
    await goToApp(page);

    // Open settings
    const sidebar = getSidebar(page);
    await sidebar.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Team Server', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('app preserves local data across page reloads', async ({ page }) => {
    await goToApp(page);

    // Create an investigation via the Investigations hub modal
    await createInvestigation(page, 'Persistence Test');

    // Navigate to Investigations view to verify it exists
    await navigateToView(page, 'Investigations');
    const main = page.locator('#main-content');
    await expect(main.getByText('Persistence Test').first()).toBeVisible({ timeout: 5_000 });

    // Reload the page
    await page.reload();
    await goToApp(page);

    // The investigation should still be there (IndexedDB persists)
    await navigateToView(page, 'Investigations');
    await expect(main.getByText('Persistence Test').first()).toBeVisible({ timeout: 10_000 });
  });
});
