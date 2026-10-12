import { test, expect } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';

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

test('quick-link keyboard actions open only their own dialogs and preserve cancelled changes', async ({ page, baseURL, browserName }) => {
  if (!baseURL) throw new Error('Expected the isolated app origin');
  const origin = new URL(baseURL).origin;
  await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const link = {
    id: 'keyboard-reference', title: 'Fictional keyboard reference',
    url: 'https://reference.example/ordinary', description: 'Synthetic reference only.', icon: '🔎',
  };
  await page.addInitScript(link => {
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({
      language: 'en', tiAutoExtractEnabled: false, quickLinks: [link],
    }));
    const state = window as typeof window & { __quickLinkOpenCalls: { url: string; target?: string; features?: string }[] };
    state.__quickLinkOpenCalls = [];
    window.open = (url, target, features) => {
      state.__quickLinkOpenCalls.push({ url: String(url), target, features });
      return null;
    };
  }, link);
  const opened = () => page.evaluate(() => (window as typeof window & { __quickLinkOpenCalls: unknown[] }).__quickLinkOpenCalls);
  const storedLinks = () => page.evaluate(() => JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}').quickLinks);
  await goToApp(page);
  await navigateToView(page, 'Dashboard');
  const main = page.locator('#main-content');
  const launch = main.getByRole('button', { name: link.title, exact: true });
  const edit = main.getByRole('button', { name: `Edit ${link.title}`, exact: true });
  const remove = main.getByRole('button', { name: `Delete ${link.title}`, exact: true });
  await expect(launch).toBeVisible();
  expect(await launch.evaluate(element => element.tagName)).toBe('BUTTON');
  expect(await edit.evaluate(element => element.parentElement?.closest('button, [role="button"]'))).toBeNull();
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';

  for (const key of ['Enter', 'Space']) {
    // Tab between the three independent native controls before activating each.
    await launch.focus();
    await page.keyboard.press(nextControl);
    await expect(edit).toBeFocused();
    await page.keyboard.press(key);
    const editDialog = page.getByRole('dialog', { name: 'Edit Link', exact: true });
    await expect(editDialog).toBeVisible();
    await editDialog.getByPlaceholder('e.g. VirusTotal').fill('Unsaved keyboard edit');
    await editDialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press(key);
    await expect(editDialog).toHaveCount(0);
    expect(await storedLinks()).toEqual([link]);
    expect(await opened()).toEqual([]);

    await edit.focus();
    await page.keyboard.press(nextControl);
    await expect(remove).toBeFocused();
    await page.keyboard.press(key);
    const deleteDialog = page.getByRole('dialog', { name: 'Delete Link', exact: true });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press(key);
    await expect(deleteDialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(main.getByRole('heading', { name: link.title, exact: true })).toBeVisible();
    expect(await storedLinks()).toEqual([link]);
    expect(await opened()).toEqual([]);
  }

  // Real hit testing also proves the full-card launch target does not cover
  // either independent action button.
  for (const { control, title } of [{ control: edit, title: 'Edit Link' }, { control: remove, title: 'Delete Link' }]) {
    await control.click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await storedLinks()).toEqual([link]);
    expect(await opened()).toEqual([]);
  }

  for (const [index, key] of ['Enter', 'Space'].entries()) {
    await launch.focus();
    await page.keyboard.press(key);
    expect(await opened()).toEqual(Array.from({ length: index + 1 }, () => ({ url: link.url, target: '_blank', features: 'noopener,noreferrer' })));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await launch.click();
  expect(await opened()).toEqual(Array.from({ length: 3 }, () => ({ url: link.url, target: '_blank', features: 'noopener,noreferrer' })));
  expect(await storedLinks()).toEqual([link]);
});
