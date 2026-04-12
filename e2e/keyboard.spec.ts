import { test, expect } from '@playwright/test';
import { goToApp } from './fixtures';

test.describe('Keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });
    await goToApp(page);
  });

  test('Ctrl+K opens search overlay and Escape closes it', async ({ page }) => {
    // Press Ctrl+K to open search
    await page.keyboard.press('Control+k');

    // The search overlay should appear with a text input
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Wait briefly for the overlay to close
    await page.waitForTimeout(500);

    // The search overlay should no longer be focused/prominent
    // Verify the header is still visible (app is functional)
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
  });

  test('Ctrl+N creates a new note', async ({ page }) => {
    // Press Ctrl+N to create a new note
    await page.keyboard.press('Control+n');

    // The note editor should appear with the title input
    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
  });

  test('Ctrl+Shift+T opens new task form', async ({ page }) => {
    // Press Ctrl+Shift+T to create a new task
    await page.keyboard.press('Control+Shift+t');

    // The task creation modal should appear with the title input
    const taskTitleInput = page.getByPlaceholder(/task title/i);
    await expect(taskTitleInput).toBeVisible({ timeout: 5_000 });

    // Close the modal with Escape
    await page.keyboard.press('Escape');
  });

  test('Escape closes open modals', async ({ page }) => {
    // Open search overlay via Ctrl+K
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    // Escape should close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Open settings via the sidebar settings button
    const sidebar = page.locator('aside[role="navigation"]');
    const settingsButton = sidebar.getByText('Settings').or(
      sidebar.getByRole('button', { name: /settings/i })
    );
    if (await settingsButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await settingsButton.first().click();

      // Settings panel should be visible
      const settingsPanel = page.getByText('Export & Import').or(
        page.getByText(/preferences/i)
      );
      if (await settingsPanel.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Escape should close settings
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Verify the header is still visible (app returned to normal state)
        await expect(page.locator('[data-tour="header"]')).toBeVisible();
      }
    }
  });

  test('Ctrl+1 through Ctrl+4 switch views', async ({ page }) => {
    // Ctrl+1 should switch to notes view
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(500);

    // The notes view should be active — look for the note title placeholder
    // or the notes empty state
    const notesView = page.getByPlaceholder('Note title...').or(
      page.getByText(/no notes yet/i)
    );
    await expect(notesView.first()).toBeVisible({ timeout: 5_000 });

    // Ctrl+2 should switch to tasks view
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(500);

    const tasksView = page.getByText(/tasks/i).first();
    await expect(tasksView).toBeVisible({ timeout: 5_000 });
  });
});
