import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goToApp } from './fixtures';

type FixtureRows = Record<string, Array<Record<string, unknown>>>;
type StoredNote = { id: string; title: string; content: string; folderId?: string; tags: string[]; clsLevel?: string };

const folderId = 'composer-investigation';
const baselineName = 'Fictional review baseline';
const baselineContent = 'Fictional baseline preamble.\n\n## Findings\nFirst finding placeholder.\n\n```text\n## Literal code heading\n```\n\n## Findings\nSecond finding placeholder.';

async function seedComposerFixtures(page: Page, selectedFolderId?: string, initialView: 'products' | 'notes' = 'products') {
  await goToApp(page);
  const now = Date.now();
  const note = (id: string, folder: string, title: string, content: string, extra = {}) => ({
    id, folderId: folder, title, content, tags: [], pinned: false, archived: false, trashed: false,
    clsLevel: 'TLP:CLEAR', createdAt: now, updatedAt: now, ...extra,
  });
  const rows: FixtureRows = {
    folders: [
      { id: folderId, name: 'Fictional Composer Investigation', order: 0, status: 'active', clsLevel: 'TLP:CLEAR', createdAt: now, updatedAt: now },
      { id: 'other-composer-investigation', name: 'Fictional Other Investigation', order: 1, status: 'active', clsLevel: 'TLP:RED', createdAt: now, updatedAt: now },
    ],
    notes: [
      note('composer-note', folderId, 'Selected fictional note', 'Selected note detail.\n\n![Fictional remote image](https://composer-fixture.invalid/no-fetch.png)'),
      note('unselected-composer-note', folderId, 'Unselected fictional note', 'UNSELECTED_NOTE_DETAIL'),
      note('archived-composer-note', folderId, 'Archived fictional note', 'ARCHIVED_NOTE_DETAIL', { archived: true }),
      note('other-composer-note', 'other-composer-investigation', 'Other investigation private note', 'OTHER_INVESTIGATION_DETAIL', { clsLevel: 'TLP:RED' }),
    ],
    evidenceItems: [{
      id: 'composer-evidence', folderId, title: 'Selected fictional evidence', fileName: 'fictional-source.txt',
      fileType: 'text', mimeType: 'text/plain', size: 23, content: 'Selected evidence detail.',
      extractionStatus: 'extracted', importedAt: now, chunkIndex: 0, chunkCount: 1, tags: [],
      clsLevel: 'TLP:CLEAR', archived: false, trashed: false, createdAt: now, updatedAt: now,
    }],
    standaloneIOCs: [{
      id: 'composer-ioc', folderId, type: 'domain', value: 'fictional-indicator.example', confidence: 'low',
      analystNotes: 'Selected indicator detail.', tags: [], clsLevel: 'TLP:CLEAR',
      archived: false, trashed: false, createdAt: now, updatedAt: now,
    }],
    noteTemplates: [{
      id: 'composer-baseline', name: baselineName, content: baselineContent, category: 'Product Baseline',
      source: 'user', tags: ['product-baseline'], clsLevel: 'TLP:CLEAR', createdAt: now, updatedAt: now,
      productBaseline: { schemaVersion: 1, kind: 'markdown', productType: 'analysis-report', importedAt: now, renderer: 'markdown', visualFidelity: 'structural' },
    }],
  };
  await page.evaluate(async ({ rows, selectedFolderId, initialView }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('ThreatCaddyDB');
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
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false, editorMode: 'edit' }));
    const navigation = {
      view: initialView, selectedFolderId, selectedNoteId: initialView === 'notes' ? 'composer-note' : undefined,
    };
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify(navigation));
    // Keep the native history entry consistent with this seeded route. The
    // app's initial entry otherwise contains only `view: notes`, no selection.
    history.replaceState({ __bn: true, ...navigation }, '');
  }, { rows, selectedFolderId, initialView });
  await page.reload();
  if (initialView === 'products') await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  else await expect(page.getByPlaceholder('Note title...')).toHaveValue('Selected fictional note');
}

async function readNotes(page: Page): Promise<StoredNote[]> {
  return page.evaluate(() => new Promise<StoredNote[]>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('notes', 'readonly');
      const read = transaction.objectStore('notes').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function recordExternalRequests(page: Page) {
  const unexpected: string[] = [];
  await page.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') await route.continue();
    else {
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort();
    }
  });
  return unexpected;
}

async function assertReadableMarkdown(preview: Locator) {
  const samples = await preview.locator('h1, h2, p, li, th, td, a, code, code span').evaluateAll(elements => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    // Canvas resolves rgb/oklch CSS colours in all three engines and composites
    // translucent backgrounds, instead of assuming a particular app theme.
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = () => {
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    return elements.map(element => {
      const ancestors: Element[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestors.push(ancestor);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 1, 1);
      for (const ancestor of ancestors.reverse()) {
        context.fillStyle = getComputedStyle(ancestor).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const backgroundLuminance = luminance();
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const foregroundLuminance = luminance();
      return {
        tag: element.tagName,
        text: element.textContent?.slice(0, 80),
        contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      };
    });
  });
  expect(samples.some(sample => sample.tag === 'TH')).toBe(true);
  expect(samples.some(sample => sample.tag === 'CODE')).toBe(true);
  for (const sample of samples) {
    expect(sample.contrast, `${sample.tag}: ${sample.text}`).toBeGreaterThanOrEqual(4.5);
  }
}

test('compose explicit local sources, review and round-trip a normal product note without remote requests', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const externalRequests = await recordExternalRequests(page);
  await seedComposerFixtures(page, folderId);
  const originalNotes = await readNotes(page);
  await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  await expect(composer).toBeVisible();
  await composer.getByRole('combobox', { name: 'Baseline', exact: true }).selectOption({ label: baselineName });
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue('Fictional baseline preamble.');
  await expect(composer.getByRole('textbox', { name: 'Section 2 heading', exact: true })).toHaveValue('Findings');
  await expect(composer.getByRole('textbox', { name: 'Section 3 heading', exact: true })).toHaveValue('Findings');
  await expect(composer.getByRole('textbox', { name: 'Section 2 content', exact: true })).toHaveValue('First finding placeholder.\n\n```text\n## Literal code heading\n```');
  await expect(composer.getByRole('textbox', { name: 'Section 4 heading', exact: true })).toHaveCount(0);

  const title = 'Fictional Reviewed Product';
  await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
  const section = composer.getByRole('textbox', { name: 'Section 2 content', exact: true });
  await section.fill('Analyst-reviewed finding.\n\n![Local preview must not fetch this](https://composer-fixture.invalid/edited-image.png)');
  await composer.getByRole('combobox', { name: 'Stage into section', exact: true }).selectOption({ label: '2. Findings' });
  const sourceType = composer.getByRole('combobox', { name: 'Source type', exact: true });
  await sourceType.selectOption('notes');
  await expect(composer.getByRole('checkbox', { name: 'Include note: Other investigation private note', exact: true })).toHaveCount(0);
  await expect(composer.getByRole('checkbox', { name: 'Include note: Archived fictional note', exact: true })).toHaveCount(0);
  await expect(composer.getByRole('checkbox', { name: 'Include note: Unselected fictional note', exact: true })).not.toBeChecked();
  await composer.getByRole('checkbox', { name: 'Include note: Selected fictional note', exact: true }).check();
  await composer.getByRole('button', { name: 'Stage selected sources', exact: true }).click();
  await sourceType.selectOption('evidence');
  await composer.getByRole('checkbox', { name: 'Include evidence: Selected fictional evidence', exact: true }).check();
  await composer.getByRole('button', { name: 'Stage selected sources', exact: true }).click();
  await sourceType.selectOption('iocs');
  await composer.getByRole('checkbox', { name: 'Include IOC: fictional-indicator.example', exact: true }).check();
  await composer.getByRole('button', { name: 'Stage selected sources', exact: true }).click();
  const sectionText = await section.inputValue();
  for (const included of ['Analyst-reviewed finding.', 'Selected note detail.', 'Selected evidence detail.', 'fictional-indicator.example']) expect(sectionText).toContain(included);
  for (const excluded of ['UNSELECTED_NOTE_DETAIL', 'ARCHIVED_NOTE_DETAIL', 'OTHER_INVESTIGATION_DETAIL']) expect(sectionText).not.toContain(excluded);

  await composer.getByRole('button', { name: 'Preview draft', exact: true }).click();
  await expect(composer.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(composer.locator('img, video, audio, iframe')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await composer.getByRole('button', { name: 'Save draft product', exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect.poll(async () => (await readNotes(page)).filter(note => note.title === title).length).toBe(1);
  const saved = (await readNotes(page)).find(note => note.title === title)!;
  expect(saved.folderId).toBe(folderId);
  expect(saved.clsLevel).toBe('TLP:CLEAR');
  expect(saved.tags).toEqual(expect.arrayContaining(['product', 'draft-product', 'baseline:composer-baseline']));
  expect(saved.content).toContain(sectionText);
  expect((await readNotes(page)).filter(note => note.id !== saved.id)).toEqual(originalNotes);

  const productPreview = page.getByRole('dialog', { name: title, exact: true });
  await expect(productPreview.getByRole('heading', { name: title, exact: true }).last()).toBeVisible();
  await expect(productPreview.locator('img, video, audio, iframe')).toHaveCount(0);
  const [markdown] = await Promise.all([
    page.waitForEvent('download'),
    productPreview.getByRole('button', { name: 'Markdown', exact: true }).click(),
  ]);
  const markdownPath = await markdown.path();
  expect(markdownPath).not.toBeNull();
  expect(readFileSync(markdownPath!, 'utf8')).toBe(saved.content);
  await productPreview.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Preview Product', exact: true }).click();
  await expect(productPreview).toContainText('Analyst-reviewed finding.');
  await productPreview.getByRole('button', { name: 'Close', exact: true }).click();
  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Backup', exact: true }).click(),
  ]);
  const backupPath = await backup.path();
  expect(backupPath).not.toBeNull();
  const backedUpNotes = JSON.parse(readFileSync(backupPath!, 'utf8')).notes as StoredNote[];
  expect(backedUpNotes.find(note => note.id === saved.id)).toMatchObject(saved);

  // Restore into a separate, empty browser profile; no existing data is removed.
  const restoredContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const restored = await restoredContext.newPage();
    const restoredRequests = await recordExternalRequests(restored);
    await goToApp(restored);
    const [chooser] = await Promise.all([
      restored.waitForEvent('filechooser'),
      restored.getByRole('button', { name: 'Load Backup', exact: true }).click(),
    ]);
    await chooser.setFiles(backupPath!);
    await restored.getByRole('dialog', { name: 'Load Backup', exact: true }).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect.poll(async () => (await readNotes(restored)).find(note => note.id === saved.id)?.content).toBe(saved.content);
    expect((await readNotes(restored)).find(note => note.id === saved.id)).toMatchObject(saved);
    await restored.reload();
    expect((await readNotes(restored)).find(note => note.id === saved.id)).toMatchObject(saved);
    expect(restoredRequests).toEqual([]);
  } finally {
    await restoredContext.close();
  }
  expect(externalRequests).toEqual([]);
});

test('manual draft cancellation preserves sources and composer requires a local non-sharing context', async ({ page }) => {
  const externalRequests = await recordExternalRequests(page);
  await seedComposerFixtures(page);
  const compose = page.getByRole('button', { name: 'Compose draft', exact: true });
  await expect(compose).toBeDisabled();
  await page.evaluate(folderId => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'products', selectedFolderId: folderId })), folderId);
  await page.reload();
  await expect(compose).toBeEnabled();
  const originalNotes = await readNotes(page);
  // WebKit does not focus buttons on pointer clicks. Exercise actual keyboard
  // invocation so returning focus to the initiating control is meaningful.
  await compose.focus();
  await compose.press('Enter');
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  await composer.getByRole('combobox', { name: 'Baseline', exact: true }).selectOption({ label: 'Manual outline' });
  await expect(composer.getByRole('textbox', { name: 'Section 1 heading', exact: true })).toHaveValue('Draft');
  const draftText = 'Fictional unsaved manual analysis.';
  await composer.getByRole('textbox', { name: 'Section 1 content', exact: true }).fill(draftText);
  await composer.getByRole('button', { name: 'Stage selected sources', exact: true }).click();
  await expect(composer.getByRole('alert')).toContainText('Select at least one source');
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(draftText);
  await composer.getByRole('button', { name: 'Add section', exact: true }).click();
  await composer.getByRole('textbox', { name: 'Section 2 heading', exact: true }).fill('Fictional second section');
  await composer.getByRole('button', { name: 'Move section 2 up', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Section 2 content', exact: true })).toHaveValue(draftText);
  await composer.getByRole('button', { name: 'Remove section 1', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(draftText);
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved product?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(draftText);
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await discard.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(compose).toBeFocused();
  expect(await readNotes(page)).toEqual(originalNotes);

  await page.getByRole('button', { name: 'Toggle screenshare mode', exact: true }).click();
  await page.getByRole('button', { name: 'Show up to TLP:CLEAR', exact: true }).click();
  await expect(compose).toBeDisabled();
  await expect(page.getByText('Fictional Other Investigation', { exact: true })).not.toBeVisible();
  await expect(page.getByText('Other investigation private note', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Toggle screenshare mode', exact: true }).click();
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(compose).toBeEnabled();
  expect(await readNotes(page)).toEqual(originalNotes);
  expect(externalRequests).toEqual([]);
});

test('a source reclassified in another tab cannot create an under-classified product', async ({ page, context }) => {
  const externalRequests = await recordExternalRequests(page);
  await seedComposerFixtures(page, folderId);
  await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  const title = 'Fictional cross-tab classification review';
  const analystText = 'Preserve this unsaved analysis when source markings change.';
  await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
  const section = composer.getByRole('textbox', { name: 'Section 1 content', exact: true });
  await section.fill(analystText);
  await composer.getByRole('checkbox', { name: 'Include note: Selected fictional note', exact: true }).check();
  await composer.getByRole('button', { name: 'Stage selected sources', exact: true }).click();
  const originalSection = await section.inputValue();

  // Use a real second application tab and its normal note editor. The composer
  // must validate stored rows, not rely on the opening tab's stale React state.
  const sourceTab = await context.newPage();
  const sourceRequests = await recordExternalRequests(sourceTab);
  await goToApp(sourceTab);
  await sourceTab.evaluate(folderId => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({
    view: 'notes', selectedFolderId: folderId, selectedNoteId: 'composer-note',
  })), folderId);
  await sourceTab.reload();
  await expect(sourceTab.getByPlaceholder('Note title...')).toHaveValue('Selected fictional note');
  await sourceTab.getByRole('combobox', { name: 'Classification level', exact: true }).selectOption('TLP:RED');
  await expect.poll(async () => (await readNotes(sourceTab)).find(note => note.id === 'composer-note')?.clsLevel).toBe('TLP:RED');
  await page.bringToFront();
  await composer.getByRole('button', { name: 'Save draft product', exact: true }).click();
  await expect(composer.getByRole('alert')).toContainText(/classification|classified|sources changed/i);
  await expect(section).toHaveValue(originalSection);
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  expect((await readNotes(page)).filter(note => note.tags.includes('product'))).toHaveLength(0);
  expect(externalRequests).toEqual([]);
  expect(sourceRequests).toEqual([]);
  await sourceTab.close();
});

test('browser Back and Forward retain an unsaved product without writing a note', async ({ page }) => {
  await seedComposerFixtures(page, folderId, 'notes');
  const originalNotes = await readNotes(page);
  await page.locator('nav[aria-label="Views"]').getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  const title = 'Fictional retained history draft';
  const content = 'Keep this complete unsaved analysis through browser history.';
  await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
  await composer.getByRole('textbox', { name: 'Section 1 content', exact: true }).fill(content);
  await page.goBack();
  await expect(composer).not.toBeVisible();
  await expect(page.getByPlaceholder('Note title...')).toBeVisible();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Selected fictional note');
  const resume = page.getByRole('button', { name: 'Resume draft', exact: true });
  await expect(resume).toBeVisible();
  await page.goForward();
  await expect.poll(async () => await composer.isVisible() || await resume.isVisible()).toBe(true);
  if (!await composer.isVisible()) await resume.click();
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(content);

  // A nested discard dialog must suspend too: it must not trap the next view,
  // and explicitly resuming must recover both the confirmation and draft.
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved product?', exact: true });
  await expect(discard).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(content);
  expect(await readNotes(page)).toEqual(originalNotes);
});

test('automatic mobile layout changes retain a complete unsaved product', async ({ page }) => {
  await page.setViewportSize({ width: 1835, height: 1000 });
  await seedComposerFixtures(page, folderId);
  expect(await page.evaluate(() => localStorage.getItem('tc-analyst-mode'))).toBeNull();
  const originalNotes = await readNotes(page);
  await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  const title = 'Fictional responsive draft';
  const content = 'Keep this complete unsaved analysis while rotating and resizing.';
  await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
  await composer.getByRole('textbox', { name: 'Section 1 content', exact: true }).fill(content);
  await composer.getByRole('button', { name: 'Add section', exact: true }).click();
  await composer.getByRole('textbox', { name: 'Section 2 heading', exact: true }).fill('Retained second section');
  await composer.getByRole('textbox', { name: 'Section 2 content', exact: true }).fill('A second independent analyst conclusion.');
  await page.setViewportSize({ width: 390, height: 844 });
  // Let the responsive layout effect commit before returning to desktop. An
  // immediate second resize can otherwise skip the very unmount being tested.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(composer).toBeVisible();
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  await expect(composer.getByRole('textbox', { name: 'Section 2 content', exact: true })).toHaveValue('A second independent analyst conclusion.');
  await page.setViewportSize({ width: 1280, height: 1000 });
  const resume = page.getByRole('button', { name: 'Resume draft', exact: true });
  await expect.poll(async () => await composer.isVisible() || await resume.isVisible()).toBe(true);
  if (!await composer.isVisible()) await resume.click();
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(content);
  await expect(composer.getByRole('textbox', { name: 'Section 2 heading', exact: true })).toHaveValue('Retained second section');
  await expect(composer.getByRole('textbox', { name: 'Section 2 content', exact: true })).toHaveValue('A second independent analyst conclusion.');
  expect(await readNotes(page)).toEqual(originalNotes);
  expect(await page.evaluate(() => localStorage.getItem('tc-analyst-mode'))).toBeNull();
});

test('same-document share links wait until an unsaved product is explicitly discarded', async ({ page }) => {
  const externalRequests = await recordExternalRequests(page);
  await seedComposerFixtures(page, folderId);
  const originalNotes = await readNotes(page);
  await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
  const title = 'Fictional draft before opening a share';
  const content = 'Do not replace this unsaved analyst text with the share receiver.';
  await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
  await composer.getByRole('textbox', { name: 'Section 1 content', exact: true }).fill(content);
  // A harmless invalid encoded share is enough to trigger normal hash routing.
  // It contains no source data and cannot save/import anything into this profile.
  await page.evaluate(() => { window.location.hash = 'share=AA'; });
  await expect(page).toHaveURL(/#share=AA$/);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(composer).toBeVisible();
  await expect(composer.getByRole('textbox', { name: 'Product title', exact: true })).toHaveValue(title);
  await expect(composer.getByRole('textbox', { name: 'Section 1 content', exact: true })).toHaveValue(content);
  await expect(page.getByText('SHARED', { exact: true })).toHaveCount(0);
  expect(await readNotes(page)).toEqual(originalNotes);

  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard unsaved product?', exact: true })
    .getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByText('SHARED', { exact: true })).toBeVisible();
  await expect(composer).toHaveCount(0);
  expect(await readNotes(page)).toEqual(originalNotes);
  expect(externalRequests).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`composer, saved product and printable report have readable Markdown in ${theme} mode`, async ({ page, context }) => {
    await seedComposerFixtures(page, folderId);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await page.getByRole('button', { name: 'Compose draft', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Compose product', exact: true });
    const title = `Fictional ${theme} report contrast`;
    const content = [
      'Analyst body text with `inline code` and a [reference](https://contrast-fixture.invalid/source).',
      '> A quoted analyst observation.',
      '- An analyst list item.',
      '| Finding | Assessment |\n| --- | --- |\n| Synthetic observation | Reviewed |',
      '```text\nA readable code block\n```',
      '```javascript\n// Synthetic documentation example\nconst status = "reviewed";\n```',
    ].join('\n\n');
    await composer.getByRole('textbox', { name: 'Product title', exact: true }).fill(title);
    await composer.getByRole('textbox', { name: 'Section 1 content', exact: true }).fill(content);
    await composer.getByRole('button', { name: 'Preview draft', exact: true }).click();
    const draftPreview = composer.getByRole('region', { name: 'Draft preview', exact: true });
    await assertReadableMarkdown(draftPreview);
    await expect(draftPreview).not.toHaveClass(/product-document/);
    await composer.getByRole('button', { name: 'Save draft product', exact: true }).click();
    const savedPreview = page.getByRole('dialog', { name: title, exact: true });
    await expect(savedPreview).toBeVisible();
    const paper = savedPreview.locator('.product-document');
    await assertReadableMarkdown(paper);
    await expect(paper).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    // Inspect the actual print document without invoking the operating system's
    // print dialog; print styling must remain independent of the dark app theme.
    await context.addInitScript(() => { window.print = () => {}; });
    const [printPreview] = await Promise.all([
      context.waitForEvent('page'),
      savedPreview.getByRole('button', { name: 'Print', exact: true }).click(),
    ]);
    await expect(printPreview.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await printPreview.emulateMedia({ media: 'print' });
    await assertReadableMarkdown(printPreview.locator('body'));
    await printPreview.close();
  });
}
