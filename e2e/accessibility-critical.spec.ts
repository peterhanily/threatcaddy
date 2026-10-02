import { test, expect } from '@playwright/test';

for (const scenario of [
  { name: 'narrow mobile', language: 'en', width: 390, height: 844, mobile: true },
  { name: 'Arabic RTL', language: 'ar', width: 1280, height: 800, mobile: false },
]) {
  test(`${scenario.name}: reduced-motion keyboard task creation, focus trap and Escape`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(language => {
      if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false }));
    }, scenario.language);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', scenario.language);
    await expect(page.locator('html')).toHaveAttribute('dir', scenario.language === 'ar' ? 'rtl' : 'ltr');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    if (scenario.mobile) {
      const analyst = page.getByRole('button', { name: 'Switch to Analyst Mode' });
      await expect(analyst).toBeVisible();
      // macOS WebKit's native Tab mode skips buttons; Option-Tab includes them.
      // https://support.apple.com/guide/safari/cpsh003/mac
      // Traverse with real keys, without assuming an exact number of controls.
      const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
      for (let step = 0; step < 20 && !await analyst.evaluate(element => element === document.activeElement); step++) {
        await page.keyboard.press(nextControl);
      }
      await expect(analyst).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    await page.keyboard.press('Control+Shift+t');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: scenario.language === 'ar' ? 'إغلاق' : 'Close', exact: true });
    const submit = dialog.locator('button[type="submit"]');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('#task-title')).toBeFocused();
    await expect(dialog.locator('label[for="task-title"]')).toHaveText(scenario.language === 'ar' ? 'العنوان' : 'Title');
    const panel = await dialog.locator(':scope > div').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(scenario.width);
    const durations = await submit.evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value)));
    expect(durations.every(seconds => seconds <= 0.00002)).toBe(true);
    const title = `Keyboard acceptance ${scenario.name}`;
    await page.keyboard.insertText(title);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+2');
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.keyboard.press('Control+Shift+t');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
