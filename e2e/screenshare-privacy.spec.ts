import { test, expect, type Page } from '@playwright/test';
import { goToApp, navigateToView, openSearch } from './fixtures';

type FixtureRows = Record<string, Array<Record<string, unknown>>>;

/** Seed only fictional data into the normal, production-built app database. */
async function seedInvestigationFixtures(page: Page, rows: FixtureRows, navigation: Record<string, string> = { view: 'investigations' }) {
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
        for (const [table, records] of Object.entries(rows)) {
          for (const record of records) transaction.objectStore(table).put(record);
        }
      };
    });
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify(navigation));
  }, { rows, navigation });
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
}

async function setScreenshareLevel(page: Page, level: string | null) {
  await page.getByRole('button', { name: 'Toggle screenshare mode', exact: true }).click();
  await page.locator('[data-tour="screenshare"]').getByRole('button', {
    name: level ? `Show up to ${level}` : 'Off', exact: true,
  }).click();
}

async function expectNoPrivateLabels(page: Page, labels: string[]) {
  // Screensharing is a visual/accessibility boundary, not a memory wipe. Draft
  // editors may remain mounted inside hidden, inert trees to retain unsaved work.
  // Check visible tooltips and values as well as the actual accessibility tree.
  await expect.poll(async () => {
    const body = page.locator('body');
    const rendered = await body.evaluate(body => (body as HTMLElement).innerText + '\n' + Array.from(
      body.querySelectorAll('[title], [aria-label], [alt], input, textarea'),
    ).filter(element => {
      const style = window.getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).map(element => [
      element.getAttribute('title'), element.getAttribute('aria-label'), element.getAttribute('alt'),
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '',
    ].join('\n')).join('\n'));
    const accessible = await body.ariaSnapshot();
    return labels.filter(label => (rendered + '\n' + accessible).includes(label));
  }).toEqual([]);
}

const now = Date.now();
const folder = (id: string, name: string, clsLevel = 'TLP:CLEAR') => ({
  id, name, clsLevel, order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now,
});
const note = (id: string, folderId: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, folderId, title, content: 'Fictional investigation content.', tags: [], pinned: false,
  archived: false, trashed: false, createdAt: now, updatedAt: now, ...extra,
});

test('screensharing hides the selected restricted investigation and restores its draft when disabled', async ({ page }) => {
  const folderName = 'Private Juniper Investigation';
  const draftTitle = 'Private Juniper draft';
  const draftContent = 'Private Juniper draft written immediately before screensharing.';
  await seedInvestigationFixtures(page, {
    folders: [folder('private-juniper', folderName, 'TLP:RED')],
    // An unclassified child must inherit the parent investigation restriction.
    notes: [note('juniper-note', 'private-juniper', 'Initial Juniper note')],
  }, { view: 'notes', selectedFolderId: 'private-juniper', selectedNoteId: 'juniper-note' });

  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Initial Juniper note');
  await page.getByPlaceholder('Note title...').fill(draftTitle);
  await page.getByPlaceholder('Start writing in markdown...').fill(draftContent);
  await setScreenshareLevel(page, 'TLP:CLEAR');

  await expect(page.getByPlaceholder('Note title...')).not.toBeVisible();
  await expectNoPrivateLabels(page, [folderName, 'Initial Juniper note', draftTitle, draftContent]);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[inert], [hidden]'))).toBe(false);
  await expect(page.getByRole('button', { name: 'Toggle screenshare mode', exact: true })).toBeVisible();

  await setScreenshareLevel(page, null);
  await expect(page.getByPlaceholder('Note title...')).toHaveValue(draftTitle);
  await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue(draftContent);
  await expect(page.locator('[data-tour="search"]')).toHaveAttribute('title', new RegExp(folderName));

  // The transient Saved badge may have expired while the editor was hidden.
  // Check persistence directly, then verify a fresh page reads the same draft.
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('notes', 'readonly');
      const read = transaction.objectStore('notes').get('juniper-note');
      read.onsuccess = () => resolve({ title: read.result?.title, content: read.result?.content });
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }))).toEqual({ title: draftTitle, content: draftContent });
  await page.reload();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue(draftTitle);
  await expect(page.getByPlaceholder('Start writing in markdown...')).toHaveValue(draftContent);
});

test('hub, dashboard and search exclude folders restricted by metadata, unknown labels or archived children', async ({ page }) => {
  const privateLabels = [
    'Private Rowan folder', 'Private Hazel unknown', 'Private Cedar archive',
    'Private Willow evidence', 'Fixture restricted note', 'Fixture archived note',
    'Private Willow attachment',
  ];
  await seedInvestigationFixtures(page, {
    folders: [
      folder('public', 'Public Aspen investigation'),
      folder('red-folder', privateLabels[0], 'TLP:RED'),
      folder('unknown-folder', privateLabels[1], 'CUSTOM:RESTRICTED'),
      folder('archived-child', privateLabels[2]),
      folder('evidence-child', privateLabels[3]),
    ],
    notes: [
      note('public-note', 'public', 'Fixture public note'),
      note('private-note', 'red-folder', privateLabels[4]),
      note('archived-note', 'archived-child', privateLabels[5], { clsLevel: 'TLP:RED', archived: true }),
    ],
    evidenceItems: [{
      id: 'restricted-evidence', folderId: 'evidence-child', title: privateLabels[6],
      fileName: 'fictional-evidence.txt', fileType: 'text', mimeType: 'text/plain',
      size: 0, content: '', extractionStatus: 'extracted', importedAt: now,
      chunkIndex: 0, chunkCount: 1, tags: [], clsLevel: 'TLP:RED',
      trashed: false, archived: false, createdAt: now, updatedAt: now,
    }],
  });
  await expect(page.getByText(privateLabels[0], { exact: true }).first()).toBeVisible();
  await expect(page.getByText(privateLabels[1], { exact: true }).first()).toBeVisible();

  await setScreenshareLevel(page, 'TLP:CLEAR');
  await expect(page.getByText('Public Aspen investigation', { exact: true }).first()).toBeVisible();
  await expectNoPrivateLabels(page, privateLabels);

  await navigateToView(page, 'Dashboard');
  await expect(page.getByText('Open Investigations', { exact: true }).locator('..').locator('.tabular-nums')).toHaveText('1');
  await expect(page.getByText('Notes Created (Week)', { exact: true }).locator('..').locator('.tabular-nums')).toHaveText('1');
  await expectNoPrivateLabels(page, privateLabels);
  await openSearch(page);
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await search.getByTitle('Search all investigations', { exact: true }).click();
  await expect(search.getByRole('button', { name: 'Public Aspen investigation', exact: true })).toBeVisible();
  await expectNoPrivateLabels(page, privateLabels);
  await search.getByRole('button', { name: 'All Investigations', exact: true }).click();
  await search.locator('input').first().fill('Fixture');
  await expect(search.getByText('Fixture public note', { exact: true })).toBeVisible();
  await expectNoPrivateLabels(page, privateLabels);
  await page.keyboard.press('Escape');

  // Raising the threshold restores known classifications, not unknown labels.
  await setScreenshareLevel(page, 'TLP:RED');
  await navigateToView(page, 'Investigations');
  await expect(page.getByText(privateLabels[0], { exact: true }).first()).toBeVisible();
  await expectNoPrivateLabels(page, [privateLabels[1]]);
  await setScreenshareLevel(page, null);
  await expect(page.getByText(privateLabels[1], { exact: true }).first()).toBeVisible();
});
