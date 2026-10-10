import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { BACKUP_TABLES } from '../src/lib/backup-tables';

// Keep the recovery fixture's network boundary at the browser context. Real
// service-worker installation and offline recovery are covered by offline.spec.
test.use({ serviceWorkers: 'block' });

type BackupRow = Record<string, unknown> & { id: string };
type BackupRows = Record<string, BackupRow[]>;
const folderId = 'release-backup-case';
const noteId = 'release-backup-note';
const tableNames = [...BACKUP_TABLES];
const fixtureTime = 1_740_000_000_000;
const backupPassword = 'fictional-backup-password-only';
const workspacePassword = 'fictional-workspace-password-only';
const whiteboardSVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" fill="#336699"/></svg>').toString('base64');

function recoveryFixture(imageData: string): BackupRows {
  const now = fixtureTime;
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
      // Keep this within the app's intentional 30-day trash-retention window.
      { ...note, id: 'release-backup-trash', title: 'Fictional trashed note', trashed: true, trashedAt: Date.now() },
      { ...common, id: 'release-backup-other-note', folderId: 'release-backup-other-case', title: 'Fictional separate note', content: 'Separate ownership remains intact.', clsLevel: 'TLP:RED', pinned: false },
    ],
    tasks: [{ ...common, id: 'release-backup-task', title: 'Fictional follow-up', description: 'Review the synthetic source.', completed: false, priority: 'high', status: 'in-progress', order: 0, linkedNoteIds: [noteId] }],
    tags: [{ id: 'release-backup-tag', name: 'fictional-recovery', color: '#336699' }],
    timelines: [{ id: 'release-backup-timeline', name: 'Fictional recovery timeline', order: 0, createdAt: now, updatedAt: now }],
    timelineEvents: [{ ...common, id: 'release-backup-event', title: 'Fictional observation', description: 'Synthetic event details.', timestamp: now, timelineId: 'release-backup-timeline', eventType: 'other', source: 'Fictional fixture', confidence: 'medium', linkedNoteIds: [noteId], linkedTaskIds: ['release-backup-task'], linkedIOCIds: ['release-backup-ioc'], mitreAttackIds: [], assets: ['fictional-host'], starred: true }],
    standaloneIOCs: [{ ...common, id: 'release-backup-ioc', type: 'domain', value: 'recovery-fixture.example', confidence: 'low', analystNotes: 'Synthetic indicator only.', linkedNoteIds: [noteId], linkedEvidenceIds: ['release-backup-evidence'] }],
    evidenceItems: [{ ...common, id: 'release-backup-evidence', title: 'Fictional raster evidence', fileName: 'synthetic-pixel.png', fileType: 'image', mimeType: 'image/png', size: imageData.length, imageData, imageDataMimeType: 'image/png', imageWidth: 1, imageHeight: 1, content: 'Synthetic image description.', extractionStatus: 'extracted', importedAt: now, chunkIndex: 0, chunkCount: 1, linkedIOCIds: ['release-backup-ioc'] }],
    whiteboards: [{ ...common, id: 'release-backup-whiteboard', name: 'Fictional analysis board', order: 0, elements: JSON.stringify([{ id: 'synthetic-rectangle', type: 'rectangle', x: 10, y: 20, width: 80, height: 40, angle: 0, strokeColor: '#336699', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: now, link: null, locked: false }]), appState: JSON.stringify({ zoom: { value: 1 }, scrollX: 0, scrollY: 0 }), files: JSON.stringify({
      'fictional-raster': { id: 'fictional-raster', mimeType: 'image/png', dataURL: `data:image/png;base64,${imageData}`, created: now, lastRetrieved: now, version: 2 },
      'fictional-vector': { id: 'fictional-vector', mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${whiteboardSVG}`, created: now, lastRetrieved: now, version: 3 },
    }) }],
    chatThreads: [{ ...common, id: 'release-backup-chat', title: 'Fictional classified discussion', clsLevel: 'TLP:RED', messages: [{ id: 'release-backup-message', role: 'user', content: 'Synthetic local transcript. No provider request.', createdAt: now }], provider: 'local', model: 'fictional-offline-model', mode: 'plan', source: 'user', contextSummary: 'Synthetic context summary.' }],
    noteTemplates: [{ id: 'release-backup-baseline', name: 'Fictional recovery baseline', content: '# Report\n\n## Findings\n\nLiteral {{ placeholder }}', category: 'Product Baseline', tags: ['product-baseline'], clsLevel: 'TLP:AMBER', source: 'user', productBaseline: { schemaVersion: 1, kind: 'markdown', productType: 'custom', renderer: 'markdown', visualFidelity: 'structural', importedAt: now }, createdAt: now, updatedAt: now }],
    playbookTemplates: [{ id: 'release-backup-playbook', name: 'Fictional review checklist', description: 'Stored template only; never executed.', investigationType: 'other', defaultTags: ['fictional-recovery'], defaultClsLevel: 'TLP:AMBER', steps: [{ order: 0, entityType: 'note', title: 'Synthetic findings', content: 'Literal {{input}}', noteTemplateId: 'release-backup-baseline' }], source: 'user', createdAt: now, updatedAt: now }],
    agentProfiles: [{ id: 'release-backup-profile', name: 'Fictional inactive observer', role: 'observer', systemPrompt: 'Synthetic saved profile, never started.', allowedTools: [], policy: { autoApproveReads: false, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 0 }, source: 'user', createdAt: now, updatedAt: now }],
    agentDeployments: [{ id: 'release-backup-deployment', investigationId: folderId, profileId: 'release-backup-profile', threadId: 'release-backup-chat', status: 'paused', shift: 'resting', serverSideEnabled: false, order: 0, createdAt: now, updatedAt: now }],
    agentActions: [{ id: 'release-backup-action', investigationId: folderId, threadId: 'release-backup-chat', toolName: 'read_note', toolInput: { id: noteId }, rationale: 'Historical fictional review.', status: 'rejected', severity: 'info', reviewedAt: now, reviewedBy: 'fictional-reviewer', createdAt: now }],
    agentMeetings: [{ id: 'release-backup-meeting', investigationId: folderId, participantDeploymentIds: ['release-backup-deployment'], threadId: 'release-backup-chat', minutesNoteId: noteId, agenda: 'Historical fictional review only.', status: 'completed', roundsCompleted: 1, maxRounds: 1, purpose: 'freeform', structuredOutput: { purpose: 'freeform', summary: 'Synthetic observation.', keyPoints: ['Preserve evidence.'], actionItems: [] }, createdAt: now, completedAt: now }],
    integrationTemplates: [{ id: 'release-backup-integration-template', schemaVersion: '1.0', version: '1.0.0', name: 'Fictional disabled integration', description: 'Stored configuration only; no network steps.', author: 'Fictional fixture', icon: 'Plug', color: '#336699', category: 'utility', tags: ['fictional-recovery'], triggers: [{ type: 'manual' }], configSchema: [], steps: [], outputs: [], requiredDomains: [], source: 'user', createdAt: now, updatedAt: now }],
    installedIntegrations: [{ id: 'release-backup-integration', templateId: 'release-backup-integration-template', name: 'Fictional disabled installation', enabled: false, config: {}, scopeType: 'investigation', scopeFolderIds: [folderId], runCount: 0, errorCount: 0, createdAt: now, updatedAt: now }],
    customSlashCommands: [{ id: 'release-backup-command', name: 'fictionalreview', description: 'Stored command; not invoked.', template: 'Review only this fictional text: {{input}}', createdAt: now, updatedAt: now }],
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

async function seedRows(page: Page, rows: BackupRows) {
  await page.evaluate(records => new Promise<void>((resolve, reject) => {
    if (localStorage.getItem('threatcaddy-encryption')) return reject(new Error('Never seed plaintext behind encryption middleware'));
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(Object.keys(records), 'readwrite');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      for (const [table, entries] of Object.entries(records)) for (const row of entries) transaction.objectStore(table).put(row);
    };
  }), rows);
}

async function rasterFixture(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic raster fixture unavailable');
    context.fillStyle = '#336699'; context.fillRect(0, 0, 1, 1);
    return canvas.toDataURL('image/png').split(',')[1];
  });
}

async function isolateNetwork(page: Page) {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('Recovery checks require an explicit isolated preview origin');
  const appOrigin = new URL(baseURL).origin;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({ tiAutoExtractEnabled: false, editorMode: 'edit' }));
  });
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) await route.continue();
    else { externalRequests.push(`${url.origin}${url.pathname}`); await route.abort(); }
  });
  return { externalRequests, pageErrors };
}

type BackupFile = string | { name: string; mimeType: string; buffer: Buffer };

function backupFile(value: unknown): BackupFile {
  return { name: 'fictional-recovery-backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) };
}

async function selectBackup(page: Page, file: BackupFile) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load Backup', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  const confirmation = page.getByRole('dialog', { name: 'Load Backup', exact: true });
  await expect(confirmation).toBeVisible();
  return confirmation;
}

async function loadBackup(page: Page, file: BackupFile, mode: 'Replace All' | 'Merge', password?: string) {
  const confirmation = await selectBackup(page, file);
  if (password !== undefined) await confirmation.getByLabel('Backup password (only for encrypted files)', { exact: true }).fill(password);
  await confirmation.getByRole('button', { name: mode, exact: true }).click();
  await finishBackupImport(page);
}

async function finishBackupImport(page: Page) {
  const confirmation = page.getByRole('dialog', { name: 'Load Backup', exact: true });
  await expect.poll(async () => !await confirmation.count()
    || await confirmation.getByText(/^Backup restored with notices\./).isVisible(), { timeout: 30_000 }).toBe(true);
  if (await confirmation.count()) {
    await expect(confirmation.getByRole('button', { name: 'Replace All', exact: true })).toHaveCount(0);
    await expect(confirmation.getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0);
    await confirmation.screenshot({ path: test.info().outputPath('restore-completed-with-notices.png') });
    // The shared Modal also has a labelled close icon; this is the completion
    // panel's explicit acknowledgement, after its persistent notices.
    await confirmation.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  await expect(confirmation).toHaveCount(0);
}

async function downloadBackupJSON(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Backup', exact: true }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('Backup download did not produce a file');
  return JSON.parse(await readFile(path, 'utf8')) as BackupRows & { version: number; format: string };
}

async function encryptedFixture(page: Page, payload: unknown) {
  // Independent format writer using this engine's native WebCrypto, not a
  // mocked crypto implementation or a development-only app-module import.
  return page.evaluate(async ({ payload, password }) => {
    const base64 = (buffer: ArrayBuffer | Uint8Array) => {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return btoa(binary);
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    return { v: 1, salt: base64(salt), iv: base64(iv), ct: base64(ciphertext) };
  }, { payload, password: backupPassword });
}

async function enableWorkspaceEncryption(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Encryption', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Enable Encryption', exact: true });
  await setup.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await setup.getByPlaceholder('Confirm passphrase...', { exact: true }).fill(workspacePassword);
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('checkbox', { name: "I've saved this recovery key in a secure location", exact: true }).check();
  await setup.getByRole('button', { name: 'Enable Encryption', exact: true }).click();
  await expect(setup).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('Encryption is enabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
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
    const imageData = await rasterFixture(page);
    const fixture = recoveryFixture(imageData);
    // Seed only disposable test data. Exercise the actual UI export/import,
    // including its sanitizers, browser download/file picker and hook hydration.
    await seedRows(page, fixture);
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
    expect(backup).toHaveProperty('format', 'threatcaddy-backup');
    for (const name of ['_syncQueue', '_syncMeta', '_localMigrations', 'integrationRuns', 'checkpoints', 'activityLog']) expect(backup).not.toHaveProperty(name);
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
      assertRecovered(await downloadBackupJSON(restored), original);
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

function ordinaryNote(id: string, content: string, updatedAt = fixtureTime) {
  return { id, title: 'Fictional retained note', content, tags: [], pinned: false, archived: false, trashed: false, createdAt: fixtureTime, updatedAt };
}

function legacyBackup(rows: Partial<BackupRows> = {}) {
  return { version: 1, exportedAt: fixtureTime, notes: [], tasks: [], folders: [], tags: [], ...rows };
}

test('legacy absent tables are retained and explicit empty tables obey Replace versus Merge', async ({ page }) => {
  test.setTimeout(60_000);
  const network = await isolateNetwork(page);
  await goToApp(page);
  for (const mode of ['Replace All', 'Merge'] as const) {
    await seedRows(page, {
      notes: [ordinaryNote('populated-note', 'Fictional destination content.')],
      customSlashCommands: [{ id: 'populated-command', name: 'fictionalexisting', description: 'Retain if this table is absent.', template: 'Literal {{input}}', createdAt: fixtureTime, updatedAt: fixtureTime }],
    });
    const before = await readRows(page);
    await loadBackup(page, backupFile(legacyBackup()), mode);
    const expected = mode === 'Replace All' ? { ...before, notes: [], tasks: [], folders: [], tags: [] } : before;
    expect(await readRows(page)).toEqual(expected);
    await loadBackup(page, backupFile(legacyBackup({ customSlashCommands: [] })), mode);
    expect(await readRows(page)).toEqual(mode === 'Replace All' ? { ...expected, customSlashCommands: [] } : expected);
  }
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});

test('populated Merge keeps newer local revisions, updates older ones, and never duplicates identities', async ({ page }) => {
  const network = await isolateNetwork(page);
  await goToApp(page);
  await seedRows(page, { notes: [ordinaryNote('newer-local', 'Retained newer local content.', fixtureTime + 2), ordinaryNote('older-local', 'Superseded local content.', fixtureTime)] });
  const incoming = [ordinaryNote('newer-local', 'Older incoming content.', fixtureTime), ordinaryNote('older-local', 'Newer incoming content.', fixtureTime + 2), ordinaryNote('new-incoming', 'Added content.')];
  const file = backupFile(legacyBackup({ notes: incoming }));
  await loadBackup(page, file, 'Merge');
  const expected = [ordinaryNote('newer-local', 'Retained newer local content.', fixtureTime + 2), incoming[1], incoming[2]];
  const after = await readRows(page);
  expect(after.notes).toHaveLength(3);
  for (const row of expected) expect(after.notes.find(note => note.id === row.id)).toMatchObject(row);
  await loadBackup(page, file, 'Merge');
  expect(await readRows(page)).toEqual(after);
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});

test('invalid backup files leave every populated table intact and allow cancellation', async ({ page }) => {
  test.setTimeout(60_000);
  const network = await isolateNetwork(page);
  await goToApp(page);
  const fixture = recoveryFixture(await rasterFixture(page));
  await seedRows(page, fixture);
  const before = await readRows(page);
  const validNote = ordinaryNote('incoming-fixture', 'Never partially imported.');
  const invalid = [
    '{',
    { ...legacyBackup(), version: 999 },
    { ...legacyBackup(), notes: {} },
    legacyBackup({ notes: [validNote, validNote] }),
    legacyBackup({ notes: [{ ...validNote, id: '' }] }),
    legacyBackup({ notes: [validNote], tasks: [{ id: 'invalid-later-table', title: { ordinary: 'wrong field type' } }] }),
    { version: 1, type: 'full', scope: 'investigation', scopeId: folderId, createdAt: fixtureTime, data: fixture },
  ];
  for (const value of invalid) {
    const dialog = await selectBackup(page, backupFile(value));
    await dialog.getByRole('button', { name: 'Replace All', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('alert')).not.toHaveText('');
    expect(await readRows(page)).toEqual(before);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});

test('long Unicode note and chat content survive export, fresh-context import and re-export without truncation', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const network = await isolateNetwork(page);
  await goToApp(page);
  const content = '中文 日本語 한국어 🧪 e\u0301\r\n'.repeat(30_001);
  expect(content.length).toBeGreaterThan(500_000);
  await seedRows(page, {
    notes: [ordinaryNote('long-unicode-note', content)],
    chatThreads: [{ id: 'long-unicode-chat', title: 'Fictional long transcript', messages: [{ id: 'long-message', role: 'user', content, createdAt: fixtureTime }], provider: 'local', model: 'fictional-offline-model', tags: [], archived: false, trashed: false, createdAt: fixtureTime, updatedAt: fixtureTime }],
  });
  const backup = await downloadBackupJSON(page);
  const destination = await browser.newContext({ baseURL: new URL(page.url()).origin, serviceWorkers: 'block' });
  try {
    const restored = await destination.newPage();
    const restoredNetwork = await isolateNetwork(restored);
    await goToApp(restored);
    await loadBackup(restored, backupFile(backup), 'Replace All');
    const exported = await downloadBackupJSON(restored);
    expect(exported.notes.find(note => note.id === 'long-unicode-note')?.content).toBe(content);
    expect((exported.chatThreads.find(thread => thread.id === 'long-unicode-chat')?.messages as Array<{ content: string }>)[0].content).toBe(content);
    expect(restoredNetwork.externalRequests).toEqual([]);
    expect(restoredNetwork.pageErrors).toEqual([]);
  } finally { await destination.close(); }
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});

test('real WebCrypto backup import rejects a wrong password without writes, then retries successfully', async ({ page }) => {
  test.setTimeout(90_000);
  const network = await isolateNetwork(page);
  await goToApp(page);
  const fixture = recoveryFixture(await rasterFixture(page));
  const config = { limit: 0, enabled: false, labels: ['fictional'], credential: 'fictional-not-a-real-secret' };
  fixture.installedIntegrations[0].config = config;
  const incoming = structuredClone(fixture);
  // The saved manual-only integration has no steps or network destinations.
  // A restored enabled flag must nevertheless be suspended before persistence.
  incoming.installedIntegrations[0].enabled = true;
  const payload = { version: 1, type: 'full', scope: 'all', createdAt: fixtureTime, data: incoming };
  const encrypted = await encryptedFixture(page, payload);
  expect(Object.keys(encrypted).sort()).toEqual(['ct', 'iv', 'salt', 'v']);
  expect(JSON.stringify(encrypted)).not.toContain('fictional-not-a-real-secret');
  await seedRows(page, { notes: [ordinaryNote('encrypted-import-sentinel', 'Keep this until authentication succeeds.')] });
  const before = await readRows(page);
  const dialog = await selectBackup(page, backupFile(encrypted));
  const password = dialog.getByLabel('Backup password (only for encrypted files)', { exact: true });
  await password.fill('fictional-wrong-password');
  await dialog.getByRole('button', { name: 'Replace All', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/password|corrupt/i);
  expect(await readRows(page)).toEqual(before);
  await dialog.screenshot({ path: test.info().outputPath('wrong-password-retry-dialog.png'), mask: [password] });
  await password.fill(backupPassword);
  await dialog.getByRole('button', { name: 'Replace All', exact: true }).click();
  await expect(dialog.getByText(/^Backup restored with notices\./)).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Restored automation is inactive');
  await finishBackupImport(page);
  assertRecovered(await readRows(page), fixture);
  expect((await readRows(page)).installedIntegrations[0]).toMatchObject({ enabled: false, config });
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});

test('encrypted-at-rest workspace restores all portable tables and still decrypts after a fresh unlock', async ({ page }) => {
  test.setTimeout(120_000);
  const network = await isolateNetwork(page);
  await goToApp(page);
  const fixture = recoveryFixture(await rasterFixture(page));
  await seedRows(page, { notes: [ordinaryNote('at-rest-sentinel', 'Ordinary fictional pre-encryption content.')] });
  await enableWorkspaceEncryption(page);
  expect((await readRows(page)).notes.find(note => note.id === 'at-rest-sentinel')?.content).toMatchObject({ __enc: 1 });
  const encrypted = await encryptedFixture(page, { version: 1, type: 'full', scope: 'all', createdAt: fixtureTime, data: fixture });
  await loadBackup(page, backupFile(encrypted), 'Replace All', backupPassword);
  const raw = await readRows(page);
  expect(raw.notes.find(note => note.id === noteId)?.content).toMatchObject({ __enc: 1 });
  expect(raw.evidenceItems[0].imageData).toMatchObject({ __enc: 1 });
  expect(raw.whiteboards[0].files).toMatchObject({ __enc: 1 });
  expect(raw.installedIntegrations[0].config).toMatchObject({ __enc: 1 });
  assertRecovered(await downloadBackupJSON(page), fixture);
  // Close the cached session without changing the app's encryption metadata.
  // Only disposable fixture state exists in this browser context.
  await page.evaluate(() => sessionStorage.removeItem('threatcaddy-session-cache'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unlock ThreatCaddy', exact: true })).toBeVisible();
  await page.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('[data-tour="header"]')).toBeVisible({ timeout: 30_000 });
  assertRecovered(await downloadBackupJSON(page), fixture);
  expect(network.externalRequests).toEqual([]);
  expect(network.pageErrors).toEqual([]);
});
