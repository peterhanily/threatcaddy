import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { goToApp } from './fixtures';

const locale = (language: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../public/locales/${language}/${namespace}.json`, import.meta.url), 'utf8'));

// The longest translated menu labels (Turkish, Dutch, Indonesian) and a right-to-left language.
for (const language of ['tr', 'nl', 'id', 'ar']) for (const width of [1280, 390]) {
  test(`${width}px ${language}: each screenshare level label stays inside the menu`, async ({ page }) => {
    const common = locale(language, 'common');
    await goToApp(page);
    await page.evaluate(language => {
      localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false }));
    }, language);
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    if (width < 768) await page.getByRole('button', { name: locale(language, 'exec')['dashboard.switchToAnalyst'], exact: true }).click();

    await page.locator('[data-tour="header"]').getByRole('button', { name: common['screenshare.toggle'], exact: true }).click();
    const menu = page.getByRole('button', { name: common['screenshare.off'], exact: true }).locator('..');
    await expect(menu.getByRole('button', { name: common['screenshare.showUpTo'].replace('{{level}}', 'TLP:AMBER+STRICT'), exact: true })).toBeVisible();
    const spills = await menu.evaluate(element => {
      const box = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll('button > span')].map(label => {
        const text = label.getBoundingClientRect();
        return { label: label.textContent, spill: Math.max(text.right - box.right, box.left - text.left) };
      });
      return [...rows, { label: 'menu', spill: Math.max(box.right - window.innerWidth, -box.left) },
        { label: 'page', spill: document.documentElement.scrollWidth - window.innerWidth }];
    });
    expect(spills).toHaveLength(8);
    expect(spills.filter(row => row.spill > 1)).toEqual([]);
  });
}
