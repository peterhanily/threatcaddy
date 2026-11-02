import { test, expect } from '@playwright/test';
import { goToApp, getSidebar } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

for (const width of [1280, 390]) {
  for (const kind of ['tag', 'timeline', 'whiteboard'] as const) {
    test(`${kind} sidebar deletion covers the viewport at ${width}px and cancel preserves data`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => { sessionStorage.setItem('tc-analyst-mode', '1'); });
      await goToApp(page);
      await seedRows(page, {
        tags: [{ id: 'dialog-tag', name: 'Dialog fixture', color: '#a855f7' }],
        timelines: [{ id: 'dialog-timeline', name: 'Dialog fixture', order: 0, createdAt: 1, updatedAt: 1 }],
        whiteboards: [{ id: 'dialog-board', name: 'Dialog fixture', elements: '[]', appState: '{}', tags: [],
          order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 }],
      });
      await page.reload();
      if (width < 768) await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
      const sidebar = width < 768 ? page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('navigation', { name: 'Main navigation' }) : getSidebar(page);
      if (kind !== 'tag') {
        await sidebar.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: kind === 'timeline' ? /^Timeline/ : /^Whiteboards/ }).click();
        if (width < 768) await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
      }
      const tables = ['tags', 'timelines', 'whiteboards'];
      const before = await readRows(page, tables);
      const remove = sidebar.getByRole('button', { name: `Delete ${kind} Dialog fixture`, exact: true });
      await remove.click();
      const title = `Delete ${kind.charAt(0).toUpperCase() + kind.slice(1)}`;
      const confirmation = page.getByRole('dialog', { name: title, exact: true });
      await expect(confirmation).toBeVisible();
      await expect.poll(() => confirmation.boundingBox()).toEqual({ x: 0, y: 0, width, height: 844 });
      const card = await confirmation.locator(':scope > div').boundingBox();
      expect(card).not.toBeNull();
      if (card) {
        expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThan(1);
        expect(Math.abs(card.y + card.height / 2 - 422)).toBeLessThan(1);
      }
      await page.screenshot({ path: testInfo.outputPath(`${kind}-dialog.png`) });
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(confirmation).not.toBeVisible();
      await expect(remove).toBeVisible();
      if (kind === 'tag') await expect(remove).toBeFocused();
      expect(await readRows(page, tables)).toEqual(before);
    });
  }
}
