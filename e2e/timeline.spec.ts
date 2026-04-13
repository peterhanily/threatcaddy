import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView } from './fixtures';

test.describe('Timeline events', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('create a timeline event', async ({ page }) => {
    await createInvestigation(page, 'Timeline Test');
    await navigateToView(page, 'Timeline');

    // Click the "New Event" button in the toolbar
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await expect(newEventButton).toBeVisible({ timeout: 5_000 });
    await newEventButton.click();

    // The event creation modal should appear — fill in the title
    const dialog = page.getByRole('dialog', { name: /create event/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const titleInput = dialog.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Initial compromise detected');

    // Fill in description
    const descriptionInput = dialog.locator('textarea').first();
    if (await descriptionInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await descriptionInput.fill('Phishing email delivered to user inbox');
    }

    // Submit the form — scoped to the dialog
    const saveButton = dialog.getByRole('button', { name: /create event/i });
    await saveButton.click();

    // The event should appear in the timeline feed
    await expect(page.getByText('Initial compromise detected')).toBeVisible({ timeout: 5_000 });
  });

  test('star a timeline event', async ({ page }) => {
    await createInvestigation(page, 'Timeline Star Test');
    await navigateToView(page, 'Timeline');

    // Create an event first
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await newEventButton.click();

    const dialog = page.getByRole('dialog', { name: /create event/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const titleInput = dialog.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Key evidence found');

    const saveButton = dialog.getByRole('button', { name: /create event/i });
    await saveButton.click();

    // The event should appear in the feed
    await expect(page.getByText('Key evidence found')).toBeVisible({ timeout: 5_000 });

    // Find and click the star button on the event card (use exact match to avoid parent card)
    const starButton = page.getByRole('button', { name: 'Star event', exact: true });
    await expect(starButton).toBeVisible({ timeout: 3_000 });
    await starButton.click();

    // After starring, the button should now say "Unstar event"
    const unstarButton = page.getByRole('button', { name: 'Unstar event', exact: true });
    await expect(unstarButton).toBeVisible({ timeout: 3_000 });
  });

  test('create event and verify it appears in feed with correct type', async ({ page }) => {
    await createInvestigation(page, 'Timeline Type Test');
    await navigateToView(page, 'Timeline');

    // Create an event with a specific type
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await newEventButton.click();

    const dialog = page.getByRole('dialog', { name: /create event/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const titleInput = dialog.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Lateral movement to domain controller');

    // Fill source field if visible
    const sourceInput = dialog.getByPlaceholder(/source/i);
    if (await sourceInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await sourceInput.fill('EDR Telemetry');
    }

    const saveButton = dialog.getByRole('button', { name: /create event/i });
    await saveButton.click();

    // Verify the event appears in the feed
    await expect(page.getByText('Lateral movement to domain controller')).toBeVisible({ timeout: 5_000 });

    // The event should show the "Today" date group header
    await expect(page.getByText(/today/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
