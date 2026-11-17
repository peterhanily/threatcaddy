import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { goToApp } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

test.use({ serviceWorkers: 'block' });

// In the All Investigations view (nothing selected), CaddyAI asks to write a note in the thread's
// investigation. Only the local model is a fixture: it calls create_note once, then answers.
async function openWriteCard(page: Page, context: BrowserContext, baseURL: string | undefined, options: { theme?: 'dark' | 'light'; language?: string } = {}) {
  const origin = new URL('/', baseURL).origin;
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
    if (url.pathname === '/fictional-local/v1/chat/completions') {
      const body = JSON.parse(route.request().postData() || '{}');
      const answered = body.messages.some((message: { role: string }) => message.role === 'tool');
      const events = answered
        ? [{ choices: [{ delta: { content: 'Fictional answer.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_0', function: { name: 'create_note',
            arguments: JSON.stringify({ title: 'Fictional destination note', content: 'x' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
      await route.fulfill({ status: 200, contentType: 'text/event-stream',
        body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await page.addInitScript(() => localStorage.setItem('caddyai-onboarded', '1'));
  await goToApp(page);
  const now = Date.now();
  await seedRows(page, {
    folders: [{ id: 'fictional-case', name: 'Fictional Case Alpha', order: 0, status: 'active', tags: [], createdAt: now, updatedAt: now }],
    chatThreads: [{ id: 'fictional-thread', title: 'Fictional chat', folderId: 'fictional-case', provider: 'local', model: 'fictional-local-model',
      messages: [], mode: 'act', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now }],
  });
  await page.evaluate(({ theme, language }) => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language, theme, tiAutoExtractEnabled: false,
      llmLocalEndpoint: location.origin + '/fictional-local/v1', llmLocalModelName: 'fictional-local-model', llmDefaultProvider: 'local' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat' }));
    sessionStorage.setItem('tc-chat-thread', 'fictional-thread');
  }, { theme: options.theme ?? 'dark', language: options.language ?? 'en' });
  await page.reload();

  // The composer's name ends with the product name in English and Arabic.
  const composer = page.getByRole('textbox', { name: /CaddyAI$/ });
  await composer.fill('Write it down');
  await composer.press('Enter');
  const card = page.locator('[role="group"][aria-labelledby]');
  await expect(card).toBeVisible();
  // Approve stays disabled for a moment after a card appears.
  await expect(card.getByRole('button').first()).toBeEnabled();
  return { card, external, errors };
}

/** WCAG contrast of an element's text against its backgrounds, blending translucent layers over the page. */
function contrastOf(locator: Locator) {
  return locator.evaluate((element: Element) => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = rgba(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) layers.unshift(layer);
      if (layer[3] >= 1) break;
    }
    const blend = (base: number[], top: number[]) => base.map((value, i) => i < 3 ? value * (1 - top[3]) + top[i] * top[3] : 1);
    const background = layers.reduce(blend, [255, 255, 255, 1]);
    const text = blend(background, rgba(getComputedStyle(element).color));
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const [high, low] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  });
}

test('in the global view, a write card names the investigation it changes and that it syncs', async ({ page, context, baseURL }) => {
  const { card, external, errors } = await openWriteCard(page, context, baseURL);
  await expect(card.getByText('Approve a change to this investigation?', { exact: true })).toBeVisible();
  await expect(card.getByRole('listitem').filter({ hasText: 'Fictional Case Alpha: syncs to its members' })).toHaveCount(1);
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Fictional answer.')).toBeVisible();
  const rows = await readRows(page, ['notes']);
  expect((rows.notes as Array<{ title: string; folderId?: string }>).filter(note => note.title === 'Fictional destination note'))
    .toEqual([expect.objectContaining({ folderId: 'fictional-case' })]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('the light theme\'s Approve label is readable at rest and on hover', async ({ page, context, baseURL }) => {
  const { card, external, errors } = await openWriteCard(page, context, baseURL, { theme: 'light' });
  const approve = card.getByRole('button', { name: 'Approve', exact: true });
  expect(await contrastOf(approve)).toBeGreaterThanOrEqual(4.5);
  await approve.hover();
  expect(await contrastOf(approve)).toBeGreaterThanOrEqual(4.5);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('in Arabic, the tool name and the Details JSON read left to right', async ({ page, context, baseURL }) => {
  const { card, external, errors } = await openWriteCard(page, context, baseURL, { language: 'ar' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await card.locator('summary').click();
  const details = card.locator('pre');
  await expect(details).toContainText('"title": "Fictional destination note"');
  for (const element of [details, card.getByText('create_note', { exact: true })]) {
    expect(await element.evaluate(node => getComputedStyle(node).direction)).toBe('ltr');
  }
  expect(await details.evaluate(node => getComputedStyle(node).textAlign)).toMatch(/^(start|left)$/);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
