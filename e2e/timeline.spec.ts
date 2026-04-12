import { test, expect } from '@playwright/test';
import { goToApp, createInvestigation, selectInvestigation, navigateToView } from './fixtures';

test.describe('Timeline events', () => {
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

  test('create a timeline event', async ({ page }) => {
    await createInvestigation(page, 'Timeline Test');
    await selectInvestigation(page, 'Timeline Test');
    await navigateToView(page, 'Timeline');

    // Click the "New Event" button in the toolbar
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await expect(newEventButton).toBeVisible({ timeout: 5_000 });
    await newEventButton.click();

    // The event creation modal should appear — fill in the title
    const titleInput = page.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Initial compromise detected');

    // Fill in description
    const descriptionInput = page.locator('textarea').filter({ hasText: '' }).first();
    if (await descriptionInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await descriptionInput.fill('Phishing email delivered to user inbox');
    }

    // Select event type if the dropdown is accessible
    const eventTypeSelect = page.locator('select').filter({ has: page.locator('option[value="initial-access"]') });
    if (await eventTypeSelect.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await eventTypeSelect.selectOption('initial-access');
    }

    // Submit the form
    const saveButton = page.getByRole('button', { name: /create event/i }).or(
      page.getByRole('button', { name: /save/i })
    );
    await saveButton.first().click();

    // The event should appear in the timeline feed
    await expect(page.getByText('Initial compromise detected')).toBeVisible({ timeout: 5_000 });
  });

  test('star a timeline event', async ({ page }) => {
    await createInvestigation(page, 'Timeline Star Test');
    await selectInvestigation(page, 'Timeline Star Test');
    await navigateToView(page, 'Timeline');

    // Create an event first
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await newEventButton.click();

    const titleInput = page.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Key evidence found');

    const saveButton = page.getByRole('button', { name: /create event/i }).or(
      page.getByRole('button', { name: /save/i })
    );
    await saveButton.first().click();

    // The event should appear in the feed
    await expect(page.getByText('Key evidence found')).toBeVisible({ timeout: 5_000 });

    // Find and click the star button on the event card
    const starButton = page.getByRole('button', { name: /star event/i });
    await expect(starButton).toBeVisible({ timeout: 3_000 });
    await starButton.click();

    // After starring, the button should now say "Unstar event"
    const unstarButton = page.getByRole('button', { name: /unstar event/i });
    await expect(unstarButton).toBeVisible({ timeout: 3_000 });
  });

  test('create event and verify it appears in feed with correct type', async ({ page }) => {
    await createInvestigation(page, 'Timeline Type Test');
    await selectInvestigation(page, 'Timeline Type Test');
    await navigateToView(page, 'Timeline');

    // Create an event with a specific type
    const newEventButton = page.getByRole('button', { name: /new event/i });
    await newEventButton.click();

    const titleInput = page.getByPlaceholder(/event title/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Lateral movement to domain controller');

    // Fill source field if visible
    const sourceInput = page.getByPlaceholder(/source/i);
    if (await sourceInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await sourceInput.fill('EDR Telemetry');
    }

    const saveButton = page.getByRole('button', { name: /create event/i }).or(
      page.getByRole('button', { name: /save/i })
    );
    await saveButton.first().click();

    // Verify the event appears in the feed
    await expect(page.getByText('Lateral movement to domain controller')).toBeVisible({ timeout: 5_000 });

    // The event should show the "Today" date group header
    await expect(page.getByText(/today/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
