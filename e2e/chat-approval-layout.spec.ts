import { expect, test, type Locator } from '@playwright/test';
import { goToApp } from './fixtures';
import { seedRows } from './client-lifecycle-fixtures';

// A short window (phone landscape on the desktop layout): the pending approval card must
// not push the composer, Stop or the card's own buttons out of reach.
test.use({ serviceWorkers: 'block', viewport: { width: 844, height: 390 } });

test('a pending approval card keeps the composer in view and its buttons reachable on a short window', async ({ page, context, baseURL }) => {
  const origin = new URL('/', baseURL).origin;
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Only the local model is a fixture: it asks to open one long collector address.
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
    if (url.pathname === '/fictional-local/v1/chat/completions') {
      const body = JSON.parse(route.request().postData() || '{}');
      const answered = body.messages.some((message: { role: string }) => message.role === 'tool');
      const events = answered
        ? [{ choices: [{ delta: { content: 'Fictional answer.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'fetch_url',
            arguments: JSON.stringify({ url: `https://collector.example/a?d=${'A'.repeat(300)}` }) } }] } }] },
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
  await seedRows(page, { chatThreads: [{ id: 'fictional-thread', title: 'Fictional chat', provider: 'local', model: 'fictional-local-model',
    messages: [{ id: 'm0', role: 'user', content: 'Earlier', createdAt: now - 10 }, { id: 'm1', role: 'assistant', content: 'Earlier answer', createdAt: now - 5 }],
    mode: 'act', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now }] });
  await page.evaluate(() => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false,
      llmLocalEndpoint: location.origin + '/fictional-local/v1', llmLocalModelName: 'fictional-local-model', llmDefaultProvider: 'local' }));
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({ view: 'chat' }));
    sessionStorage.setItem('tc-chat-thread', 'fictional-thread');
  });
  await page.reload();

  const composer = page.getByRole('textbox', { name: 'Message to CaddyAI', exact: true });
  await composer.fill('Check the collector');
  await composer.press('Enter');
  const card = page.getByRole('group', { name: 'Send data outside ThreatCaddy?' });
  await expect(card).toBeVisible();
  const stop = page.getByTitle('Stop generating', { exact: true });
  const approve = card.getByRole('button', { name: 'Approve', exact: true });
  const reject = card.getByRole('button', { name: 'Reject', exact: true });

  // A mouse user scrolls over the visible part of the card to reach its buttons.
  async function reachButtonsFrom(hoverTarget: Locator) {
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(stop).toBeInViewport({ ratio: 1 });
    await expect(hoverTarget).toBeInViewport({ ratio: 1 });
    await hoverTarget.hover();
    await page.mouse.wheel(0, 600);
    await expect(approve).toBeInViewport({ ratio: 1 });
    await expect(reject).toBeInViewport({ ratio: 1 });
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(stop).toBeInViewport({ ratio: 1 });
  }

  await reachButtonsFrom(card.getByText('Send data outside ThreatCaddy?', { exact: true }));
  const details = card.getByText('Details', { exact: true });
  await details.click();
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await reachButtonsFrom(details);

  await reject.click();
  await expect(card).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
