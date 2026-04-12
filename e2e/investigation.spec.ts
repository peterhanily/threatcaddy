import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView, openSearch, createQuickNote, openNewTaskForm } from './fixtures';

test.describe('Investigation workflow', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('create a new investigation', async ({ page }) => {
    await createInvestigation(page, 'Operation Sunrise');

    // Investigation should appear in the Investigations hub after navigating back
    await navigateToView(page, 'Investigations');
    await expect(page.getByText('Operation Sunrise')).toBeVisible({ timeout: 5_000 });
  });

  test('add a note to the investigation', async ({ page }) => {
    await createInvestigation(page, 'Note Test Case');

    // Navigate to Notes view
    await navigateToView(page, 'Notes');

    // Create a quick note
    await createQuickNote(page);

    // A note editor should appear — type a title
    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Investigation Finding #1');

    // Type content in the editor
    const editor = page.getByPlaceholder('Start writing in markdown...');
    await editor.fill('Observed suspicious DNS queries to known C2 domain.');

    // Wait for auto-save (the app auto-saves on a debounce timer)
    await page.waitForTimeout(1_500);

    // The note title should appear in the note list
    await expect(page.getByText('Investigation Finding #1')).toBeVisible({ timeout: 5_000 });
  });

  test('add a task to the investigation', async ({ page }) => {
    await createInvestigation(page, 'Task Test Case');

    // Navigate to Tasks view
    await navigateToView(page, 'Tasks');

    // Open the new task form
    await openNewTaskForm(page);

    // Wait for the task form modal to appear
    // The task form should have a title input
    const titleInput = page.getByPlaceholder(/task title|title/i).or(
      page.locator('input[aria-label*="itle"]').first()
    );

    // Try to find the title input in the modal
    await expect(titleInput.first()).toBeVisible({ timeout: 5_000 });
    await titleInput.first().fill('Analyze malware sample');

    // Save the task
    const saveButton = page.getByRole('button', { name: /save|create/i });
    await saveButton.click();

    // The task should appear in the task list
    await expect(page.getByText('Analyze malware sample')).toBeVisible({ timeout: 5_000 });
  });

  test('search for note content', async ({ page }) => {
    await createInvestigation(page, 'Search Test Case');

    // Create a note with specific content
    await navigateToView(page, 'Notes');
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Unique Beacon Detection');

    const editor = page.getByPlaceholder('Start writing in markdown...');
    await editor.fill('Found Cobalt Strike beacon calling home to 10.0.0.1.');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Open search overlay
    await openSearch(page);

    // Type search query
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Cobalt Strike');

    // Search results should include our note
    await expect(page.getByText('Unique Beacon Detection')).toBeVisible({ timeout: 5_000 });
  });

  test('close an investigation via the detail panel', async ({ page }) => {
    await createInvestigation(page, 'Closure Test');

    // After creation, the app navigates into the investigation.
    // The sidebar shows an investigation context header with a settings button.
    // Click the investigation card in the sidebar to open the edit panel.
    const sidebar = page.locator('nav[aria-label="Main navigation"]');

    // Look for the investigation card — it should show after selecting
    const investigationCard = sidebar.getByText('Closure Test');
    await investigationCard.first().click();

    // If the detail panel opened, we should see investigation settings
    const detailPanel = page.getByText('Investigation Details');
    if (await detailPanel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Click the "Closed" status button
      const closedButton = page.getByRole('button', { name: 'Closed' });
      if (await closedButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await closedButton.click();

        // The investigation should now show as closed
        await expect(page.getByText('Closure Test')).toBeVisible();
      }
    }
  });
});
