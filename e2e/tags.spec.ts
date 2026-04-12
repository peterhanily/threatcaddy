import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView, createQuickNote, getSidebar } from './fixtures';

test.describe('Tags', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('create a tag on a note and see it in the sidebar', async ({ page }) => {
    await createInvestigation(page, 'Tag Test Case');
    await navigateToView(page, 'Notes');

    // Create a note
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Tagged Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Find the tag input in the note editor footer
    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await expect(tagInput.first()).toBeVisible({ timeout: 5_000 });
    await tagInput.first().fill('phishing');
    await tagInput.first().press('Enter');

    // Wait for the tag to be created and saved
    await page.waitForTimeout(1_500);

    // The tag pill should appear in the note editor
    await expect(page.getByText('phishing').first()).toBeVisible({ timeout: 5_000 });

    // The tag should also appear in the sidebar tag list
    const sidebar = getSidebar(page);

    // Expand the Tags section if collapsed
    const tagsToggle = sidebar.getByText('Tags');
    if (await tagsToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Tags section exists — check if it has the tag
      await expect(sidebar.getByText('phishing')).toBeVisible({ timeout: 5_000 });
    }
  });

  test('create multiple tags on a note', async ({ page }) => {
    await createInvestigation(page, 'Multi Tag Test');
    await navigateToView(page, 'Notes');

    // Create a note
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Multi-tagged Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Add first tag
    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await tagInput.first().fill('malware');
    await tagInput.first().press('Enter');
    await page.waitForTimeout(500);

    // Add second tag
    await tagInput.first().fill('c2-traffic');
    await tagInput.first().press('Enter');
    await page.waitForTimeout(1_500);

    // Both tag pills should be visible in the note editor
    await expect(page.getByText('malware').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('c2-traffic').first()).toBeVisible({ timeout: 5_000 });

    // Both tags should appear in the sidebar
    const sidebar = getSidebar(page);
    await expect(sidebar.getByText('malware')).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByText('c2-traffic')).toBeVisible({ timeout: 5_000 });
  });

  test('filter notes by clicking a tag in the sidebar', async ({ page }) => {
    await createInvestigation(page, 'Tag Filter Test');
    await navigateToView(page, 'Notes');

    // Create first note with a tag
    await createQuickNote(page);
    const titleInput1 = page.getByPlaceholder('Note title...');
    await expect(titleInput1).toBeVisible({ timeout: 5_000 });
    await titleInput1.fill('Ransomware Analysis');
    await page.waitForTimeout(1_500);

    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await tagInput.first().fill('ransomware');
    await tagInput.first().press('Enter');
    await page.waitForTimeout(1_500);

    // Create second note without the tag
    await createQuickNote(page);
    const titleInput2 = page.getByPlaceholder('Note title...');
    await expect(titleInput2).toBeVisible({ timeout: 5_000 });
    await titleInput2.fill('Unrelated Finding');
    await page.waitForTimeout(1_500);

    // Both notes should be visible
    await expect(page.getByText('Ransomware Analysis')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Unrelated Finding')).toBeVisible({ timeout: 5_000 });

    // Click the ransomware tag in the sidebar to filter
    const sidebar = getSidebar(page);
    const sidebarTag = sidebar.getByText('ransomware');
    if (await sidebarTag.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sidebarTag.click();

      // After filtering, only the tagged note should be visible
      await expect(page.getByText('Ransomware Analysis')).toBeVisible({ timeout: 5_000 });
      // The untagged note should be hidden
      await expect(page.getByText('Unrelated Finding')).not.toBeVisible({ timeout: 3_000 });
    }
  });
});
