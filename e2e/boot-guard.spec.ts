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
