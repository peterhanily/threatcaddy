import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, selectInvestigation, navigateToView, openNewTaskForm } from './fixtures';

test.describe('Task lifecycle', () => {
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

  test('create a task with title and description', async ({ page }) => {
    await createInvestigation(page, 'Task Lifecycle Test');
    await selectInvestigation(page, 'Task Lifecycle Test');
    await navigateToView(page, 'Tasks');

    // Open new task form via the header dropdown
    await openNewTaskForm(page);

    // Fill in the title
    const titleInput = page.getByPlaceholder(/task title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Analyze phishing headers');

    // Fill in the description
    const descriptionInput = page.getByPlaceholder(/description/i);
    await descriptionInput.fill('Check X-Originating-IP and Return-Path headers for anomalies');

    // Submit the form
    const createButton = page.getByRole('button', { name: /create task/i });
    await createButton.click();

    // The task should appear in the task list
    await expect(page.getByText('Analyze phishing headers')).toBeVisible({ timeout: 5_000 });
  });

  test('change task status via the form', async ({ page }) => {
    await createInvestigation(page, 'Task Status Test');
    await selectInvestigation(page, 'Task Status Test');
    await navigateToView(page, 'Tasks');

    // Create a task first
    await openNewTaskForm(page);
    const titleInput = page.getByPlaceholder(/task title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Status change task');

    // Set status to "in-progress" before saving
    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="in-progress"]') }).first();
    await statusSelect.selectOption('in-progress');

    const createButton = page.getByRole('button', { name: /create task/i });
    await createButton.click();

    // The task should appear in the list
    await expect(page.getByText('Status change task')).toBeVisible({ timeout: 5_000 });

    // Click on the task to open edit form and verify status is "in-progress"
    await page.getByText('Status change task').click();

    // In the edit modal, the status select should show "in-progress"
    const editStatusSelect = page.locator('select').filter({ has: page.locator('option[value="in-progress"]') }).first();
    await expect(editStatusSelect).toHaveValue('in-progress');
  });

  test('change task priority', async ({ page }) => {
    await createInvestigation(page, 'Task Priority Test');
    await selectInvestigation(page, 'Task Priority Test');
    await navigateToView(page, 'Tasks');

    // Create a task with high priority
    await openNewTaskForm(page);
    const titleInput = page.getByPlaceholder(/task title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('High priority task');

    // Set priority to "high"
    const prioritySelect = page.locator('select').filter({ has: page.locator('option[value="high"]') }).first();
    await prioritySelect.selectOption('high');

    const createButton = page.getByRole('button', { name: /create task/i });
    await createButton.click();

    // Task should appear in the list
    await expect(page.getByText('High priority task')).toBeVisible({ timeout: 5_000 });

    // Click to edit and verify priority persisted
    await page.getByText('High priority task').click();
    const editPrioritySelect = page.locator('select').filter({ has: page.locator('option[value="high"]') }).first();
    await expect(editPrioritySelect).toHaveValue('high');
  });

  test('switch between list and kanban view', async ({ page }) => {
    await createInvestigation(page, 'Task View Toggle');
    await selectInvestigation(page, 'Task View Toggle');
    await navigateToView(page, 'Tasks');

    // Create a task so there is content to see
    await openNewTaskForm(page);
    const titleInput = page.getByPlaceholder(/task title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('View toggle task');
    const createButton = page.getByRole('button', { name: /create task/i });
    await createButton.click();

    await expect(page.getByText('View toggle task')).toBeVisible({ timeout: 5_000 });

    // Should start in list view — verify the list view button is active
    const listViewButton = page.getByRole('button', { name: /list view/i });
    const kanbanViewButton = page.getByRole('button', { name: /kanban view/i });

    await expect(listViewButton).toBeVisible();
    await expect(kanbanViewButton).toBeVisible();

    // Switch to kanban view
    await kanbanViewButton.click();

    // Kanban columns should appear (To Do, In Progress, Done)
    const kanbanBoard = page.locator('[role="region"][aria-label*="anban"]').or(
      page.locator('[role="region"]').filter({ hasText: 'To Do' })
    );
    await expect(kanbanBoard.first()).toBeVisible({ timeout: 5_000 });

    // The task should be visible in one of the kanban columns
    await expect(page.getByText('View toggle task')).toBeVisible();

    // Verify all three column headers are present
    await expect(page.getByText('To Do')).toBeVisible();
    await expect(page.getByText('In Progress')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();

    // Switch back to list view
    await listViewButton.click();

    // Task should still be visible in list view
    await expect(page.getByText('View toggle task')).toBeVisible({ timeout: 5_000 });
  });
});
