import { test, expect } from '@playwright/test';
import { goToApp, openNewTaskForm } from './fixtures';

test('hosted startup and a lazy dialog have no CSP diagnostics or browser errors', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' || /content[- ]security[- ]policy|\bcsp\b/i.test(message.text())) {
      diagnostics.push(message.text());
    }
  });
  page.on('pageerror', error => diagnostics.push(error.message));

  await goToApp(page);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Views"]')).toBeVisible();
  await openNewTaskForm(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  // The dialog moves focus to its autoFocus field as it installs its keyboard handling.
  await expect(page.getByRole('dialog').locator('#task-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(diagnostics).toEqual([]);
});

// SITE-2: script-src lists the page's own inline scripts by hash, so injected
// markup cannot run an inline handler.
test('the hosted policy refuses injected inline handlers', async ({ page }) => {
  await goToApp(page);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const scriptSrc = policy?.split(';').map(part => part.trim()).find(part => part.startsWith('script-src ')) ?? '';
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/]+=*'/);
  const ran = await page.evaluate(() => new Promise<boolean>(resolve => {
    document.addEventListener('securitypolicyviolation', event => {
      document.documentElement.dataset.violatedDirective = event.effectiveDirective;
    }, { once: true });
    const image = document.createElement('img');
    // The attribute handler is registered first, so it would run before this listener.
    image.setAttribute('onerror', 'document.documentElement.dataset.injectedHandler = "ran"');
    image.addEventListener('error', () => {
      image.remove();
      resolve(document.documentElement.dataset.injectedHandler === 'ran');
    });
    image.src = 'data:,';
    document.body.append(image);
  }));
  expect(ran).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('data-violated-directive', /^script-src/);
});

// SITE-8: the build ships an RFC 9116 contact file.
test('security.txt is served from the well-known path', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await response.text()).toContain('Contact: https://github.com/peterhanily/threatcaddy/security/advisories/new');
});
