import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { goToApp, getSidebar, navigateToView } from './fixtures';

// Keep the browser fixture structural: importing application types here pulls
// runtime-specific ambient declarations into the separate Playwright config.
interface LocalTemplate {
  id: string; schemaVersion: '1.0'; version: string; name: string; description: string;
  author: string; icon: string; color: string; category: 'utility'; tags: string[];
  triggers: { type: 'manual' }[]; configSchema: unknown[]; steps: Record<string, unknown>[];
  outputs: Record<string, unknown>[]; requiredDomains: string[]; source: 'user'; createdAt: number; updatedAt: number;
}
interface StoredInstallation { id: string; templateId: string; [key: string]: unknown }
interface StoredRun { log: { type: string }[]; [key: string]: unknown }

// Keep mocked catalog requests on the page route instead of a service worker.
// Real service-worker/offline behavior is covered separately in offline.spec.ts.
test.use({ serviceWorkers: 'block' });

const catalogUrl = 'https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/catalog.json';
const entry = {
  id: 'catalog-runtime-fixture', name: 'Fictional catalog runtime fixture', description: 'Local test response only.',
  author: 'Test', category: 'utility', tags: ['test'], icon: 'test', color: '#123456',
  version: '1.0.0', downloads: 0, templateUrl: 'https://example.test/template.json', sha256: '', updatedAt: '2026-10-05',
};

function localTemplate(name: string): LocalTemplate {
  return { id: 'fictional-portable-template', schemaVersion: '1.0', version: '1.0.0', name,
    description: 'Fictional local-only integration fixture.', author: 'Test', icon: 'test', color: '#123456',
    category: 'utility', tags: [], triggers: [{ type: 'manual' }], configSchema: [], steps: [], outputs: [],
    requiredDomains: [], source: 'user', createdAt: 1, updatedAt: 1 };
}

async function localOnly(context: BrowserContext, page: Page, baseURL: string) {
  const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
    external.push(route.request().url()); return route.abort('blockedbyclient');
  });
  return () => { expect(external).toEqual([]); expect(errors).toEqual([]); };
}

function templateCard(panel: Locator, name: string) {
  return panel.locator('div.bg-gray-800.rounded-lg').filter({ hasText: name });
}

async function pasteTemplate(panel: Locator, template: LocalTemplate) {
  await panel.getByPlaceholder('Or paste template JSON here...').fill(JSON.stringify(template));
  await panel.getByRole('button', { name: 'Import from Paste', exact: true }).click();
  await expect(panel.getByText(template.name, { exact: true })).toBeVisible();
}

async function integrationState(page: Page) {
  return page.evaluate(() => new Promise<{
    templates: LocalTemplate[]; installations: StoredInstallation[]; runs: StoredRun[];
    tasks: { id: string; title: string; description: string }[];
  }>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['integrationTemplates', 'installedIntegrations', 'integrationRuns', 'tasks'], 'readonly');
      const templates = transaction.objectStore('integrationTemplates').getAll();
      const installations = transaction.objectStore('installedIntegrations').getAll();
      const runs = transaction.objectStore('integrationRuns').getAll();
      const tasks = transaction.objectStore('tasks').getAll();
      transaction.oncomplete = () => { database.close(); resolve({ templates: templates.result, installations: installations.result, runs: runs.result, tasks: tasks.result }); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function openCatalog(page: Page) {
  await goToApp(page);
  await getSidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Integrations', exact: true });
  await panel.getByRole('button', { name: /^Catalog/ }).click();
  await expect(panel.getByRole('button', { name: 'Load community catalog', exact: true })).toBeVisible();
  return panel;
}

test('optional community catalog does not auto-fetch, reports404 and recovers on explicit retry', async ({ page }) => {
  let requests = 0;
  await page.route(catalogUrl, async route => {
    requests += 1;
    if (requests === 1) await route.fulfill({ status: 404, body: 'Not Found' });
    else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries: [entry] }) });
  });
  const panel = await openCatalog(page);
  expect(requests).toBe(0);
  await expect(panel.getByText('VirusTotal IP Lookup', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Import JSON File', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Load community catalog', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('HTTP 404');
  await expect(panel.getByRole('status')).toContainText('Built-in integrations and custom imports remain available');
  await expect(panel.getByText('No community templates available yet.', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Retry community catalog', exact: true }).click();
  await expect(panel.getByText(entry.name, { exact: true })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveCount(0);
  expect(requests).toBe(2);
});

test('offline refresh preserves saved community entries and custom local imports', async ({ page, context }) => {
  let requests = 0;
  await page.route(catalogUrl, async route => {
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries: [entry] }) });
  });
  const panel = await openCatalog(page);
  await panel.getByRole('button', { name: 'Load community catalog', exact: true }).click();
  await expect(panel.getByText(entry.name, { exact: true })).toBeVisible();
  await context.setOffline(true);
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('You are offline');
  await expect(panel.getByRole('status')).toContainText('may be out of date');
  await expect(panel.getByText(entry.name, { exact: true })).toBeVisible();
  expect(requests).toBe(1);

  const custom = {
    id: 'catalog-offline-custom', schemaVersion: '1.0', version: '1.0.0', name: 'Offline local template', description: 'Fictional local template.',
    author: 'Test', icon: 'test', color: '#123456', category: 'utility', tags: [], triggers: [{ type: 'manual' }],
    configSchema: [], steps: [], outputs: [], requiredDomains: [], source: 'user', createdAt: 0, updatedAt: 0,
  };
  await panel.getByPlaceholder('Or paste template JSON here...').fill(JSON.stringify(custom));
  await panel.getByRole('button', { name: 'Import from Paste', exact: true }).click();
  await expect(panel.getByText(custom.name, { exact: true })).toBeVisible();
  await expect(panel.getByText('VirusTotal IP Lookup', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await context.setOffline(false);
  await panel.getByRole('button', { name: 'Retry community catalog', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'You are offline' })).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('separate copy');
  await expect(panel.getByText(custom.name, { exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test('imported typed loops and owned branches create exact local records and persist truthful counters', async ({ page, context, baseURL }, testInfo) => {
  const assertInert = await localOnly(context, page, baseURL!);
  const panel = await openCatalog(page);
  const definition = localTemplate('Fictional bounded loop');
  definition.steps = [
    { id: 'initialize', type: 'set-variable', label: 'Save prior variables', variables: { item: 'before', index: 'before-index' } },
    { id: 'loop', type: 'loop', label: 'Typed local items', items: '{{config.items}}', itemVariable: 'item', indexVariable: 'index', bodySteps: ['choose'], maxIterations: 10 },
    { id: 'choose', type: 'condition', label: 'Choose one branch', expression: '{{loop.item.active}} == true', thenSteps: ['selected'], elseSteps: ['alternate'] },
    { id: 'selected', type: 'create-entity', label: 'Selected task', entityType: 'task', fields: { title: 'Fictional selected {{vars.index}} {{vars.item.label}}', description: '{{loop.item.detail}}' } },
    { id: 'alternate', type: 'create-entity', label: 'Alternate task', entityType: 'task', fields: { title: 'Fictional alternate {{vars.index}} {{vars.item.label}}', description: '{{loop.item.detail}}' } },
    { id: 'after', type: 'create-entity', label: 'Restored outer variables', entityType: 'task', fields: { title: 'Fictional restored {{vars.item}}/{{vars.index}}', description: 'One root after the loop.' } },
  ];
  definition.outputs = [{ type: 'display', template: {
    iterations: '{{steps.loop.iterations}}', lastBranch: '{{steps.choose.branch}}', restoredItem: '{{vars.item}}', restoredIndex: '{{vars.index}}',
  } }];
  await pasteTemplate(panel, definition);
  await templateCard(panel, definition.name).getByRole('button', { name: 'Install', exact: true }).click();
  await expect.poll(async () => (await integrationState(page)).installations.length).toBe(1);
  const installation = (await integrationState(page)).installations[0];
  // Seed only inputs: actual import, installation, run and all resulting writes
  // use the production UI/executor and real IndexedDB transactions.
  await page.evaluate(id => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['installedIntegrations', 'standaloneIOCs'], 'readwrite');
      const store = transaction.objectStore('installedIntegrations'); const read = store.get(id);
      read.onsuccess = () => store.put({ ...read.result, config: { items: [
        { label: 'café', active: true, detail: 'Fictional first item 🙂' },
        { label: 'second', active: false, detail: 'Fictional second item\nwith a new line.' },
      ] } });
      const now = Date.now();
      transaction.objectStore('standaloneIOCs').put({ id: 'fictional-loop-source', type: 'domain', value: 'fictional-loop.example.test', confidence: 'medium',
        tags: [], archived: false, trashed: false, createdAt: now, updatedAt: now });
      for (let index = 0; index < 80; index++) {
        transaction.objectStore('standaloneIOCs').put({ id: `fictional-scroll-${index}`, type: 'domain',
          value: `fictional-scroll-${String(index).padStart(3, '0')}.example.test`, confidence: 'medium',
          tags: [], archived: false, trashed: false, createdAt: now, updatedAt: now });
      }
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), installation.id);
  await page.reload(); await expect(page.locator('header[data-tour="header"]')).toBeVisible();
  await navigateToView(page, 'IOCs');
  const row = page.getByRole('row').filter({ hasText: 'fictional-loop.example.test' });
  await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Run Integration', exact: true }).click();
  await page.getByRole('button', { name: /Fictional bounded loop/ }).click();
  await expect.poll(async () => (await integrationState(page)).runs.length).toBe(1);
  const state = await integrationState(page);
  await testInfo.attach('persisted-integration-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]).toMatchObject({ integrationId: installation.id, templateId: installation.templateId,
    status: 'success', trigger: 'manual', entitiesCreated: 3, entitiesUpdated: 0, apiCallsMade: 0,
    outputSummary: '3 created', displayResults: { iterations: '2', lastBranch: 'else', restoredItem: 'before', restoredIndex: 'before-index' } });
  expect(state.installations[0]).toMatchObject({ id: installation.id, runCount: 1, errorCount: 0 });
  expect(state.tasks.map(task => ({ title: task.title, description: task.description })).sort((a, b) => a.title.localeCompare(b.title))).toEqual([
    { title: 'Fictional alternate 1 second', description: 'Fictional second item\nwith a new line.' },
    { title: 'Fictional restored before/before-index', description: 'One root after the loop.' },
    { title: 'Fictional selected 0 café', description: 'Fictional first item 🙂' },
  ]);
  expect(state.runs[0].log.filter(entry => entry.type === 'entity-created')).toHaveLength(3);
  const result = page.getByRole('dialog', { name: 'Integration Results', exact: true });
  await expect(result).toBeVisible(); await expect(result.getByText('success', { exact: true })).toBeVisible();
  await expect(result.getByText('3 created', { exact: true })).toBeVisible();
  await expect(result.getByText('before-index', { exact: true })).toBeVisible();
  // The modal correctly prevents pointer input to the background. Change its
  // real scroll position directly to exercise actual virtual-row removal and
  // recreation without dismissing the results or bypassing an action guard.
  const scroller = page.locator('[data-virtuoso-scroller]').filter({ has: page.locator('table') });
  const sourceRow = page.locator('tr').filter({ hasText: 'fictional-loop.example.test' });
  await expect(scroller).toHaveCount(1);
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(sourceRow).toHaveCount(0);
  await expect(result).toBeVisible();
  await expect(result.getByText('before-index', { exact: true })).toBeVisible();
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await expect(sourceRow).toHaveCount(1);
  await expect(result).toBeVisible();
  await expect(result.getByText('3 created', { exact: true })).toBeVisible();
  expect(await integrationState(page)).toEqual(state);
  await page.screenshot({ path: testInfo.outputPath('local-loop-results.png'), animations: 'disabled' });
  await result.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await expect(page.locator('header[data-tour="header"]')).toBeVisible();
  expect(await integrationState(page)).toEqual(state);
  await getSidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  const reopened = page.getByRole('tabpanel', { name: 'Integrations', exact: true });
  await expect(reopened.getByText(/1 runs/)).toBeVisible();
  await reopened.getByRole('button', { name: /^History/ }).click();
  await expect(reopened.getByText('3 created', { exact: true })).toBeVisible();
  await expect(reopened.getByText('0 API calls', { exact: true })).toBeVisible();
  assertInert();
});

test('JSON ID collisions import a separate copy and catalog collisions preserve installed configuration and history', async ({ page, context, baseURL }, testInfo) => {
  const assertInert = await localOnly(context, page, baseURL!);
  const panel = await openCatalog(page);
  const original = localTemplate('Fictional original integration');
  await pasteTemplate(panel, original);
  await templateCard(panel, original.name).getByRole('button', { name: 'Install', exact: true }).click();
  await expect.poll(async () => (await integrationState(page)).installations.length).toBe(1);
  const created = await integrationState(page);
  const originalTemplate = created.templates[0]; const originalInstallation = created.installations[0];
  await page.evaluate(({ id, templateId }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['installedIntegrations', 'integrationRuns'], 'readwrite');
      const store = transaction.objectStore('installedIntegrations'); const read = store.get(id);
      read.onsuccess = () => store.put({ ...read.result, config: { token: 'fictional-local-only-value' }, runCount: 1 });
      transaction.objectStore('integrationRuns').put({ id: 'fictional-retained-run', integrationId: id, templateId, status: 'success', trigger: 'manual',
        inputSummary: 'Fictional previous input', outputSummary: 'Completed', durationMs: 1, entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [], createdAt: Date.now() });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), { id: originalInstallation.id, templateId: originalTemplate.id });
  const before = await integrationState(page);
  const copy = { ...originalTemplate, name: 'Fictional imported separate copy', description: 'This copy must not replace the installed definition.' };
  await pasteTemplate(panel, copy);
  await expect(panel.getByRole('status')).toContainText('separate copy');
  const afterCopy = await integrationState(page);
  expect(afterCopy.templates).toHaveLength(2);
  expect(afterCopy.templates.find(template => template.id === originalTemplate.id)).toEqual(originalTemplate);
  expect(afterCopy.templates.find(template => template.name === copy.name)?.id).not.toBe(originalTemplate.id);
  expect(afterCopy.installations).toEqual(before.installations); expect(afterCopy.runs).toEqual(before.runs);

  const offered = { ...entry, id: 'fictional-community-offer', name: 'Fictional colliding catalog offer',
    templateUrl: 'https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/fictional-runtime-fixture.json' };
  const update = { ...entry, id: originalTemplate.id, name: 'Fictional unavailable catalog update', version: '2.0.0' };
  let templateRequests = 0;
  await page.route(catalogUrl, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries: [offered, update] }) }));
  await page.route(offered.templateUrl, route => {
    templateRequests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...originalTemplate, name: 'Fictional refused replacement' }) });
  });
  await panel.getByRole('button', { name: 'Load community catalog', exact: true }).click();
  await expect(templateCard(panel, update.name).getByRole('button')).toBeDisabled();
  await expect(templateCard(panel, update.name).getByRole('button')).toHaveAttribute('title', /not replaced automatically/);
  await templateCard(panel, offered.name).getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByText(/An integration with this ID already exists/)).toBeVisible();
  expect(templateRequests).toBe(1); expect(await integrationState(page)).toEqual(afterCopy);
  await expect(panel.getByText(original.name, { exact: true })).toBeVisible();
  await expect(panel.getByText(copy.name, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('preserved-template-collision.png'), animations: 'disabled' });
  await page.reload(); await expect(page.locator('header[data-tour="header"]')).toBeVisible();
  expect(await integrationState(page)).toEqual(afterCopy); assertInert();
});

test('invalid pasted and file templates report errors without writes and allow correction', async ({ page, context, baseURL }) => {
  const assertInert = await localOnly(context, page, baseURL!);
  const panel = await openCatalog(page);
  const original = await integrationState(page);
  const definition = localTemplate('Fictional corrected paste');
  const invalid = JSON.stringify({ ...definition, outputs: {} });
  const paste = panel.getByPlaceholder('Or paste template JSON here...');
  await paste.fill(invalid); await panel.getByRole('button', { name: 'Import from Paste', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('outputs'); await expect(paste).toHaveValue(invalid);
  expect(await integrationState(page)).toEqual(original);
  await pasteTemplate(panel, definition); await expect(paste).toHaveValue('');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  const afterPaste = await integrationState(page);
  await panel.locator('input[type="file"]').setInputFiles({ name: 'fictional-invalid.json', mimeType: 'application/json', buffer: Buffer.from(invalid) });
  await expect(panel.getByRole('alert')).toContainText('outputs'); expect(await integrationState(page)).toEqual(afterPaste);
  const fromFile = localTemplate('Fictional corrected file');
  await panel.locator('input[type="file"]').setInputFiles({ name: 'fictional-corrected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fromFile)) });
  await expect(panel.getByText(fromFile.name, { exact: true })).toBeVisible(); await expect(panel.getByRole('alert')).toHaveCount(0);
  const final = await integrationState(page);
  expect(final.templates).toHaveLength(2); expect(final.installations).toEqual(original.installations); expect(final.runs).toEqual(original.runs); expect(final.tasks).toEqual(original.tasks);
  assertInert();
});
