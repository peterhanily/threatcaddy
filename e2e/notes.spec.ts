import { test, expect } from '@playwright/test';
import { goToApp, navigateToView, createQuickNote, getSidebar } from './fixtures';

test.describe('Note editing', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('create a note with markdown content', async ({ page }) => {
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    // Fill in the title
    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Markdown Test Note');

    // Type markdown content
    const editor = page.getByPlaceholder('Start writing in markdown...');
    await editor.fill('# Heading\n\n**Bold text** and *italic text*\n\n- List item 1\n- List item 2\n\n```\ncode block\n```');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Switch to preview mode to verify markdown rendering
    const previewButton = page.getByRole('button', { name: /preview/i }).or(
      page.getByTitle(/preview/i)
    );
    if (await previewButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await previewButton.first().click();

      // In preview mode, the rendered markdown should show the heading
      await expect(page.locator('h1:has-text("Heading")')).toBeVisible({ timeout: 3_000 });
    }

    // The note should appear in the note list
    await expect(page.getByText('Markdown Test Note')).toBeVisible();
  });

  test('edit note title', async ({ page }) => {
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Original Title');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Now edit the title
    await titleInput.clear();
    await titleInput.fill('Updated Title');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // The updated title should appear in the note list
    await expect(page.getByText('Updated Title')).toBeVisible({ timeout: 5_000 });

    // The old title should no longer appear
    await expect(page.getByText('Original Title')).not.toBeVisible();
  });

  test('pin and unpin a note', async ({ page }) => {
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Pin Test Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Click the pin button in the note editor toolbar
    const pinButton = page.getByRole('button', { name: /pin note/i });
    await expect(pinButton).toBeVisible({ timeout: 3_000 });
    await pinButton.click();

    // After pinning, the button label should change to "Unpin note"
    const unpinButton = page.getByRole('button', { name: /unpin note/i });
    await expect(unpinButton).toBeVisible({ timeout: 3_000 });

    // Unpin the note
    await unpinButton.click();

    // Should be back to "Pin note"
    await expect(page.getByRole('button', { name: /pin note/i })).toBeVisible({ timeout: 3_000 });
  });

  test('delete a note (move to trash)', async ({ page }) => {
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Trash Test Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Click the trash button in the note editor
    const trashButton = page.getByRole('button', { name: /move note to trash/i });
    await expect(trashButton).toBeVisible({ timeout: 3_000 });
    await trashButton.click();

    // The note should no longer appear in the main notes list
    // Give time for the state to update
    await page.waitForTimeout(500);

    // Navigate to the trash view to verify the note is there
    const sidebar = getSidebar(page);
    const trashNav = sidebar.getByRole('button', { name: /trash/i });
    await trashNav.click();

    // The trashed note should appear in the trash view
    await expect(page.getByText('Trash Test Note')).toBeVisible({ timeout: 5_000 });
  });
});
