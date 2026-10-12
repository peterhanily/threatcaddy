import { expect, test, type Page } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';
import { enableEncryption, exportBackup, installLaunchQueue, pngFixture, readRows, seedRows, workspacePassword, type LaunchWindow } from './client-lifecycle-fixtures';

// The OS launch API is simulated, not a service worker. The dedicated offline
// suite retains real service-worker coverage. No provider or team server runs.
test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const diagnostics = new WeakMap<Page, { external: string[]; errors: string[] }>();
const MiB = 1024 * 1024;

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Lifecycle checks require an isolated preview origin');
  const appOrigin = new URL(baseURL).origin;
  const data = { external: [] as string[], errors: [] as string[] };
  diagnostics.set(page, data);
  page.on('pageerror', error => data.errors.push(error.message));
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin && !url.pathname.startsWith('/fictional-provider')) await route.continue();
    else { data.external.push(url.origin + url.pathname); await route.abort(); }
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({
      tiAutoExtractEnabled: false, tiAutoEnrichImportedIOCs: false, editorMode: 'edit',
    }));
    localStorage.setItem('caddyai-onboarded', '1');
  });
});

test.afterEach(async ({ page }) => {
  const data = diagnostics.get(page);
  expect(data?.external, 'no unexpected external/provider requests').toEqual([]);
  expect(data?.errors, 'no uncaught browser exceptions').toEqual([]);
});

test('files queued before the React app mounts become exactly one durable note each', async ({ page }) => {
  const files = [
    { name: 'fictional-startup-中文.md', content: '# Fictional startup\n\nExact Unicode café 中文.' },
    { name: 'fictional-second.txt', content: 'Second synthetic file, never a provider request.' },
  ];
  await installLaunchQueue(page, files);
  await goToApp(page);
  await expect.poll(async () => (await readRows(page, ['notes'])).notes.length).toBe(2);
  const initial = (await readRows(page, ['notes'])).notes;
  for (const file of files) {
    expect(initial.filter(row => row.sourceTitle === file.name)).toHaveLength(1);
    expect(initial.find(row => row.sourceTitle === file.name)?.content).toBe(file.content);
  }
  expect(await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.reads)).toEqual(Object.fromEntries(files.map(file => [file.name, 1])));
  await navigateToView(page, 'Dashboard');
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  expect((await readRows(page, ['notes'])).notes).toEqual(initial);
  const now = Date.now();
  await seedRows(page, { folders: [{ id: 'fictional-classified-file-case', name: 'Fictional classified file case',
    clsLevel: 'TLP:RED', status: 'active', order: 0, tags: [], createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'notes', selectedFolderId: 'fictional-classified-file-case' }));
    sessionStorage.setItem('lifecycle-next-launch', JSON.stringify([{ name: 'fictional-classified-startup.md', content: 'Use the persisted destination classification during cold hydration.' }]));
  });
  await page.reload();
  await expect.poll(async () => (await readRows(page, ['notes'])).notes.length).toBe(3);
  expect((await readRows(page, ['notes'])).notes.find(row => row.sourceTitle === 'fictional-classified-startup.md')).toMatchObject({
    folderId: 'fictional-classified-file-case', clsLevel: 'TLP:RED', content: 'Use the persisted destination classification during cold hydration.',
  });
});

test('startup and subsequent launch handles stay unread while locked, then import once after unlock', async ({ page }) => {
  await installLaunchQueue(page);
  await goToApp(page);
  await enableEncryption(page);
  const files = [
    { name: 'fictional-locked-startup.md', content: 'Queued before the unlocked app mounts.' },
    { name: 'fictional-while-locked.txt', content: 'Queued while the actual lock screen is visible.' },
  ];
  await page.evaluate(file => {
    sessionStorage.setItem('lifecycle-next-launch', JSON.stringify([file]));
    sessionStorage.removeItem('threatcaddy-session-cache');
  }, files[0]);
  await page.reload();
  await expect(page.getByText('Unlock ThreatCaddy', { exact: true })).toBeVisible();
  const before = await readRows(page, ['notes']);
  await page.evaluate(file => (window as LaunchWindow).__lifecycleLaunch.enqueue([file]), files[1]);
  expect(await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.reads)).toEqual({});
  expect(await readRows(page, ['notes'])).toEqual(before);
  await page.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  await expect.poll(async () => (await readRows(page, ['notes'])).notes.length).toBe(before.notes.length + 2);
  const encrypted = (await readRows(page, ['notes'])).notes;
  for (const note of encrypted) expect(note.content).toMatchObject({ __enc: 1 });
  const exported = await exportBackup(page);
  for (const file of files) {
    expect(exported.notes.filter(row => row.sourceTitle === file.name)).toHaveLength(1);
    expect(exported.notes.find(row => row.sourceTitle === file.name)?.content).toBe(file.content);
  }
  expect(await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.reads)).toEqual(Object.fromEntries(files.map(file => [file.name, 1])));
  await page.reload();
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  expect((await readRows(page, ['notes'])).notes).toEqual(encrypted);
});

test('oversize and unreadable launched files report failure without notes and do not stall later valid files', async ({ page }) => {
  await installLaunchQueue(page);
  await goToApp(page);
  const before = await readRows(page, ['notes']);
  await page.evaluate(size => (window as LaunchWindow).__lifecycleLaunch.enqueue([{ name: 'fictional-oversize.md', size }]), 5 * MiB + 1);
  await expect(page.getByText(/Could not open "fictional-oversize\.md": text files must be 5 MiB or smaller/)).toBeVisible();
  expect(await readRows(page, ['notes'])).toEqual(before);
  await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.enqueue([{ name: 'fictional-unreadable.txt', fail: true }]));
  await expect(page.getByText('Could not read "fictional-unreadable.txt". Check file access and reopen it to retry.', { exact: true })).toBeVisible();
  expect(await readRows(page, ['notes'])).toEqual(before);
  await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.enqueue([{ name: 'fictional-after-failure.md', content: 'Readable after a rejected file.' }]));
  await expect.poll(async () => (await readRows(page, ['notes'])).notes.length).toBe(before.notes.length + 1);
  expect((await readRows(page, ['notes'])).notes.at(-1)).toMatchObject({ sourceTitle: 'fictional-after-failure.md', content: 'Readable after a rejected file.' });
});

test('workspace switching waits for a deferred launched file, then moves to an empty workspace without late writes', async ({ page }) => {
  await installLaunchQueue(page);
  await goToApp(page);
  const before = await readRows(page, ['notes']);
  await page.evaluate(() => {
    const harness = (window as LaunchWindow).__lifecycleLaunch;
    harness.enqueue([{ name: 'fictional-original-workspace.md', content: 'Must never cross a workspace switch.', deferred: true }]);
  });
  await expect.poll(() => page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.reads['fictional-original-workspace.md'])).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Create a new empty local workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Unsent chat drafts or pending file imports require attention. Send, finish, or explicitly discard them before changing workspaces, restoring, or preparing a data snapshot.');
  expect(await page.evaluate(() => sessionStorage.getItem('threatcaddy-active-workspace'))).toBeNull();
  expect(await readRows(page, ['notes'])).toEqual(before);
  await page.evaluate(() => (window as LaunchWindow).__lifecycleLaunch.releaseFiles());
  await expect.poll(async () => (await readRows(page, ['notes'])).notes.length).toBe(before.notes.length + 1);
  const completed = await readRows(page, ['notes']);
  expect(completed.notes.find(row => row.sourceTitle === 'fictional-original-workspace.md')).toMatchObject({ content: 'Must never cross a workspace switch.' });
  // A successful launch navigates to its new note, closing Settings. Wait for
  // that real UI acknowledgement before reopening the workspace controls.
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue('Must never cross a workspace switch.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Create a new empty local workspace', exact: true }).click(),
  ]);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('threatcaddy-active-workspace'))).toMatch(/^[a-f\d]{64}$/);
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  expect((await readRows(page, ['notes'])).notes).toEqual([]);
  expect(await readRows(page, ['notes'], 'ThreatCaddyDB')).toEqual(completed);
});

async function openFictionalChat(page: Page) {
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, { chatThreads: [{ id: 'fictional-lifecycle-chat', title: 'Fictional lifecycle draft', messages: [],
    provider: 'local', model: 'fictional-offline-model', tags: [], mode: 'plan', createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ ...settings, llmLocalEndpoint: location.origin + '/fictional-provider',
      llmLocalModelName: 'fictional-offline-model', llmDefaultProvider: 'local', llmDefaultModel: 'fictional-offline-model' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat' }));
    sessionStorage.setItem('tc-chat-thread', 'fictional-lifecycle-chat');
  });
  await page.reload();
  await expect(page.getByLabel('Message to CaddyAI', { exact: true })).toBeEnabled();
}

test('a real large PNG attaches without stack overflow; rejected types, size and count retain the draft', async ({ page }) => {
  await openFictionalChat(page);
  const input = page.getByLabel('Message to CaddyAI', { exact: true });
  const draft = 'Fictional unsent analyst draft — retain across attachment errors.';
  await input.fill(draft);
  const fileInput = page.locator('input[type="file"][accept="image/png,image/jpeg,image/gif,image/webp"]');
  const png = pngFixture();
  expect(png.byteLength).toBeGreaterThan(MiB);
  expect(await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, png.toString('base64'))).toEqual([512, 512]);
  await fileInput.setInputFiles({ name: 'fictional-large-raster.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(draft);

  for (const rejected of [
    { name: 'fictional-unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('Not an image.'), error: 'Choose PNG, JPEG, GIF or WebP images. Your draft and earlier images have been kept.' },
    { name: 'fictional-too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * MiB + 1), error: 'Each image must be 5 MiB or smaller. Your draft and earlier images have been kept.' },
    { name: 'fictional-empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0), error: 'An image could not be read. The new batch was not attached; your draft and earlier images have been kept. Try selecting it again.' },
  ]) {
    await fileInput.setInputFiles({ name: rejected.name, mimeType: rejected.mimeType, buffer: rejected.buffer });
    await expect(page.getByRole('alert')).toHaveText(rejected.error);
    await expect(page.getByText(rejected.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
    await expect(input).toHaveValue(draft);
  }
  await fileInput.setInputFiles(Array.from({ length: 4 }, (_, index) => ({ name: `fictional-over-count-${index}.png`, mimeType: 'image/png', buffer: pngFixture(1) })));
  await expect(page.getByRole('alert')).toHaveText('Attach at most 4 images per message. Your draft and earlier images have been kept.');
  await expect(page.getByText(/fictional-over-count-/)).toHaveCount(0);
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(draft);
  expect((await readRows(page, ['chatThreads'])).chatThreads[0].messages).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Create a new empty local workspace', exact: true }).click();
  await expect(page.getByText('Unsent chat drafts or pending file imports require attention. Send, finish, or explicitly discard them before changing workspaces, restoring, or preparing a data snapshot.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('threatcaddy-active-workspace'))).toBeNull();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(input).toHaveValue(draft);
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
  await navigateToView(page, 'Dashboard');
  await navigateToView(page, 'CaddyAI');
  await expect(input).toHaveValue(draft);
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard all unsent chat drafts', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard all unsent chat drafts', exact: true });
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(input).toHaveValue(draft);
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard all unsent chat drafts', exact: true }).click();
  await discard.getByRole('button', { name: 'Discard unsent drafts', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByText('fictional-large-raster.png', { exact: true })).toHaveCount(0);
  expect((await readRows(page, ['chatThreads'])).chatThreads[0].messages).toEqual([]);
});

test('the total image budget rejects the whole added batch while preserving the earlier attachment and text', async ({ page }) => {
  await openFictionalChat(page);
  const draft = 'Fictional draft survives the aggregate image budget.';
  await page.getByLabel('Message to CaddyAI', { exact: true }).fill(draft);
  const fileInput = page.locator('input[type="file"][accept="image/png,image/jpeg,image/gif,image/webp"]');
  await fileInput.setInputFiles({ name: 'fictional-retained-raster.png', mimeType: 'image/png', buffer: pngFixture() });
  await expect(page.getByText('fictional-retained-raster.png', { exact: true })).toBeVisible();
  const larger = pngFixture(1024);
  expect(larger.length).toBeLessThan(5 * MiB);
  expect(larger.length * 3).toBeGreaterThan(10 * MiB);
  await fileInput.setInputFiles(Array.from({ length: 3 }, (_, index) => ({ name: `fictional-total-overflow-${index}.png`, mimeType: 'image/png', buffer: larger })));
  await expect(page.getByRole('alert')).toHaveText('Images must total 10 MiB or less per message. Your draft and earlier images have been kept.');
  await expect(page.getByText(/fictional-total-overflow-/)).toHaveCount(0);
  await expect(page.getByText('fictional-retained-raster.png', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message to CaddyAI', { exact: true })).toHaveValue(draft);
  expect((await readRows(page, ['chatThreads'])).chatThreads[0].messages).toEqual([]);
});

async function inertTeamTransport(page: Page, baseURL: string) {
  const serverUrl = new URL(baseURL).origin + '/fictional-team';
  const requests: string[] = [];
  const pushes: Array<{ changes: Array<Record<string, unknown>> }> = [];
  const unexpected: string[] = [];
  await page.routeWebSocket('**/fictional-team/ws', socket => {
    socket.onMessage(message => {
      if (typeof message === 'string' && JSON.parse(message).type === 'auth') socket.send(JSON.stringify({ type: 'auth-ok' }));
    });
  });
  await page.route('**/fictional-team/api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/fictional-team'.length);
    requests.push(path);
    let body: unknown;
    if (path === '/api/auth/login') body = {
      accessToken: 'fictional-access-token', refreshToken: 'fictional-refresh-token',
      user: { id: 'fictional-lifecycle-user', displayName: 'Fictional Analyst', email: 'analyst@example.test', role: 'member' },
    };
    else if (path === '/api/sync/pull') body = { changes: [], serverTimestamp: new Date().toISOString(),
      cursor: '0', generation: '11111111-2222-4333-8444-555555555555', hasMore: false };
    else if (path === '/api/sync/push') {
      const payload = route.request().postDataJSON() as { changes: Array<Record<string, unknown>> };
      pushes.push(payload);
      body = { results: payload.changes.map(change => ({ table: change.table, entityId: change.entityId, status: 'accepted', serverVersion: 1 })) };
    } else if (path === '/api/investigations') body = { data: [], total: 0, offset: 0, limit: 50 };
    else if (['/api/notifications', '/api/audit/team'].includes(path)) body = [];
    else if (path === '/api/llm/config') body = { providers: [] };
    else if (path === '/api/server/info') body = { serverName: 'Fictional local transport' };
    else if (path === '/api/saved-searches') body = { searches: [] };
    else if (path === '/api/caddy-agents/status/fictional-sync-case') body = { registered: false, serverRunning: false,
      serverExecutionAvailable: false, heartbeatStale: false, botCount: 0, lastHeartbeat: null };
    else { unexpected.push(path); await route.fulfill({ status: 404, json: { error: 'Unknown synthetic route' } }); return; }
    await route.fulfill({ json: body });
  });
  return { serverUrl, requests, pushes, unexpected };
}

async function seedBoundWorkspace(page: Page, serverUrl: string) {
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, {
    folders: [{ id: 'fictional-sync-case', name: 'Fictional bound case', status: 'active', order: 0, tags: [], createdAt: now, updatedAt: now }],
    notes: [{ id: 'fictional-sync-note', title: 'Fictional signed-out note', content: 'Original fictional text.', folderId: 'fictional-sync-case',
      tags: [], pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now }],
    _syncMeta: [
      { key: 'syncWorkspaceIdentityV1', value: { version: 1, serverUrl, userId: 'fictional-lifecycle-user' } },
      { key: 'initialPushDoneV2', value: true },
    ],
    _localMigrations: [{ key: 'sync-capture-v1', version: 1, state: 'ready' }],
  });
  await page.evaluate(() => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({
    view: 'notes', selectedFolderId: 'fictional-sync-case', selectedNoteId: 'fictional-sync-note',
  })));
  await page.reload();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue('Original fictional text.');
}

async function signInToSameIdentity(page: Page, serverUrl: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByPlaceholder('https://your-server.example.com:3001', { exact: true }).fill(serverUrl);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByPlaceholder('Email', { exact: true }).fill('analyst@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill('fictional-sign-in-password');
  // Enter submits the credentials, avoiding the identically named Login tab.
  await page.getByPlaceholder('Password', { exact: true }).press('Enter');
  const onboarding = page.getByRole('dialog', { name: `Welcome to ${serverUrl}!`, exact: true });
  await onboarding.getByRole('button', { name: 'Get Started', exact: true }).click();
  await expect(onboarding).toBeHidden();
  await expect(page.getByRole('button', { name: 'Disconnect & Logout', exact: true })).toBeVisible();
}

test('a signed-out edit survives reload in the durable outbox and reaches only the same bound identity after sign-in', async ({ page, baseURL }) => {
  const transport = await inertTeamTransport(page, baseURL!);
  await seedBoundWorkspace(page, transport.serverUrl);
  expect(await page.evaluate(() => localStorage.getItem('threatcaddy-auth'))).toBeNull();
  const content = 'Fictional signed-out edit 中文 — deliver only after explicit same-account sign-in.';
  await page.getByPlaceholder('Start writing in markdown...', { exact: true }).fill(content);
  await expect.poll(async () => (await readRows(page, ['notes'])).notes[0].content).toBe(content);
  await expect.poll(async () => (await readRows(page, ['_syncQueue']))._syncQueue.some(row => row.entityId === 'fictional-sync-note'
    && (row.data as Record<string, unknown>)?.content === content)).toBe(true);
  const queued = (await readRows(page, ['_syncQueue']))._syncQueue;
  expect(transport.requests).toEqual([]);
  await page.reload();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  expect((await readRows(page, ['_syncQueue']))._syncQueue).toEqual(queued);
  expect(transport.requests).toEqual([]);
  await signInToSameIdentity(page, transport.serverUrl);
  await expect.poll(() => transport.pushes.flatMap(item => item.changes).some(change => change.entityId === 'fictional-sync-note'
    && (change.data as Record<string, unknown>)?.content === content)).toBe(true);
  await expect.poll(async () => (await readRows(page, ['_syncQueue']))._syncQueue.length).toBe(0);
  expect((await readRows(page, ['notes'])).notes[0].content).toBe(content);
  expect(await page.evaluate(() => sessionStorage.getItem('threatcaddy-active-workspace'))).toBeNull();
  expect(transport.unexpected).toEqual([]);
});

test('legacy history without the signed-out capture marker pauses before any sync request and preserves local edits', async ({ page, baseURL }, testInfo) => {
  const transport = await inertTeamTransport(page, baseURL!);
  await seedBoundWorkspace(page, transport.serverUrl);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('_localMigrations', 'readwrite');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      transaction.objectStore('_localMigrations').delete('sync-capture-v1');
    };
  }));
  await page.reload();
  const content = 'Fictional legacy-history edit must remain local until reconciliation.';
  await page.getByPlaceholder('Start writing in markdown...', { exact: true }).fill(content);
  await expect.poll(async () => (await readRows(page, ['notes'])).notes[0].content).toBe(content);
  await expect.poll(async () => (await readRows(page, ['_localMigrations']))._localMigrations.find(row => row.key === 'sync-capture-v1')?.state).toBe('reconciliation-required');
  const before = await readRows(page, ['notes', '_syncQueue']);
  await signInToSameIdentity(page, transport.serverUrl);
  await expect(page.getByText(/Sync paused: older sync history may be missing edits made while signed out/)).toBeVisible();
  expect(transport.requests.filter(path => path.startsWith('/api/sync/'))).toEqual([]);
  expect(await readRows(page, ['notes', '_syncQueue'])).toEqual(before);
  await expect(page.getByText('Sync history recovery', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Review sync settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Sync history recovery', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => sessionStorage.removeItem('tc-analyst-mode'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to Analyst Mode', exact: true })).toBeVisible();
  const review = page.getByRole('button', { name: 'Review sync settings', exact: true });
  await expect(review).toBeVisible();
  const bounds = await review.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await review.click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Sync history recovery', { exact: true })).toBeVisible();
  expect(await readRows(page, ['notes', '_syncQueue'])).toEqual(before);
  expect(transport.requests.filter(path => path.startsWith('/api/sync/'))).toEqual([]);
  expect(transport.unexpected).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('legacy-sync-recovery-mobile.png') });
});
