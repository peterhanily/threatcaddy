import { expect, test, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { enableEncryption, readRows, seedRows, workspacePassword } from './client-lifecycle-fixtures';

test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const hour = 60 * 60 * 1000;
const noteId = 'fictional-encryption-deadline-note';
const content = 'Synthetic analyst content must remain encrypted through session expiry.';
const diagnostics = new WeakMap<Page, { external: string[]; errors: string[] }>();

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Encryption session checks require an isolated preview origin');
  const origin = new URL(baseURL).origin;
  const data = { external: [] as string[], errors: [] as string[] };
  diagnostics.set(page, data);
  page.on('pageerror', error => data.errors.push(error.message));
  await page.context().route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) await route.continue();
    else { data.external.push(url.origin + url.pathname); await route.abort(); }
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('threatcaddy-settings')) localStorage.setItem('threatcaddy-settings', JSON.stringify({
      tiAutoExtractEnabled: false, tiAutoEnrichImportedIOCs: false, editorMode: 'edit',
    }));
    localStorage.setItem('caddyai-onboarded', '1');
  });
  // Advance the browser's real Date and timers; application encryption code,
  // Web Crypto, UI and IndexedDB are never mocked or imported into this test.
  await page.clock.install({ time: new Date('2026-01-15T12:00:00Z') });
});

test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page)?.external, 'no external/provider requests').toEqual([]);
  expect(diagnostics.get(page)?.errors, 'no uncaught browser exceptions').toEqual([]);
});

async function prepareEncryptedNote(page: Page) {
  await goToApp(page);
  const now = await page.evaluate(() => Date.now());
  await seedRows(page, { notes: [{ id: noteId, title: 'Fictional encrypted note', content,
    tags: [], pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now }] });
  await page.evaluate(id => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({
    view: 'notes', selectedNoteId: id,
  })), noteId);
  await page.reload();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  await enableEncryption(page);
  // Settings closes the current note selection. Reopen through the real UI
  // before exercising the session lifetime.
  await page.getByRole('button', { name: 'Fictional encrypted note', exact: true }).click();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  const raw = (await readRows(page, ['notes'])).notes.find(row => row.id === noteId);
  expect(raw?.content).toMatchObject({ __enc: 1 });
  expect(JSON.stringify(raw)).not.toContain(content);
  return raw;
}

async function chooseDuration(page: Page, value: '24h' | '1h') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  const duration = page.getByLabel('Session duration', { exact: true });
  await duration.selectOption(value);
  await duration.locator('..').getByRole('button', { name: 'Save', exact: true }).click();
}

/** Return timestamps only: raw session-key material never leaves the page. */
async function cacheDeadline(page: Page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('threatcaddy-session-cache');
    if (!raw) return null;
    const { unlockedAt, expiresAt } = JSON.parse(raw) as { unlockedAt: number; expiresAt: number };
    return { unlockedAt, expiresAt };
  });
}

test('24-hour sessions survive eight hours and reload, then lock at the original deadline without decrypting stored data', async ({ page }) => {
  const encrypted = await prepareEncryptedNote(page);
  await chooseDuration(page, '24h');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Fictional encrypted note', exact: true }).click();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  const initial = await cacheDeadline(page);
  if (!initial) throw new Error('Expected an encrypted session cache after selecting its duration');
  expect(initial.expiresAt - initial.unlockedAt).toBe(24 * hour);

  await page.clock.fastForward(8 * hour + 60_000);
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  await expect(page.getByText('Unlock ThreatCaddy', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  expect(await cacheDeadline(page)).toEqual(initial);

  const untilLastMinute = initial.expiresAt - await page.evaluate(() => Date.now()) - 60_000;
  expect(untilLastMinute).toBeGreaterThan(0);
  await page.clock.fastForward(untilLastMinute);
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  expect(await cacheDeadline(page)).toEqual(initial);

  const untilExpiry = initial.expiresAt - await page.evaluate(() => Date.now());
  expect(untilExpiry).toBeGreaterThan(0);
  await page.clock.fastForward(untilExpiry + 1);
  await expect(page.getByText('Unlock ThreatCaddy', { exact: true })).toBeVisible();
  await expect(page.locator('[data-tour="header"]')).toHaveCount(0);
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveCount(0);
  expect(await cacheDeadline(page)).toBeNull();
  expect((await readRows(page, ['notes'])).notes.find(row => row.id === noteId)).toEqual(encrypted);

  await page.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  const next = await cacheDeadline(page);
  if (!next) throw new Error('Expected a new session cache after passphrase unlock');
  expect(next.unlockedAt).toBeGreaterThanOrEqual(initial.expiresAt);
  expect(next.expiresAt - next.unlockedAt).toBe(24 * hour);
  expect((await readRows(page, ['notes'])).notes.find(row => row.id === noteId)).toEqual(encrypted);
});

test('shortening an active session below its elapsed age locks immediately and preserves encrypted content', async ({ page }) => {
  const encrypted = await prepareEncryptedNote(page);
  await chooseDuration(page, '24h');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Fictional encrypted note', exact: true }).click();
  await page.clock.fastForward(2 * hour);
  await chooseDuration(page, '1h');
  await expect(page.getByText('Unlock ThreatCaddy', { exact: true })).toBeVisible();
  await expect(page.locator('[data-tour="header"]')).toHaveCount(0);
  expect(await cacheDeadline(page)).toBeNull();
  expect((await readRows(page, ['notes'])).notes.find(row => row.id === noteId)).toEqual(encrypted);
  await page.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Start writing in markdown...', { exact: true })).toHaveValue(content);
  const next = await cacheDeadline(page);
  if (!next) throw new Error('Expected a new session cache after passphrase unlock');
  expect(next.expiresAt - next.unlockedAt).toBe(hour);
});
