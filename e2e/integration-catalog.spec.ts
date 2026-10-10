import { test, expect, type Page } from '@playwright/test';
import { goToApp, getSidebar } from './fixtures';

// Keep mocked catalog requests on the page route instead of a service worker.
// Real service-worker/offline behavior is covered separately in offline.spec.ts.
test.use({ serviceWorkers: 'block' });

const catalogUrl = 'https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/catalog.json';
const entry = {
  id: 'catalog-runtime-fixture', name: 'Fictional catalog runtime fixture', description: 'Local test response only.',
  author: 'Test', category: 'utility', tags: ['test'], icon: 'test', color: '#123456',
  version: '1.0.0', downloads: 0, templateUrl: 'https://example.test/template.json', sha256: '', updatedAt: '2026-10-05',
};

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
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByText(custom.name, { exact: true })).toBeVisible();
  expect(requests).toBe(2);
});
