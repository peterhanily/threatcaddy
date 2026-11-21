import { test, expect, type Page } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';

// Fictional records only, seeded into the production-built app's own database.
const now = Date.now();
const folder = (id: string, name: string, clsLevel = 'TLP:CLEAR') => ({ id, name, clsLevel, order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now });
const identity = (id: string, folderId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, folderId, type: 'person', name, aliases: [], details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now, ...extra,
});
const event = (id: string, folderId: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, folderId, title, timestamp: now, eventType: 'other', source: '', confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
  mitreAttackIds: [], assets: [], tags: [], starred: false, timelineId: 'tl', trashed: false, archived: false, createdAt: now, updatedAt: now, ...extra,
});

async function seed(page: Page, rows: Record<string, Array<Record<string, unknown>>>, navigation: Record<string, string> = { view: 'identities' }) {
  await goToApp(page);
  await page.evaluate(async ({ rows, navigation }) => {
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open('ThreatCaddyDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(Object.keys(rows), 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
        for (const [table, records] of Object.entries(rows)) for (const record of records) transaction.objectStore(table).put(record);
      };
    });
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify(navigation));
  }, { rows, navigation });
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
}

const list = (page: Page) => page.getByRole('region', { name: 'Identities', exact: true });
const card = (page: Page, name: string) => page.getByRole('article', { name });
const row = (page: Page, name: string) => list(page).getByRole('button', { name: new RegExp(`^${name}`) });

test('adds, renames, connects and charts identities, keeping private details hidden until shown', async ({ page }) => {
  await seed(page, { folders: [folder('case', 'Fictional BEC case')] }, { view: 'identities', selectedFolderId: 'case' });

  await page.locator('header[data-tour="header"]').getByRole('button', { name: /Create new/i }).click();
  await page.getByRole('menuitem', { name: 'Identity' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add an identity' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Halvorsen Shipping');
  await dialog.getByRole('combobox', { name: 'Type' }).fill('Organization');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(card(page, 'Halvorsen Shipping')).toBeVisible();

  for (const [name, title] of [['Lee Park', 'Finance director'], ['Dana Okafor', 'Accounts payable']]) {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Add an identity' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await dialog.getByRole('textbox', { name: 'Job title' }).fill(title);
    await dialog.getByRole('combobox', { name: 'Works at' }).selectOption({ label: 'Halvorsen Shipping' });
    await dialog.getByRole('combobox', { name: 'Detail' }).fill('Phone');
    await dialog.getByRole('textbox', { name: 'Value' }).fill('+44 7700 900123');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(card(page, name)).toBeVisible();
  }

  // A phone number starts out private: masked until Show.
  const dana = card(page, 'Dana Okafor');
  await expect(dana.getByText('Accounts payable at Halvorsen Shipping')).toBeVisible();
  await expect(dana.getByText('+44 7700 900123')).toHaveCount(0);
  await dana.getByRole('button', { name: 'Show private phone' }).click();
  await expect(dana.getByText('+44 7700 900123')).toBeVisible();

  // Dana reports to Lee: Lee's card reads it from the other side.
  await dana.getByRole('button', { name: 'Add a connection' }).click();
  await dana.getByRole('combobox', { name: 'Dana Okafor…' }).fill('reports to');
  await dana.getByRole('combobox', { name: '…whom or what' }).selectOption({ label: 'Lee Park · Person' });
  await dana.getByRole('button', { name: 'Add', exact: true }).click();
  await row(page, 'Lee Park').click();
  await expect(card(page, 'Lee Park').getByText('manages')).toBeVisible();

  // Renaming keeps the old name as another name.
  await card(page, 'Lee Park').getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit Lee Park' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Lee Park-Hansen');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Lee Park-Hansen').getByText('Also known as Lee Park')).toBeVisible();

  await page.getByRole('navigation', { name: 'Identities views' }).getByRole('button', { name: 'Org charts' }).click();
  await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveValue(/.+/);
  await expect(page.getByRole('button', { name: /Lee Park-Hansen/ })).toBeVisible();
  // Lee heads the chart, and Dana's card sits under Lee.
  await expect(page.getByRole('region', { name: "Dana Okafor's team" })).toBeVisible();

  // The sidebar counts this investigation's identities.
  await expect(page.locator('nav[aria-label="Views"]').getByRole('button', { name: /Identities\s*3/ })).toBeVisible();
});

test('merges after confirmation, and moves to the Trash and back', async ({ page }) => {
  await seed(page, {
    folders: [folder('case', 'Fictional BEC case')],
    identities: [identity('dana', 'case', 'Dana Okafor', { aliases: ['D. Okafor'] }), identity('dupe', 'case', 'Dana O.', {
      details: [{ id: 'email', label: 'Email', value: 'dana@halvorsen.example' }] })],
  }, { view: 'identities', selectedFolderId: 'case' });

  await row(page, 'Dana Okafor').click();
  await card(page, 'Dana Okafor').getByRole('button', { name: 'Edit' }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit Dana Okafor' });
  await dialog.getByRole('combobox', { name: /Merge it into this one/ }).selectOption('dupe');
  await dialog.getByRole('button', { name: 'Merge' }).click();
  await page.getByRole('dialog', { name: 'Merge identities?' }).getByRole('button', { name: 'Merge' }).click();
  await expect(row(page, 'Dana O\\.')).toHaveCount(0);
  await expect(card(page, 'Dana Okafor').getByText('dana@halvorsen.example')).toBeVisible();
  await expect(card(page, 'Dana Okafor').getByText(/Also known as D\. Okafor, Dana O\./)).toBeVisible();

  await card(page, 'Dana Okafor').getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit Dana Okafor' });
  await dialog.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('dialog', { name: 'Move Dana Okafor to the trash?' }).getByRole('button', { name: 'Move to trash' }).click();
  await expect(list(page).getByText('No identities yet.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trashed = page.getByText('Dana Okafor (Person)');
  await expect(trashed).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(trashed).toHaveCount(0);
  await navigateToView(page, 'Identities');
  await expect(row(page, 'Dana Okafor')).toBeVisible();
});

test('adds a name found on the timeline, remembers an ignored one, and finds identities in search without private details', async ({ page }) => {
  await seed(page, {
    folders: [folder('case', 'Fictional BEC case')],
    timelines: [{ id: 'tl', name: 'Main', order: 0, createdAt: now, updatedAt: now }],
    timelineEvents: [event('e1', 'case', 'Payment approved', { actor: 'Lee Park', assets: ['fin-db01'] })],
    identities: [identity('dana', 'case', 'Dana Okafor', { details: [{ id: 'email', label: 'Email', value: 'dana@halvorsen.example' },
      { id: 'phone', label: 'Phone', value: '+44 7700 900999', private: true }] })],
  }, { view: 'identities', selectedFolderId: 'case' });

  const found = page.getByRole('region', { name: /^Not yet in Identities/ });
  await found.getByRole('button', { name: /fin-db01/ }).click();
  await page.getByRole('button', { name: /Add as a new identity/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add “fin-db01”' });
  await expect(dialog.getByRole('combobox', { name: 'Type' })).toHaveValue('System');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(card(page, 'fin-db01').getByText('Hostname')).toBeVisible();
  await expect(found.getByRole('button', { name: /fin-db01/ })).toHaveCount(0);

  await found.getByRole('button', { name: /Lee Park/ }).click();
  await page.getByRole('button', { name: 'Ignore on this device' }).click();
  await expect(page.getByRole('region', { name: /^Not yet in Identities/ })).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'Dana Okafor')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Not yet in Identities/ })).toHaveCount(0);

  await navigateToView(page, 'Notes');
  await page.locator('[data-tour="search"]').click();
  const search = page.getByRole('dialog').getByRole('textbox').first();
  await search.fill('7700 900999');
  await expect(page.getByRole('dialog').getByText('Dana Okafor')).toHaveCount(0);
  await search.fill('halvorsen.example');
  await page.getByRole('dialog').getByText('Dana Okafor').first().click();
  await expect(card(page, 'Dana Okafor')).toBeVisible();
});

test('hides identities above the screenshare level, and never reveals a private detail while sharing', async ({ page }) => {
  await seed(page, {
    folders: [folder('open', 'Fictional open case', 'TLP:CLEAR'), folder('red', 'Fictional restricted case', 'TLP:RED')],
    identities: [
      identity('visible', 'open', 'Visible Person', { clsLevel: 'TLP:CLEAR', details: [{ id: 'p', label: 'Phone', value: '+1 555 0100', private: true }] }),
      identity('hidden', 'red', 'Restricted Person', { clsLevel: 'TLP:RED' }),
    ],
  });
  await expect(row(page, 'Restricted Person')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle screenshare mode', exact: true }).click();
  await page.locator('[data-tour="screenshare"]').getByRole('button', { name: 'Show up to TLP:GREEN', exact: true }).click();
  await expect(row(page, 'Restricted Person')).toHaveCount(0);
  await row(page, 'Visible Person').click();
  await expect(card(page, 'Visible Person').getByRole('button', { name: 'Show private phone' })).toBeDisabled();
  await expect(page.getByText('+1 555 0100')).toHaveCount(0);
});

test('works from the keyboard alone', async ({ page }) => {
  await seed(page, { folders: [folder('case', 'Fictional BEC case')], identities: [identity('lee', 'case', 'Lee Park')] },
    { view: 'identities', selectedFolderId: 'case' });
  await page.getByRole('button', { name: 'Add', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add an identity' });
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await page.keyboard.type('Dana Okafor');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Dana Okafor')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await row(page, 'Lee Park').focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 'Lee Park')).toBeVisible();
  await card(page, 'Lee Park').getByRole('button', { name: 'Add a detail' }).focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 'Lee Park').getByRole('combobox', { name: 'Label' })).toBeFocused();
  await page.keyboard.type('Email');
  await page.keyboard.press('Tab');
  await page.keyboard.type('lee@halvorsen.example');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Lee Park').getByText('lee@halvorsen.example')).toBeVisible();
});

test('switches between one investigation and all of them, and follows "Also in another investigation"', async ({ page }) => {
  await seed(page, {
    folders: [folder('case', 'Fictional BEC case'), folder('other', 'Fictional second case')],
    identities: [identity('dana', 'case', 'Dana Okafor', { details: [{ id: 'e', label: 'Email', value: 'dana@halvorsen.example' }] }),
      identity('dana2', 'other', 'Dana O.', { details: [{ id: 'e2', label: 'Email', value: 'dana@halvorsen.example' }] }),
      identity('lee', 'other', 'Lee Park')],
  }, { view: 'identities', selectedFolderId: 'case' });
  await expect(page.getByText('The people, organizations, systems and accounts in this investigation.')).toBeVisible();
  await expect(row(page, 'Lee Park')).toHaveCount(0);
  await row(page, 'Dana Okafor').click();
  // The same email in the other investigation: follow it there.
  await card(page, 'Dana Okafor').getByRole('button', { name: /Dana O\./ }).click();
  await expect(card(page, 'Dana O.')).toBeVisible();
  await expect(row(page, 'Lee Park')).toBeVisible();
  await expect(row(page, 'Dana Okafor')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.getByText('The people, organizations, systems and accounts in every investigation.')).toBeVisible();
  await expect(row(page, 'Dana Okafor')).toContainText('Fictional BEC case');
  await expect(row(page, 'Lee Park')).toContainText('Fictional second case');
});

test('deletes an identity for good only after confirmation, removing connections to it', async ({ page }) => {
  await seed(page, {
    folders: [folder('case', 'Fictional BEC case')],
    identities: [identity('lee', 'case', 'Lee Park'), identity('dana', 'case', 'Dana Okafor', { connections: [{ targetId: 'lee', label: 'reports to' }] })],
  }, { view: 'identities', selectedFolderId: 'case' });
  await row(page, 'Lee Park').click();
  await card(page, 'Lee Park').getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog', { name: 'Edit Lee Park' }).getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('dialog', { name: 'Move Lee Park to the trash?' }).getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).first().click();
  const confirm = page.getByRole('dialog', { name: 'Delete Lee Park for good?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Lee Park (Person)')).toBeVisible();
  await page.getByRole('button', { name: 'Delete permanently' }).first().click();
  await page.getByRole('dialog', { name: 'Delete Lee Park for good?' }).getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByText('Lee Park (Person)')).toHaveCount(0);
  await navigateToView(page, 'Identities');
  await row(page, 'Dana Okafor').click();
  await expect(card(page, 'Dana Okafor').getByText('reports to')).toHaveCount(0);
});

test('reaches the list with the Tab key and opens a profile with Enter', async ({ page, browserName }) => {
  // Like Safari on macOS, WebKit's Tab skips buttons by default; Alt+Tab reaches them (as the accessibility specs do).
  const nextControl = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await seed(page, { folders: [folder('case', 'Fictional BEC case')], identities: [identity('lee', 'case', 'Lee Park'), identity('ana', 'case', 'Ana Silva')] },
    { view: 'identities', selectedFolderId: 'case' });
  await list(page).getByRole('searchbox', { name: 'Search identities' }).focus();
  for (let presses = 0; presses < 12; presses++) {
    await page.keyboard.press(nextControl);
    if (await row(page, 'Lee Park').evaluate(element => element === document.activeElement)) break;
    if (await row(page, 'Ana Silva').evaluate(element => element === document.activeElement)) { await page.keyboard.press(nextControl); break; }
  }
  await expect(row(page, 'Lee Park')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card(page, 'Lee Park')).toBeVisible();
});
