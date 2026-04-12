import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView, createQuickNote, openNewTaskForm, openSearch, getSidebar } from './fixtures';

test.describe('Onboarding and investigation flow', () => {
  test.describe('Demo mode', () => {
    test('demo modal appears on ?demo URL', async ({ page }) => {
      // Navigate directly to /?demo — skip goToApp which dismisses overlays
      await page.goto('/?demo');

      // Wait for the app to load
      await page.waitForSelector('[data-tour="header"]', { timeout: 15_000 });

      // The demo welcome modal should appear with its title
      const modalTitle = page.getByText('Welcome to ThreatCaddy');
      await expect(modalTitle).toBeVisible({ timeout: 10_000 });

      // Verify the 3 action buttons are present
      const startExploring = page.getByRole('button', { name: 'Start Exploring' });
      const guidedTour = page.getByRole('button', { name: 'Take the Guided Tour' });
      const deleteDemo = page.getByRole('button', { name: 'Delete Demo & Start Fresh' });

      await expect(startExploring).toBeVisible();
      await expect(guidedTour).toBeVisible();
      await expect(deleteDemo).toBeVisible();

      // Click "Start Exploring" to close the modal
      await startExploring.click();

      // Modal should close
      await expect(modalTitle).not.toBeVisible({ timeout: 5_000 });

      // The sample investigation should be loaded — check by navigating to Investigations view
      const sidebar = getSidebar(page);
      await expect(sidebar).toBeVisible();
      await navigateToView(page, 'Investigations');
      await expect(page.getByText('FERMENTED PERSISTENCE')).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Investigation entity workflow', () => {
    test.beforeEach(async ({ page }) => {
      await goToApp(page);
    });

    test('can create investigation and add entities', async ({ page }) => {
      // Create a new investigation
      await createInvestigation(page, 'Test Phishing Case');

      // Verify it appears in the Investigations hub
      await navigateToView(page, 'Investigations');
      await expect(page.getByText('Test Phishing Case')).toBeVisible({ timeout: 5_000 });

      // Select the investigation
      await page.getByText('Test Phishing Case').first().click();

      // Navigate to Notes view and create a note
      await navigateToView(page, 'Notes');
      await createQuickNote(page);

      // Fill in the note title
      const titleInput = page.getByPlaceholder('Note title...');
      await expect(titleInput).toBeVisible({ timeout: 5_000 });
      await titleInput.fill('Phishing Email Analysis');

      // Wait for auto-save
      await page.waitForTimeout(1_500);

      // Verify note appears in the list
      await expect(page.getByText('Phishing Email Analysis')).toBeVisible({ timeout: 5_000 });

      // Navigate to Tasks view and create a task
      await navigateToView(page, 'Tasks');
      await openNewTaskForm(page);

      // Fill in the task title
      const taskTitleInput = page.getByPlaceholder(/task title|title/i).or(
        page.locator('input[aria-label*="itle"]').first()
      );
      await expect(taskTitleInput.first()).toBeVisible({ timeout: 5_000 });
      await taskTitleInput.first().fill('Analyze email headers');

      // Save the task
      const saveButton = page.getByRole('button', { name: /save|create/i });
      await saveButton.click();

      // Verify task appears in the task list
      await expect(page.getByText('Analyze email headers')).toBeVisible({ timeout: 5_000 });
    });

    test('search finds created entities', async ({ page }) => {
      // Set up: create an investigation with a note
      await createInvestigation(page, 'Searchable Case');

      await navigateToView(page, 'Notes');
      await createQuickNote(page);

      const titleInput = page.getByPlaceholder('Note title...');
      await expect(titleInput).toBeVisible({ timeout: 5_000 });
      await titleInput.fill('Unique Artifact Finding');

      // Wait for auto-save
      await page.waitForTimeout(1_500);

      // Open search
      await openSearch(page);

      // Type the note title to search for it
      const searchInput = page.locator('input[type="text"]').first();
      await searchInput.fill('Unique Artifact Finding');

      // Verify the note appears in search results
      await expect(page.getByText('Unique Artifact Finding')).toBeVisible({ timeout: 5_000 });

      // Close search with Escape
      await page.keyboard.press('Escape');
    });

    test('can switch between views', async ({ page }) => {
      // Create an investigation so views have context
      await createInvestigation(page, 'View Navigation Test');

      // Navigate to Notes view
      await navigateToView(page, 'Notes');
      // Notes view should show the notes area (empty state or note list)
      await expect(
        page.getByText(/no notes|create a note|note/i).first()
      ).toBeVisible({ timeout: 5_000 });

      // Navigate to Tasks view
      await navigateToView(page, 'Tasks');
      await expect(
        page.getByText(/no tasks|task/i).first()
      ).toBeVisible({ timeout: 5_000 });

      // Navigate to Timeline view
      await navigateToView(page, 'Timeline');
      await expect(
        page.getByText(/no timeline|timeline|no events/i).first()
      ).toBeVisible({ timeout: 5_000 });

      // Navigate to Graph view
      await navigateToView(page, 'Graph');
      // Graph view renders a canvas or SVG container
      await expect(
        page.locator('canvas, svg, [data-tour="graph"]').first()
      ).toBeVisible({ timeout: 5_000 });

      // Navigate to CaddyAI chat view
      await navigateToView(page, 'CaddyAI');
      // Chat view should show the chat interface area
      const chatArea = page.locator('.flex.flex-1.overflow-hidden').first();
      await expect(chatArea).toBeVisible({ timeout: 5_000 });
    });
  });
});
