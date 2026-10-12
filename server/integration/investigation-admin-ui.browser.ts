/** Explicit opt-in browser gate; not part of the PostgreSQL-only Vitest suite.
 * Run with installed tsx + Playwright Chromium and TEST_DATABASE_URL pointing
 * at the guarded disposable coordinator described in integration/README.md. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { scratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

const evidence = await mkdtemp(join(tmpdir(), 'threatcaddy-admin-ui-'));
const database = await scratchDatabase({ maxConnections: 4 });
const artifact = await stageBuiltServer().catch(async error => { await database.close(); throw error; });
const passed: string[] = [];
const traffic: { method: string; path: string; status: number }[] = [];
const mutations: string[] = [];
const expectedMutations: string[] = [];
const consoleMessages: { type: string; text: string }[] = [];
const pageErrors: string[] = [];
const externalRequests: string[] = [];
let page: Page | undefined;
try {
  await applyCurrentMigrations(database);
  await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
    ('owner-a','owner-a@example.invalid','Fictional owner A','fixture','analyst'),
    ('owner-b','owner-b@example.invalid','Fictional owner B','fixture','analyst'),
    ('app-admin','admin@example.invalid','Fictional only app administrator','fixture','admin')`;
  await database.sql`INSERT INTO folders (id,name,created_by,updated_by,created_at,updated_at) VALUES
    ('case-a','Fictional original case','owner-a','owner-a',now(),now()),
    ('case-b','Fictional second case','owner-a','owner-a',now(),now())`;
  await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
    ('a-owner','case-a','owner-a','owner'),('a-editor','case-a','owner-b','editor'),
    ('b-owner','case-b','owner-a','owner'),('b-editor','case-b','owner-b','editor')`;
  await database.sql`INSERT INTO notes (id,title,content,folder_id,created_at,updated_at)
    VALUES ('case-note','Fictional retained note','Only local synthetic content','case-a',now(),now())`;
  await database.sql`INSERT INTO evidence_items (id,title,file_name,file_type,content,imported_at,folder_id,created_at,updated_at)
    VALUES ('case-evidence','Fictional retained evidence','fixture.txt','text','Only local synthetic evidence',1700000000000,'case-a',now(),now())`;

  await bootBuiltServer(database, artifact, async ({ apiUrl, adminUrl }) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if ([apiUrl, adminUrl].includes(url.origin)) return route.continue();
        externalRequests.push(`${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/admin/api/') && !['GET', 'HEAD'].includes(request.method())) {
          mutations.push(`${request.method()} ${path}`);
        }
      });
      page.on('response', response => traffic.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() }));
      async function mutation(action: () => Promise<unknown>, method: string, path: string, status: number) {
        expectedMutations.push(`${method} ${path}`);
        const reply = page!.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
        await action();
        const response = await reply;
        const body = await response.json() as Record<string, unknown>;
        assert.equal(response.status(), status, `${method} ${path}: ${JSON.stringify(body)}`);
        return body;
      }
      async function detail(id: string) {
        if (await page!.locator('#detailPanel').evaluate(element => element.classList.contains('active'))) {
          await page!.locator('#closeDetailBtn').click();
        }
        await page!.locator('[data-tab="tab-investigations"]').click();
        const reply = page!.waitForResponse(response => new URL(response.url()).pathname === `/admin/api/investigations/${id}/detail`);
        await page!.locator(`[data-action="inv-detail"][data-id="${id}"]`).click();
        assert.equal((await reply).status(), 200);
        await expect(page!.locator('#detailPanel')).toHaveClass(/active/);
        await expect(page!.locator(`[data-action="member-role"][data-uid="owner-b"]`)).toBeVisible();
      }
      async function check(name: string) {
        // No repeated listeners may turn one gesture into multiple/stale API mutations.
        assert.deepEqual(mutations, expectedMutations);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(externalRequests, []);
        assert.deepEqual(traffic.filter(row => row.status >= 500), []);
        passed.push(name);
        console.log(JSON.stringify({ passed: name }));
      }
      async function visibleToast(kind: 'error' | 'success', text: string, screenshot?: string) {
        const toast = page!.locator(`.toast-${kind}`).filter({ hasText: text }).last();
        await expect(toast).toBeVisible();
        // Visibility alone permits opacity0: wait for the real short fade-in,
        // then prove the toast is both painted and unobstructed in the viewport.
        await expect.poll(() => toast.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return Number(getComputedStyle(element).opacity) >= 0.99
            && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
            && element.contains(document.elementFromPoint(x, y));
        }), { timeout: 1_500 }).toBe(true);
        if (screenshot) await page!.screenshot({ path: join(evidence, screenshot), animations: 'disabled' });
      }

      await page.goto(`${adminUrl}/admin`);
      await page.locator('#setupSecret').fill(artifact.credentials.ADMIN_SECRET);
      await page.locator('#setupUsername').fill('fictional-admin');
      await page.locator('#setupDisplayName').fill('Fictional runtime administrator');
      await page.locator('#setupPassword').fill(randomBytes(24).toString('hex'));
      await mutation(() => page!.getByRole('button', { name: 'Create Account & Sign In', exact: true }).click(), 'POST', '/admin/api/bootstrap', 200);
      await expect(page.locator('#dashboard')).toBeVisible();
      await detail('case-a');

      const ownerRow = page.locator('[data-action="member-role"][data-uid="owner-a"]');
      const rejectedRemoval = await mutation(() => page!.locator('[data-action="remove-member"][data-uid="owner-a"]').click(),
        'DELETE', '/admin/api/investigations/case-a/members/owner-a', 409);
      assert.equal(rejectedRemoval.code, 'LAST_ELIGIBLE_OWNER');
      await visibleToast('error', 'last eligible owner', 'last-owner-removal.png');
      assert.equal((await database.sql`SELECT role FROM investigation_members WHERE id='a-owner'`)[0].role, 'owner');
      await check('last-owner removal is visibly rejected without changing membership');

      const rejectedDemotion = await mutation(() => ownerRow.selectOption('editor'),
        'PATCH', '/admin/api/investigations/case-a/members/owner-a', 409);
      assert.equal(rejectedDemotion.code, 'LAST_ELIGIBLE_OWNER');
      await expect(ownerRow).toHaveValue('owner');
      await visibleToast('error', 'last eligible owner');
      await check('last-owner demotion restores the truthful selected role');

      // Open A again, then B: old A closures must not receive a B gesture.
      await detail('case-a');
      await detail('case-b');
      await mutation(() => page!.locator('[data-action="member-role"][data-uid="owner-b"]').selectOption('owner'),
        'PATCH', '/admin/api/investigations/case-b/members/owner-b', 200);
      await visibleToast('success', 'Role updated');
      assert.equal((await database.sql`SELECT role FROM investigation_members WHERE id='a-editor'`)[0].role, 'editor');
      assert.equal((await database.sql`SELECT role FROM investigation_members WHERE id='b-editor'`)[0].role, 'owner');
      await check('reopened and switched detail panels issue only one correctly scoped mutation');

      await detail('case-a');
      await mutation(() => page!.locator('[data-action="member-role"][data-uid="owner-b"]').selectOption('owner'),
        'PATCH', '/admin/api/investigations/case-a/members/owner-b', 200);
      await mutation(() => ownerRow.selectOption('editor'), 'PATCH', '/admin/api/investigations/case-a/members/owner-a', 200);
      await mutation(() => page!.locator('[data-action="remove-member"][data-uid="owner-a"]').click(),
        'DELETE', '/admin/api/investigations/case-a/members/owner-a', 200);
      await expect(ownerRow).toHaveCount(0);
      await visibleToast('success', 'Member removed', 'owner-handover.png');
      assert.deepEqual(Array.from(await database.sql`SELECT user_id,role FROM investigation_members WHERE folder_id='case-a'`), [{ user_id: 'owner-b', role: 'owner' }]);
      await check('explicit owner handover permits subsequent demotion and removal');

      await page.locator('#closeDetailBtn').click();
      await page.locator('[data-tab="tab-users"]').click();
      for (const [userId, code, phrase] of [
        ['owner-b', 'LAST_ELIGIBLE_OWNER', 'last eligible owner'],
        ['app-admin', 'LAST_ACTIVE_ADMIN', 'last one'],
      ]) {
        await page.locator(`.user-check[data-id="${userId}"]`).check();
        const result = await mutation(() => page!.locator('#bulkDisable').click(), 'POST', '/admin/api/users/bulk', 409);
        assert.equal(result.code, code);
        await visibleToast('error', phrase);
        await expect(page.locator(`[data-action="active"][data-id="${userId}"]`)).toBeChecked();
        assert.equal((await database.sql`SELECT active FROM users WHERE id=${userId}`)[0].active, true);
        await page.locator(`.user-check[data-id="${userId}"]`).uncheck();
        await check(`bulk disable of ${userId} has a visible error and no false success`);
      }

      await detail('case-a');
      await page.locator('#openPurgeBtn').click();
      await expect(page.locator('#purgeModal')).toContainText('its memberships and ALL retained content');
      await expect(page.locator('#purgeEntityCounts')).toContainText('1 evidence items');
      await page.locator('#purgeConfirmInput').fill('Another fictional name');
      await expect(page.locator('#confirmPurge')).toBeDisabled();
      // Simulate an ordinary concurrent rename; the current DB name is authoritative.
      await database.sql`UPDATE folders SET name='Fictional renamed case' WHERE id='case-a'`;
      await page.locator('#purgeConfirmInput').fill('Fictional original case');
      await mutation(() => page!.locator('#confirmPurge').click(), 'DELETE', '/admin/api/investigations/case-a/content', 400);
      await visibleToast('error', 'Confirmation name does not match', 'current-name-required.png');
      await expect(page.locator('#purgeModal')).toHaveClass(/active/);
      assert.equal((await database.sql`SELECT id FROM notes WHERE id='case-note'`).length, 1);
      await check('purge rejects a stale confirmation name without losing retained content');

      await page.locator('#cancelPurge').click();
      await detail('case-a');
      await page.locator('#openPurgeBtn').click();
      await page.locator('#purgeConfirmInput').fill('Fictional renamed case');
      await mutation(() => page!.locator('#confirmPurge').click(), 'DELETE', '/admin/api/investigations/case-a/content', 200);
      await expect(page.locator('#purgeModal')).not.toHaveClass(/active/);
      await expect(page.locator('#detailPanel')).not.toHaveClass(/active/);
      await expect(page.locator('[data-action="inv-detail"][data-id="case-a"]')).toHaveCount(0);
      await visibleToast('success', 'Investigation and its content permanently deleted', 'purge-completed.png');
      for (const table of ['folders', 'notes', 'evidence_items', 'investigation_members']) {
        const key = table === 'folders' ? 'id' : 'folder_id';
        assert.deepEqual(Array.from(await database.sql`SELECT id FROM ${database.sql(table)} WHERE ${database.sql(key)}='case-a'`), []);
      }
      assert.equal((await database.sql`SELECT id FROM folders WHERE id='case-b'`).length, 1);
      assert.deepEqual(traffic.filter(row => row.path.startsWith('/admin/api/') && row.status === 404), []);
      await check('successful purge closes stale details, refreshes the list and causes no404');
    } catch (error) {
      await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
      throw error;
    } finally {
      try { await context.close(); } finally { await browser.close(); }
    }
  });
} finally {
  try {
    await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed, traffic, mutations, expectedMutations, consoleMessages, pageErrors, externalRequests }, null, 2));
  } finally {
    try { await artifact.close(); } finally { await database.close(); }
    console.log(JSON.stringify({ evidence, passed: passed.length }));
  }
}
