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

    const toggle = page.locator('[data-tour="header"]').getByRole('button', { name: common['screenshare.toggle'], exact: true });
    const off = common['screenshare.off'];
    const strict = common['screenshare.showUpTo'].replace('{{level}}', 'TLP:AMBER+STRICT');
    const menu = page.getByRole('button', { name: off, exact: true }).locator('..');
    // First with nothing selected, then with the longest label selected: its check mark sits beside a
    // label that wraps and must keep its 12 px width.
    for (const selected of [off, strict]) {
      if (selected === strict) {
        await menu.getByRole('button', { name: strict, exact: true }).click();
        await expect(menu).toBeHidden();
      }
      await toggle.click();
      await expect(menu.getByRole('button', { name: strict, exact: true })).toBeVisible();
      const { spills, checks } = await menu.evaluate(element => {
        const box = element.getBoundingClientRect();
        const rows = [...element.querySelectorAll('button > span')].map(label => {
          const text = label.getBoundingClientRect();
          return { label: label.textContent, spill: Math.max(text.right - box.right, box.left - text.left) };
        });
        return {
          spills: [...rows, { label: 'menu', spill: Math.max(box.right - window.innerWidth, -box.left) },
            { label: 'page', spill: document.documentElement.scrollWidth - window.innerWidth }],
          checks: [...element.querySelectorAll('button > svg')].map(icon => ({
            label: icon.parentElement?.textContent, width: Math.round(icon.getBoundingClientRect().width * 10) / 10,
          })),
        };
      });
      expect(spills).toHaveLength(8);
      expect(spills.filter(row => row.spill > 1)).toEqual([]);
      expect(checks).toEqual([{ label: selected, width: 12 }]);
    }
  });
}
