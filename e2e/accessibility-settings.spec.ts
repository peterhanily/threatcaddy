import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { enableEncryption, readRows, seedRows, workspacePassword } from './client-lifecycle-fixtures';
import { goToApp } from './fixtures';

const catalog = (language: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../public/locales/${language}/${namespace}.json`, import.meta.url), 'utf8'));
test.use({ serviceWorkers: 'block' });

async function withinWidth(page: Page, element: Locator) {
  await expect(element).toBeVisible();
  const bounds = await element.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.context().route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

for (const { width, language } of [
  { width: 320, language: 'en' }, { width: 390, language: 'en' },
  { width: 320, language: 'ar' }, { width: 390, language: 'ar' },
]) test(`${width}px ${language}: empty Exec guidance and keyboard Settings tabs remain usable`, async ({ page, browserName }, testInfo) => {
  const settings = catalog(language, 'settings');
  const common = catalog(language, 'common');
  const exec = catalog(language, 'exec');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(language => {
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false }));
  }, language);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  await expect(page.getByRole('heading', { name: exec['dashboard.emptyTitle'], exact: true })).toBeVisible();
  const theme = page.getByRole('button', { name: exec['dashboard.switchToLight'], exact: true });
  await withinWidth(page, theme);
  await withinWidth(page, page.getByRole('button', { name: exec['dashboard.emptyAction'], exact: true }));
  await page.getByRole('button', { name: exec['dashboard.emptyAction'], exact: true }).click();
  const header = page.locator('[data-tour="header"]');
  await expect(header).toBeVisible();
  await header.getByRole('button', { name: common['header.toggleMenu'], exact: true }).click();
  await page.getByRole('button', { name: common['sidebar.settings'], exact: true }).click();
  const tabs = page.getByRole('tablist', { name: settings.title, exact: true });
  const allTabs = tabs.getByRole('tab');
  const first = allTabs.first();
  const last = allTabs.last();
  await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
  await withinWidth(page, tabs);
  await first.focus();
  await page.keyboard.press(language === 'ar' ? 'ArrowLeft' : 'ArrowRight');
  await expect(allTabs.nth(1)).toBeFocused();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(allTabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await withinWidth(page, last);
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-tab-shortcuts');
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(nextControl);
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
  const displayName = page.getByRole('textbox', { name: settings['general.displayName'], exact: true });
  await displayName.fill('Fictional keyboard analyst');
  await expect(displayName).toHaveValue('Fictional keyboard analyst');
  await withinWidth(page, displayName);
  const switches = page.getByRole('switch');
  expect(await switches.count()).toBeGreaterThan(0);
  for (const toggle of await switches.all()) {
    await expect(toggle).toHaveAccessibleName(/.+/);
    await expect(toggle).toHaveAttribute('aria-checked', /^(true|false)$/);
  }
  for (const key of ['appearance', 'ai', 'data', 'integrations']) {
    await page.getByRole('tab', { name: settings[`tabs.${key}`], exact: true }).click();
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', `settings-panel-${key}`);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1)).toBe(true);
    for (const select of await page.getByRole('tabpanel').getByRole('combobox').all()) await withinWidth(page, select);
  }
  await page.screenshot({ path: testInfo.outputPath(`settings-${width}-${language}.png`) });
  expect(errors).toEqual([]);
});

test('a real encrypted workspace starts with its saved RTL locale before unlock and retains data through reset cancellation', async ({ page }, testInfo) => {
  const encryption = catalog('ar', 'encryption');
  const common = catalog('ar', 'common');
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { notes: [{ id: 'rtl-locked-fixture', title: 'Fictional retained note', content: 'Not a real investigation', tags: [], archived: false, trashed: false, pinned: false, createdAt: now, updatedAt: now }] });
  await page.reload();
  await enableEncryption(page);
  const encrypted = await readRows(page, ['notes']);
  expect(encrypted.notes[0].content).toMatchObject({ __enc: 1 });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ ...settings, language: 'ar-EG' }));
    sessionStorage.removeItem('threatcaddy-session-cache');
    sessionStorage.setItem('tc-analyst-mode', '1');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: encryption['passphrase.unlockThreatCaddy'], exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-tour="header"]')).toHaveCount(0);
  const show = page.getByRole('button', { name: encryption['passphrase.showPassphrase'], exact: true });
  await withinWidth(page, show);
  await show.click();
  await expect(page.getByRole('textbox', { name: encryption['passphrase.enterPassphrase'], exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: encryption['passphrase.hidePassphrase'], exact: true }).click();
  await page.getByRole('button', { name: encryption['passphrase.forgotPassphrase'], exact: true }).click();
  const confirmation = page.getByRole('textbox', { name: encryption['passphrase.confirmDelete'].replace('{{confirmation}}', 'DELETE'), exact: true });
  await withinWidth(page, confirmation);
  await confirmation.fill('DELETE');
  await expect(page.getByRole('button', { name: encryption['passphrase.deleteAllData'], exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('rtl-reset-cancel.png') });
  await page.getByRole('button', { name: common.cancel, exact: true }).click();
  expect(await readRows(page, ['notes'])).toEqual(encrypted);
  await page.getByLabel(encryption['passphrase.enterPassphrase'], { exact: true }).fill(workspacePassword);
  await page.getByRole('button', { name: encryption['passphrase.unlock'], exact: true }).click();
  await expect(page.getByRole('heading', { name: encryption['passphrase.unlockThreatCaddy'], exact: true })).toHaveCount(0);
  const header = page.locator('[data-tour="header"]');
  await expect(header).toBeVisible();
  await header.getByRole('button', { name: common['header.toggleMenu'], exact: true }).click();
  await page.locator('[data-tour="sidebar-nav"]').getByRole('button').filter({ has: page.getByText(common['sidebar.notes'], { exact: true }) }).click();
  await expect(page.getByText('Fictional retained note', { exact: true }).first()).toBeVisible();
  expect(await readRows(page, ['notes'])).toEqual(encrypted);
});

test('filed Exec entity controls expose names and selection through real keyboard navigation', async ({ page, browserName }, testInfo) => {
  const exec = catalog('en', 'exec');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await goToApp(page);
  const now = Date.now();
  const folderId = 'filed-keyboard-case';
  await seedRows(page, {
    folders: [{ id: folderId, name: 'Fictional navigation case', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    notes: [1, 2].map(index => ({ id: `filed-keyboard-note-${index}`, folderId, title: `Fictional filed note ${index}`,
      content: 'Synthetic local content', tags: [], archived: false, trashed: false, pinned: false, createdAt: now, updatedAt: now })),
    tasks: [{ id: 'filed-keyboard-task', folderId, title: 'Fictional filed task', description: '', status: 'todo', priority: 'medium',
      order: 0, tags: [], archived: false, trashed: false, createdAt: now, updatedAt: now }],
    whiteboards: [{ id: 'filed-keyboard-board', folderId, name: 'Fictional filed board', elements: '[]', appState: '{}',
      order: 0, trashed: false, createdAt: now, updatedAt: now }],
    standaloneIOCs: [{ id: 'filed-keyboard-ioc', folderId, type: 'domain', value: 'fixture.example', confidence: 'low',
      tags: [], trashed: false, createdAt: now, updatedAt: now }],
  });
  const tables = ['folders', 'notes', 'tasks', 'whiteboards', 'standaloneIOCs'];
  const saved = await readRows(page, tables);
  await page.evaluate(() => {
    sessionStorage.removeItem('tc-analyst-mode');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /Fictional navigation case/ }).click();
  const controls = [
    { key: 'notes', count: 2, heading: 'Notes', content: 'Fictional filed note 1' },
    { key: 'tasks', count: 1, heading: 'Tasks', content: 'Fictional filed task' },
    { key: 'events', count: 0, heading: 'Events' },
    { key: 'boards', count: 1, heading: 'Whiteboards', content: 'Fictional filed board' },
    { key: 'iocs', count: 1, heading: 'IOCs', content: 'fixture.example' },
  ].map(control => ({ ...control, name: `${exec[`investigations.${control.key}`]}: ${control.count}` }));
  for (const control of controls) {
    const button = page.getByRole('button', { name: control.name, exact: true, pressed: false });
    await withinWidth(page, button);
    await expect(button).toHaveAttribute('type', 'button');
  }
  // The clicked investigation card unmounts. Firefox continues after its old
  // position and exits to browser chrome instead of wrapping to the top. Anchor
  // on a preceding header control, then enter and traverse the bar with real keys.
  const headerAnchor = page.getByRole('button', { name: exec['dashboard.switchToAnalyst'], exact: true });
  await headerAnchor.focus();
  await expect(headerAnchor).toBeFocused();
  // macOS Safari includes buttons with Option-Tab.
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  const first = page.getByRole('button', { name: controls[0].name, exact: true });
  const focusPath: Array<{ tag: string | undefined; name: string | null | undefined }> = [];
  for (let step = 0; step < 10 && !await first.evaluate(element => element === document.activeElement); step++) {
    await page.keyboard.press(nextControl);
    focusPath.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName,
      name: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 100) })));
  }
  await testInfo.attach('filed-entity-keyboard-entry', { body: JSON.stringify(focusPath), contentType: 'application/json' });
  await expect(first).toBeFocused();
  for (const [index, control] of controls.entries()) {
    if (index > 0) await page.keyboard.press(nextControl);
    await expect(page.getByRole('button', { name: control.name, exact: true })).toBeFocused();
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter');
    await expect(page.getByRole('heading', { name: control.heading, exact: true })).toBeVisible();
    if (control.content) await expect(page.getByText(control.content, { exact: true })).toBeVisible();
    for (const candidate of controls) {
      await expect(page.getByRole('button', { name: candidate.name, exact: true, pressed: candidate.key === control.key })).toBeVisible();
    }
  }
  await page.screenshot({ path: testInfo.outputPath('filed-exec-keyboard-navigation.png') });
  expect(await readRows(page, tables)).toEqual(saved);
  expect(errors).toEqual([]);
});

test('French Composer controls and validation preserve the exact analyst-authored text on save', async ({ page }) => {
  const products = catalog('fr', 'products');
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, {
    folders: [{ id: 'localized-composer', name: 'Fictional unchanged investigation', order: 0, status: 'active',
      clsLevel: 'TLP:CLEAR', tags: [], createdAt: now, updatedAt: now }],
    notes: [{ id: 'localized-original', folderId: 'localized-composer', title: 'Original analyst title',
      content: 'Original analyst source {{literal}} — 中文.', tags: [], archived: false, trashed: false, pinned: false,
      clsLevel: 'TLP:CLEAR', createdAt: now, updatedAt: now }],
  });
  const original = (await readRows(page, ['notes'])).notes[0];
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'fr', tiAutoExtractEnabled: false }));
    const navigation = { view: 'products', selectedFolderId: 'localized-composer' };
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify(navigation));
    history.replaceState({ __bn: true, ...navigation }, '');
  });
  await page.reload();
  await page.getByRole('button', { name: products['composer.open'], exact: true }).click();
  const composer = page.getByRole('dialog', { name: products['composer.title'], exact: true });
  const title = composer.getByRole('textbox', { name: products['composer.productTitle'], exact: true });
  const content = composer.getByRole('textbox', { name: products['composer.sectionContent'].replace('{{number}}', '1'), exact: true });
  const analystText = 'Exact analyst draft {{literal}} — café, العربية, 中文.';
  await title.fill('Fictional retained product title');
  await content.fill(analystText);
  await composer.getByRole('button', { name: products['composer.stageSelected'], exact: true }).click();
  await expect(composer.getByRole('alert')).toHaveText(products['composer.validation.selectSource']);
  await expect(content).toHaveValue(analystText);
  await composer.getByRole('button', { name: products['composer.save'], exact: true }).click();
  await expect(composer).toHaveCount(0);
  const notes = (await readRows(page, ['notes'])).notes;
  expect(notes.find(note => note.id === 'localized-original')).toEqual(original);
  const saved = notes.filter(note => note.title === 'Fictional retained product title');
  expect(saved).toHaveLength(1);
  expect(saved[0].content).toContain(analystText);
  expect(saved[0].folderId).toBe('localized-composer');
});
