import { test, expect, type Locator, type Page } from '@playwright/test';
import { goToApp } from './fixtures';

async function expectWithinViewport(page: Page, control: Locator, minimumSize = 0) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  // Firefox can report 44 CSS pixels as 43.999992 after layout transforms.
  expect(box!.width + 0.01).toBeGreaterThanOrEqual(minimumSize);
  expect(box!.height + 0.01).toBeGreaterThanOrEqual(minimumSize);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    <= window.innerWidth + 1)).toBe(true);
}

async function readWhiteboardName(page: Page) {
  return page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const request = window.indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('whiteboards', 'readonly');
      const read = transaction.objectStore('whiteboards').get('mobile-board');
      read.onsuccess = () => resolve(read.result?.name);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

for (const scenario of [
  { width: 320, language: 'en' },
  { width: 390, language: 'en' },
  { width: 320, language: 'ar' },
  { width: 768, language: 'en' },
]) {
  test(`${scenario.width}px ${scenario.language}: mobile actions, long names, menus and drafts remain usable`, async ({ page }) => {
    await goToApp(page);
    const narrow = scenario.width < 768;
    const folderName = 'Fictional-investigation-with-a-deliberately-long-unbroken-name-for-layout-checks-'.repeat(3);
    const boardName = 'Fictional whiteboard with a deliberately long analyst title '.repeat(3);
    await page.evaluate(async ({ folderName, boardName, language }) => {
      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open('ThreatCaddyDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['folders', 'whiteboards'], 'readwrite');
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
          transaction.objectStore('folders').put({
            id: 'mobile-folder', name: folderName, order: 0, status: 'active', clsLevel: 'TLP:CLEAR',
            createdAt: now, updatedAt: now,
          });
          transaction.objectStore('whiteboards').put({
            id: 'mobile-board', folderId: 'mobile-folder', name: boardName, elements: '[]', files: '{}',
            appState: JSON.stringify({ zoom: { value: 1 }, scrollX: 0, scrollY: 0 }),
            tags: [], clsLevel: 'TLP:CLEAR', order: 0, archived: false, trashed: false,
            createdAt: now, updatedAt: now,
          });
        };
      });
      localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false }));
      sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'whiteboard', selectedFolderId: 'mobile-folder' }));
    }, { folderName, boardName, language: scenario.language });
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', scenario.language);
    await expect(page.locator('html')).toHaveAttribute('dir', scenario.language === 'ar' ? 'rtl' : 'ltr');
    if (narrow) await page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true }).click();
    const main = page.locator('#main-content');
    await main.getByRole('heading', { name: boardName.trim(), exact: true }).click();
    const title = main.getByRole('textbox', { name: 'Whiteboard name', exact: true });
    await expect(title).toHaveValue(boardName);

    const header = page.locator('[data-tour="header"]');
    const create = header.locator('[data-tour="new-note"]');
    const saveBackup = header.getByRole('button', { name: scenario.language === 'ar' ? 'حفظ نسخة احتياطية' : 'Save Backup', exact: true });
    const loadBackup = header.getByRole('button', { name: scenario.language === 'ar' ? 'تحميل نسخة احتياطية' : 'Load Backup', exact: true });
    const screenshare = header.getByRole('button', { name: 'Toggle screenshare mode', exact: true });
    for (const control of [create, saveBackup, loadBackup, screenshare]) {
      await expectWithinViewport(page, control, narrow ? 44 : 0);
    }
    for (const name of ['Back to list', 'Assign to investigation', 'Export as PNG', 'Delete whiteboard']) {
      await expectWithinViewport(page, main.getByRole('button', { name, exact: true }), narrow ? 44 : 0);
    }
    await expectWithinViewport(page, main.getByRole('combobox', { name: 'Classification level', exact: true }), narrow ? 44 : 0);
    await expectWithinViewport(page, title, narrow ? 44 : 0);
    await expectNoHorizontalOverflow(page);

    await create.focus();
    await create.press('Enter');
    const createMenu = page.getByRole('menu');
    await expectWithinViewport(page, createMenu);
    for (const item of await createMenu.getByRole('menuitem').all()) {
      await expectWithinViewport(page, item, narrow ? 44 : 0);
    }
    await page.keyboard.press('Escape');
    await expect(createMenu).toHaveCount(0);
    await expect(create).toBeFocused();

    const assign = main.getByRole('button', { name: 'Assign to investigation', exact: true });
    await assign.click();
    const assignments = main.getByRole('group', { name: 'Investigation assignment', exact: true });
    await expectWithinViewport(page, assignments);
    await expectWithinViewport(page, assignments.getByRole('button', { name: folderName, exact: true }), narrow ? 44 : 0);
    await assignments.getByRole('button', { name: folderName, exact: true }).click();
    await expect(assign).toHaveAttribute('aria-expanded', 'false');

    // The active label consumes extra width at the 768px desktop breakpoint.
    await screenshare.click();
    const off = page.getByRole('button', { name: 'Off', exact: true });
    await expectWithinViewport(page, off.locator('..'));
    await page.getByRole('button', { name: 'Show up to TLP:CLEAR', exact: true }).click();
    for (const control of [create, saveBackup, loadBackup, screenshare]) await expectWithinViewport(page, control, narrow ? 44 : 0);
    await expectNoHorizontalOverflow(page);
    await screenshare.click();
    await off.click();

    const changedTitle = `${boardName}Edited before resizing`;
    await title.fill(changedTitle);
    if (narrow) {
      await page.setViewportSize({ width: scenario.width === 320 ? 390 : 320, height: 844 });
      await expect(title).toHaveValue(changedTitle);
      await page.setViewportSize({ width: scenario.width, height: 844 });
    }
    await expect.poll(() => readWhiteboardName(page)).toBe(changedTitle);
    await page.reload();
    // Both analyst mode and the selected board should survive data hydration.
    // The freshly mounted editor must read the persisted title, not lose selection.
    await expect(header).toBeVisible();
    await expect(main.getByRole('textbox', { name: 'Whiteboard name', exact: true })).toHaveValue(changedTitle);
    await expectNoHorizontalOverflow(page);
  });
}
