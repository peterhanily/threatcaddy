import { test, expect } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';

test.describe('AI chat (CaddyAI)', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('open chat tab', async ({ page }) => {
    await navigateToView(page, 'CaddyAI');

    // The chat view should be visible with either the onboarding overlay
    // or the thread list
    const chatArea = page.locator('.flex.flex-1.overflow-hidden').first();
    await expect(chatArea).toBeVisible({ timeout: 5_000 });
  });

  test('shows onboarding message when no API keys configured', async ({ page }) => {
    await navigateToView(page, 'CaddyAI');

    // On first use with no API keys, the onboarding overlay should appear
    // It contains text about configuring an API key
    const onboarding = page.getByText('Getting Started with CaddyAI');
    if (await onboarding.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(onboarding).toBeVisible();

      // It should mention configuring an API key
      await expect(page.getByText('Configure an API key')).toBeVisible();

      // Dismiss the onboarding
      const gotItButton = page.getByRole('button', { name: /got it/i });
      await gotItButton.click();

      // After dismissing, the onboarding should be hidden
      await expect(onboarding).not.toBeVisible();
    }

    // After dismissing onboarding (or if already dismissed), the thread list
    // should show "No chat threads yet"
    await expect(page.getByText('No chat threads yet')).toBeVisible({ timeout: 5_000 });
  });

  test('new chat thread appears in sidebar', async ({ page }) => {
    await navigateToView(page, 'CaddyAI');

    // Dismiss onboarding if present
    const gotItButton = page.getByRole('button', { name: /got it/i });
    if (await gotItButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await gotItButton.click();
    }

    // Click "New Chat" button
    const newChatButton = page.getByRole('button', { name: /new chat/i });
    await expect(newChatButton).toBeVisible({ timeout: 5_000 });

    // The button may be disabled if the extension bridge is not available
    // Check if it's enabled first
    const isDisabled = await newChatButton.isDisabled();

    if (!isDisabled) {
      await newChatButton.click();

      // A new thread should appear in the thread list sidebar
      // The "No chat threads yet" message should disappear
      await expect(page.getByText('No chat threads yet')).not.toBeVisible({ timeout: 5_000 });

      // The chat area should show "Start a conversation"
      await expect(page.getByText('Start a conversation')).toBeVisible({ timeout: 5_000 });
    } else {
      // If button is disabled, we just verify it's there and shows the right tooltip
      await expect(newChatButton).toHaveAttribute('title', /extension.*required|server.*required/i);
    }
  });
});
