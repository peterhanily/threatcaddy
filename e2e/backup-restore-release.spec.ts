import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';

// Keep the recovery fixture's network boundary at the browser context. Real
// service-worker installation and offline recovery are covered by offline.spec.
test.use({ serviceWorkers: 'block' });

type BackupRow = Record<string, unknown> & { id: string };
type BackupRows = Record<string, BackupRow[]>;
const folderId = 'release-backup-case';
const noteId = 'release-backup-note';
const tableNames = ['folders', 'notes', 'tasks', 'tags', 'timelines', 'timelineEvents', 'standaloneIOCs', 'evidenceItems', 'whiteboards', 'chatThreads', 'noteTemplates'];

function recoveryFixture(imageData: string): BackupRows {
  const now = Date.now();
  const common = { folderId, tags: ['fictional-recovery'], clsLevel: 'TLP:AMBER', archived: false, trashed: false, createdAt: now, updatedAt: now };
  const note = { ...common, id: noteId, title: 'Fictional recovery note', content: '# Synthetic observation\n\nExact Unicode content: 中文 日本語 한국어.\n\nNo real investigation data.', pinned: true, linkedTaskIds: ['release-backup-task'], linkedTimelineEventIds: ['release-backup-event'] };
  return {
    folders: [
      { id: folderId, name: 'Fictional Recovery Case', order: 0, status: 'active', clsLevel: 'TLP:AMBER', timelineId: 'release-backup-timeline', tags: ['fictional-recovery'], createdAt: now, updatedAt: now },
      { id: 'release-backup-other-case', name: 'Fictional Separate Case', order: 1, status: 'active', clsLevel: 'TLP:RED', createdAt: now, updatedAt: now },
    ],
    notes: [
      note,
      { ...common, id: 'release-backup-product', title: 'Fictional reviewed product', content: '# Reviewed product\n\n**Classification:** TLP:AMBER\n\nSynthetic conclusion.', tags: ['product', 'draft-product', 'baseline:release-backup-baseline'], pinned: false },
      { ...note, id: 'release-backup-archived', title: 'Fictional archived note', archived: true },
      { ...note, id: 'release-backup-trash', title: 'Fictional trashed note', trashed: true, trashedAt: now },
      { ...common, id: 'release-backup-other-note', folderId: 'release-backup-other-case', title: 'Fictional separate note', content: 'Separate ownership remains intact.', clsLevel: 'TLP:RED', pinned: false },
    ],
    tasks: [{ ...common, id: 'release-backup-task', title: 'Fictional follow-up', description: 'Review the synthetic source.', completed: false, priority: 'high', status: 'in-progress', order: 0, linkedNoteIds: [noteId] }],
    tags: [{ id: 'release-backup-tag', name: 'fictional-recovery', color: '#336699' }],
    timelines: [{ id: 'release-backup-timeline', name: 'Fictional recovery timeline', order: 0, createdAt: now, updatedAt: now }],
    timelineEvents: [{ ...common, id: 'release-backup-event', title: 'Fictional observation', description: 'Synthetic event details.', timestamp: now, timelineId: 'release-backup-timeline', eventType: 'other', source: 'Fictional fixture', confidence: 'medium', linkedNoteIds: [noteId], linkedTaskIds: ['release-backup-task'], linkedIOCIds: ['release-backup-ioc'], mitreAttackIds: [], assets: ['fictional-host'], starred: true }],
    standaloneIOCs: [{ ...common, id: 'release-backup-ioc', type: 'domain', value: 'recovery-fixture.example', confidence: 'low', analystNotes: 'Synthetic indicator only.', linkedNoteIds: [noteId], linkedEvidenceIds: ['release-backup-evidence'] }],
    evidenceItems: [{ ...common, id: 'release-backup-evidence', title: 'Fictional raster evidence', fileName: 'synthetic-pixel.png', fileType: 'image', mimeType: 'image/png', size: imageData.length, imageData, imageDataMimeType: 'image/png', imageWidth: 1, imageHeight: 1, content: 'Synthetic image description.', extractionStatus: 'extracted', importedAt: now, chunkIndex: 0, chunkCount: 1, linkedIOCIds: ['release-backup-ioc'] }],
    whiteboards: [{ ...common, id: 'release-backup-whiteboard', name: 'Fictional analysis board', order: 0, elements: JSON.stringify([{ id: 'synthetic-rectangle', type: 'rectangle', x: 10, y: 20, width: 80, height: 40, angle: 0, strokeColor: '#336699', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: now, link: null, locked: false }]), appState: JSON.stringify({ zoom: { value: 1 }, scrollX: 0, scrollY: 0 }), files: '{}' }],
    chatThreads: [{ ...common, id: 'release-backup-chat', title: 'Fictional classified discussion', clsLevel: 'TLP:RED', messages: [{ id: 'release-backup-message', role: 'user', content: 'Synthetic local transcript. No provider request.', createdAt: now }], provider: 'local', model: 'fictional-offline-model', mode: 'plan', source: 'user', contextSummary: 'Synthetic context summary.' }],
    noteTemplates: [{ id: 'release-backup-baseline', name: 'Fictional recovery baseline', content: '# Report\n\n## Findings\n\nLiteral {{ placeholder }}', category: 'Product Baseline', tags: ['product-baseline'], clsLevel: 'TLP:AMBER', source: 'user', productBaseline: { schemaVersion: 1, kind: 'markdown', productType: 'custom', renderer: 'markdown', visualFidelity: 'structural', importedAt: now }, createdAt: now, updatedAt: now }],
  };
}

async function readRows(page: Page): Promise<BackupRows> {
  return page.evaluate(names => new Promise<BackupRows>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(names, 'readonly');
      const rows: BackupRows = {};
      transaction.oncomplete = () => { database.close(); resolve(rows); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      for (const name of names) {
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => { rows[name] = read.result; };
      }
    };
  }), tableNames);
}

async function isolateNetwork(page: Page) {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') await route.continue();
    else { externalRequests.push(`${url.origin}${url.pathname}`); await route.abort(); }
  });
  return { externalRequests, pageErrors };
}

async function loadBackup(page: Page, filePath: string, mode: 'Replace All' | 'Merge') {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load Backup', exact: true }).click(),
  ]);
  await chooser.setFiles(filePath);
  const confirmation = page.getByRole('dialog', { name: 'Load Backup', exact: true });
  await confirmation.getByRole('button', { name: mode, exact: true }).click();
  await expect(confirmation).toHaveCount(0);
}

function assertRecovered(actual: BackupRows, expected: BackupRows) {
  for (const table of tableNames) {
    expect(actual[table].map(row => row.id).sort(), `${table} identities`).toEqual(expected[table].map(row => row.id).sort());
    for (const record of expected[table]) expect(actual[table].find(row => row.id === record.id), `${table}:${record.id}`).toMatchObject(record);
  }
}

for (const mode of ['Replace All', 'Merge'] as const) {
  test(`JSON backup ${mode} restores representative records into a genuinely fresh browser context`, async ({ page, browser }) => {
    test.setTimeout(60_000);
    const sourceNetwork = await isolateNetwork(page);
    await goToApp(page);
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Synthetic raster fixture unavailable');
      context.fillStyle = '#336699'; context.fillRect(0, 0, 1, 1);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const fixture = recoveryFixture(imageData);
    // Seed only disposable test data. Exercise the actual UI export/import,
    // including its sanitizers, browser download/file picker and hook hydration.
    await page.evaluate(rows => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('ThreatCaddyDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(Object.keys(rows), 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
        for (const [table, records] of Object.entries(rows)) for (const row of records) transaction.objectStore(table).put(row);
      };
    }), fixture);
    await page.evaluate(() => localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false, editorMode: 'edit' })));
    await page.reload();
    await expect(page.locator('[data-tour="header"]')).toBeVisible();
    const original = await readRows(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save Backup', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^threatcaddy-backup-.*\.json$/);
    const filePath = await download.path();
    if (!filePath) throw new Error('Backup download did not produce a file');
    const backup = JSON.parse(await readFile(filePath, 'utf8')) as BackupRows & { version: number };
    expect(backup.version).toBe(1);
    assertRecovered(backup, original);

    // No storageState is carried over. A separate browser context has its own
    // cookies, localStorage, sessionStorage and IndexedDB for the same origin.
    const destination = await browser.newContext({ baseURL: new URL(page.url()).origin, serviceWorkers: 'block' });
    try {
      expect(await destination.storageState()).toEqual({ cookies: [], origins: [] });
      const restored = await destination.newPage();
      const restoredNetwork = await isolateNetwork(restored);
      await goToApp(restored);
      const before = await readRows(restored);
      for (const table of tableNames) {
        expect(before[table].some(row => fixture[table].some(source => source.id === row.id)), `${table} starts without source identities`).toBe(false);
      }
      for (const table of ['folders', 'notes', 'tasks', 'evidenceItems', 'chatThreads', 'noteTemplates']) expect(before[table]).toEqual([]);

      await loadBackup(restored, filePath, mode);
      await expect.poll(async () => (await readRows(restored)).notes.length).toBe(original.notes.length);
      assertRecovered(await readRows(restored), original);
      await restored.evaluate(({ folderId, noteId }) => {
        localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false, editorMode: 'edit' }));
        sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'notes', selectedFolderId: folderId, selectedNoteId: noteId }));
      }, { folderId, noteId });
      await restored.reload();
      await expect(restored.getByPlaceholder('Note title...')).toHaveValue('Fictional recovery note');
      await expect(restored.getByPlaceholder('Start writing in markdown...')).toHaveValue(fixture.notes[0].content as string);
      await expect(restored.getByRole('combobox', { name: 'Classification level', exact: true })).toHaveValue('TLP:AMBER');
      assertRecovered(await readRows(restored), original);
      if (mode === 'Merge') {
        await loadBackup(restored, filePath, mode);
        await expect(restored.getByText(/Merge complete:/)).toBeVisible();
        assertRecovered(await readRows(restored), original);
      }
      // Restoring elsewhere must not rewrite the exporting browser's data.
      assertRecovered(await readRows(page), original);
      expect(restoredNetwork.externalRequests).toEqual([]);
      expect(restoredNetwork.pageErrors).toEqual([]);
    } finally {
      await destination.close();
    }
    expect(sourceNetwork.externalRequests).toEqual([]);
    expect(sourceNetwork.pageErrors).toEqual([]);
  });
}
