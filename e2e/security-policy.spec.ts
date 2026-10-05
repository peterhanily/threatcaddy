import { test, expect } from '@playwright/test';
import { goToApp, openNewTaskForm } from './fixtures';

test('hosted startup and a lazy dialog have no CSP diagnostics or browser errors', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' || /content[- ]security[- ]policy|\bcsp\b/i.test(message.text())) {
      diagnostics.push(message.text());
    }
  });
  page.on('pageerror', error => diagnostics.push(error.message));

  await goToApp(page);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Views"]')).toBeVisible();
  await openNewTaskForm(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(diagnostics).toEqual([]);
});
