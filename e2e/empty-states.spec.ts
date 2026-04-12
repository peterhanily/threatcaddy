import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView } from './fixtures';

test.describe('Empty states', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('notes empty state shows CTA', async ({ page }) => {
    await createInvestigation(page, 'Empty Notes Test');
    await navigateToView(page, 'Notes');

    // With no notes, the empty state should show the "Create your first note" button
    const emptyStateMessage = page.getByText(/no notes yet/i);
    await expect(emptyStateMessage).toBeVisible({ timeout: 5_000 });

    const createFirstButton = page.getByText(/create your first note/i);
    await expect(createFirstButton).toBeVisible({ timeout: 3_000 });
  });

  test('tasks empty state shows CTA', async ({ page }) => {
    await createInvestigation(page, 'Empty Tasks Test');
    await navigateToView(page, 'Tasks');

    // With no tasks, the empty state should be visible
    const emptyStateMessage = page.getByText(/no tasks yet/i);
    await expect(emptyStateMessage).toBeVisible({ timeout: 5_000 });

    const createFirstButton = page.getByText(/create your first task/i);
    await expect(createFirstButton).toBeVisible({ timeout: 3_000 });
  });

  test('timeline empty state shows hint text', async ({ page }) => {
    await createInvestigation(page, 'Empty Timeline Test');
    await navigateToView(page, 'Timeline');

    // With no timeline events, the empty state should show the hint
    const emptyStateMessage = page.getByText(/no timeline events yet/i);
    await expect(emptyStateMessage).toBeVisible({ timeout: 5_000 });

    const hintText = page.getByText(/use the.*button.*to add your first event/i);
    await expect(hintText).toBeVisible({ timeout: 3_000 });
  });

  test('clicking notes empty state CTA creates a note', async ({ page }) => {
    await createInvestigation(page, 'Notes CTA Test');
    await navigateToView(page, 'Notes');

    // Click the "Create your first note" button
    const createFirstButton = page.getByText(/create your first note/i);
    await expect(createFirstButton).toBeVisible({ timeout: 5_000 });
    await createFirstButton.click();

    // A note editor should appear with the title input
    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });

    // Fill in a title to confirm the note was created
    await titleInput.fill('My First Note');
    await page.waitForTimeout(1_500);

    // The note should appear in the list
    await expect(page.getByText('My First Note')).toBeVisible({ timeout: 5_000 });

    // The empty state should no longer be visible
    await expect(page.getByText(/no notes yet/i)).not.toBeVisible();
  });

  test('clicking tasks empty state CTA opens task form', async ({ page }) => {
    await createInvestigation(page, 'Tasks CTA Test');
    await navigateToView(page, 'Tasks');

    // Click the "Create your first task" button
    const createFirstButton = page.getByText(/create your first task/i);
    await expect(createFirstButton).toBeVisible({ timeout: 5_000 });
    await createFirstButton.click();

    // The task creation modal should appear with the title input
    const taskTitleInput = page.getByPlaceholder(/task title/i);
    await expect(taskTitleInput).toBeVisible({ timeout: 5_000 });

    // Fill in and save a task
    await taskTitleInput.fill('My First Task');
    const createButton = page.getByRole('button', { name: /create task/i });
    await createButton.click();

    // The task should appear in the list
    await expect(page.getByText('My First Task')).toBeVisible({ timeout: 5_000 });

    // The empty state should no longer be visible
    await expect(page.getByText(/no tasks yet/i)).not.toBeVisible();
  });
});
