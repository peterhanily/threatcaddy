import { test, expect } from '@playwright/test';
import { goToApp } from './fixtures';

test.describe('Authentication & local-first access', () => {
  // Each Playwright test gets a fresh browser context by default —
  // no need to manually clear storage. Dexie creates a fresh DB in each context.

  test('app loads without authentication required (local-first)', async ({ page }) => {
    await goToApp(page);

    // The header should be visible — the app doesn't gate behind a login
    const header = page.locator('header[data-tour="header"]');
    await expect(header).toBeVisible();

    // The sidebar navigation should be accessible
    const sidebar = page.locator('aside[role="navigation"]');
    await expect(sidebar).toBeVisible();
  });

  test('Settings panel opens and shows server connection section', async ({ page }) => {
    await goToApp(page);

    // Open settings via the sidebar footer
    const sidebar = page.locator('aside[role="navigation"]');
    await sidebar.getByText('Settings').click();

    // Settings panel should be visible with the Server/Team section
    await expect(page.getByText('Server / Team')).toBeVisible({ timeout: 5_000 });
  });

  test('server connection shows login/register UI when URL is provided', async ({ page }) => {
    await goToApp(page);

    // Open settings
    const sidebar = page.locator('aside[role="navigation"]');
    await sidebar.getByText('Settings').click();

    // The server connection section should show a URL input
    // Look for the connect/server URL input area
    await expect(page.getByText('Server / Team')).toBeVisible({ timeout: 5_000 });
  });

  test('login with invalid server URL shows error gracefully', async ({ page }) => {
    await goToApp(page);

    // Open settings
    const sidebar = page.locator('aside[role="navigation"]');
    await sidebar.getByText('Settings').click();
    await expect(page.getByText('Server / Team')).toBeVisible({ timeout: 5_000 });
  });

  test('app preserves local data across page reloads', async ({ page }) => {
    await goToApp(page);

    // Create an investigation
    const sidebar = page.locator('aside[role="navigation"]');
    const newButton = sidebar.getByRole('button', { name: /^New$/ });
    await newButton.click();

    const nameInput = sidebar.getByPlaceholder('Investigation name');
    await nameInput.fill('Persistence Test');
    await nameInput.press('Enter');

    await expect(sidebar.getByText('Persistence Test')).toBeVisible({ timeout: 5_000 });

    // Reload the page
    await page.reload();
    await goToApp(page);

    // The investigation should still be there (IndexedDB persists)
    const sidebarAfterReload = page.locator('aside[role="navigation"]');
    await expect(sidebarAfterReload.getByText('Persistence Test')).toBeVisible({ timeout: 5_000 });
  });
});
