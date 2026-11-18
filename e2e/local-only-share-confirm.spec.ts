import { test, expect, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { goToApp, waitForAppReady } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

const locale = (language: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../public/locales/${language}/${namespace}.json`, import.meta.url), 'utf8'));

const WIDTH = 390;
const HEIGHT = 844;
test.use({ serviceWorkers: 'block' });

/** Fully inside the phone screen, with no text cut off inside its own box. */
async function expectOnScreen(element: Locator, label: string) {
  const box = await element.boundingBox();
  if (!box) throw new Error(`${label} is not laid out`);
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(WIDTH);
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(HEIGHT);
  expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth), `${label} overflow`).toBe(true);
}

// A local-only investigation holding an AI conversation asks before it may sync (SEC-2), at phone width in both directions.
for (const language of ['en', 'ar']) {
  test(`${language}: asks at phone width before a local-only investigation with AI-written content may sync`, async ({ page, context, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('This test needs the configured baseURL');
    const origin = new URL(baseURL).origin;
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/^https?:\/\//, async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
      await route.continue();
    });
    await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
    await goToApp(page);
    const now = Date.now();
    await seedRows(page, {
      folders: [{ id: 'fictional-hunt', name: 'Fictional hunting case', order: 0, status: 'active', localOnly: true, createdAt: now, updatedAt: now }],
      chatThreads: [{ id: 'fictional-hunt-chat', title: 'Fictional chat', folderId: 'fictional-hunt', model: 'synthetic-model', provider: 'anthropic',
        tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now,
        messages: [{ id: 'fictional-reply', role: 'assistant', content: 'Fictional reply', createdAt: now }] }],
    });
    await page.evaluate(language => {
      localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, tiAutoExtractEnabled: false }));
      sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'investigations' }));
    }, language);
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    // A phone opens the executive overview first.
    await page.getByRole('button', { name: locale(language, 'exec')['dashboard.switchToAnalyst'], exact: true }).click();
    await waitForAppReady(page);

    const text = locale(language, 'investigations');
    const cancel = locale(language, 'common').cancel;
    const card = page.getByRole('group', { name: 'Fictional hunting case' });
    await card.getByRole('button', { name: text['card.actions'], exact: true }).click();
    await card.getByRole('button', { name: text['card.settings'], exact: true }).click();
    const keepLocal = page.getByRole('switch', { name: text['detail.keepLocalLabel'] });
    await expect(keepLocal).toHaveAttribute('aria-checked', 'true');

    await keepLocal.click();
    const dialog = page.getByRole('dialog', { name: text['detail.shareAiTitle'] });
    await expect(dialog).toContainText(text['detail.shareAiMessageLater']);
    await expectOnScreen(dialog.getByRole('heading', { name: text['detail.shareAiTitle'] }), 'title');
    await expectOnScreen(dialog.getByText(text['detail.shareAiMessageLater']), 'message');
    await expectOnScreen(dialog.getByRole('button', { name: cancel, exact: true }), 'Cancel');
    await expectOnScreen(dialog.getByRole('button', { name: text['detail.shareAiConfirm'], exact: true }), 'Share');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways page scroll').toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${language}-share-confirm-${WIDTH}.png`) });

    await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(keepLocal).toHaveAttribute('aria-checked', 'true');
    expect((await readRows(page, ['folders'])).folders.find(row => row.id === 'fictional-hunt')?.localOnly).toBe(true);

    await keepLocal.click();
    await dialog.getByRole('button', { name: text['detail.shareAiConfirm'], exact: true }).click();
    await expect(keepLocal).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await readRows(page, ['folders'])).folders.find(row => row.id === 'fictional-hunt')?.localOnly).toBe(false);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// Chat writes carry no marker: a conversation in another local-only investigation that created a note here still asks.
test('asks when a conversation in another local-only investigation wrote here', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, {
    folders: [
      { id: 'fictional-hunt', name: 'Fictional hunting case', order: 0, status: 'active', localOnly: true, createdAt: now, updatedAt: now },
      { id: 'fictional-source', name: 'Fictional source case', order: 1, status: 'active', localOnly: true, createdAt: now, updatedAt: now },
    ],
    notes: [{ id: 'fictional-chat-note', folderId: 'fictional-hunt', title: 'Fictional note', content: 'Synthetic text', tags: [], pinned: false,
      archived: false, trashed: false, createdBy: 'Fictional Analyst', createdAt: now, updatedAt: now }],
    chatThreads: [{ id: 'fictional-source-chat', title: 'Fictional chat', folderId: 'fictional-source', model: 'synthetic-model', provider: 'anthropic',
      tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now,
      messages: [{ id: 'fictional-reply', role: 'assistant', content: 'Fictional reply', createdAt: now, toolCalls: [{ id: 'fictional-call',
        name: 'create_in_investigation', input: { investigationId: 'fictional-hunt', entityType: 'note', data: { title: 'Fictional note' } },
        result: '{"success":true}', isError: false }] }] }],
  });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'investigations' }));
  });
  await page.reload();
  await waitForAppReady(page);

  const text = locale('en', 'investigations');
  const card = page.getByRole('group', { name: 'Fictional hunting case' });
  await card.getByRole('button', { name: text['card.actions'], exact: true }).click();
  await card.getByRole('button', { name: text['card.settings'], exact: true }).click();
  const keepLocal = page.getByRole('switch', { name: text['detail.keepLocalLabel'] });
  await keepLocal.click();
  const dialog = page.getByRole('dialog', { name: text['detail.shareAiTitle'] });
  await expect(dialog).toContainText(text['detail.shareAiMessageLater']);
  await dialog.getByRole('button', { name: locale('en', 'common').cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(keepLocal).toHaveAttribute('aria-checked', 'true');
  expect((await readRows(page, ['folders'])).folders.find(row => row.id === 'fictional-hunt')?.localOnly).toBe(true);
  expect(errors).toEqual([]);
});
