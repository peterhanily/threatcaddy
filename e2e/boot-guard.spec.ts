import { test, expect } from '@playwright/test';
import { waitForAppReady } from './fixtures';

// SITE-6: GitHub Pages cannot send frame-ancestors, so the page itself refuses
// to run inside another site's frame and offers to open it in the top window.
test('the hosted app does not run inside another site and opens in the top window on request', async ({ page, baseURL }) => {
  const app = new URL('/', baseURL);
  // The guard refuses any parent. The privacy page has no policy against
  // frames, and as a page of the local preview it may frame the app without
  // Chromium's local network checks blocking the frame.
  await page.goto(new URL('/privacy.html', app).href);
  await page.evaluate(src => {
    const frame = document.createElement('iframe');
    frame.src = src;
    frame.style.cssText = 'width:900px;height:600px';
    document.body.prepend(frame);
  }, app.href);
  const frame = page.frameLocator('iframe');
  const open = frame.getByRole('link', { name: 'Open ThreatCaddy', exact: true });
  await expect(open).toBeVisible();
  await expect(frame.getByText('For your safety, ThreatCaddy does not run inside another website.', { exact: true })).toBeVisible();
  await expect(open).toHaveAttribute('target', '_top');
  await expect(frame.locator('[data-tour="header"]')).toHaveCount(0);
  await expect(frame.locator('#root')).toHaveCount(0);
  await open.click();
  await expect(page).toHaveURL(app.href);
  await waitForAppReady(page);
});

// The privacy page is dark (#0f1117): the notice must paint its own opaque
// background, and stay readable in the browser's light and dark schemes.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the framed notice is readable in the ${colorScheme} colour scheme`, async ({ page, baseURL }) => {
    const app = new URL('/', baseURL);
    await page.emulateMedia({ colorScheme });
    await page.goto(new URL('/privacy.html', app).href);
    await page.evaluate(src => {
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.style.cssText = 'width:900px;height:600px';
      document.body.prepend(frame);
    }, app.href);
    await expect(page.frameLocator('iframe').getByRole('link', { name: 'Open ThreatCaddy', exact: true })).toBeVisible();
    const frame = page.frames().find(candidate => candidate !== page.mainFrame());
    const measured = await frame?.evaluate(() => {
      const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = ([r, g, b]: number[]) => {
        const [red, green, blue] = [r, g, b].map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const background = channels(getComputedStyle(document.body).backgroundColor);
      const contrast = (selector: string) => {
        const [light, dark] = [luminance(channels(getComputedStyle(document.querySelector(selector) as Element).color)), luminance(background)].sort((a, b) => b - a);
        return Math.round(((light + 0.05) / (dark + 0.05)) * 10) / 10;
      };
      return { opaque: (background[3] ?? 1) === 1, text: contrast('p'), link: contrast('a') };
    });
    expect(measured?.opaque).toBe(true);
    // WCAG AA for normal text.
    expect(measured?.text).toBeGreaterThanOrEqual(4.5);
    expect(measured?.link).toBeGreaterThanOrEqual(4.5);
  });
}
