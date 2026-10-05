import { test, expect, type Page } from '@playwright/test';
import { goToApp, getSidebar } from './fixtures';

async function readStoredConfiguration(page: Page) {
  return page.evaluate(() => new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const request = window.indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('installedIntegrations', 'readonly');
      const read = transaction.objectStore('installedIntegrations').get('config-fixture-installation');
      read.onsuccess = () => resolve(read.result?.config);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function openFixtureConfiguration(page: Page) {
  await getSidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Integrations', exact: true });
  await expect(panel.getByText('Local configuration fixture', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Configure', exact: true }).click();
  return panel;
}

for (const multiple of [false, true]) {
  test(`integration config validates accessibly and preserves zero/false/${multiple ? 'array' : 'legacy scalar'} values`, async ({ page }) => {
    // Configuring this disabled fixture never runs an integration or contacts a
    // provider. Stub the settings panel's unrelated community-catalog lookup.
    await page.route('https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/catalog.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ entries: [] }),
    }));
    await goToApp(page);
    const regions = multiple ? ['north', 'south'] : 'north';
    await page.evaluate(async regions => {
      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open('ThreatCaddyDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['integrationTemplates', 'installedIntegrations'], 'readwrite');
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
          transaction.objectStore('integrationTemplates').put({
            id: 'config-fixture-template', schemaVersion: '1.0', version: '1.0.0',
            name: 'Local configuration fixture', description: 'Fictional local configuration test.',
            author: 'Test', icon: 'settings', color: '#a855f7', category: 'utility', tags: [],
            triggers: [{ type: 'manual' }], steps: [], outputs: [], requiredDomains: [], source: 'user',
            configSchema: [
              { key: 'apiKey', label: 'Fixture API key', type: 'password', required: true, secret: true },
              { key: 'limit', label: 'Fixture limit', type: 'number', required: true },
              { key: 'enabled', label: 'Fixture option', type: 'boolean', required: true },
              { key: 'regions', label: 'Fixture regions', type: 'multi-select', required: true, options: [
                { label: 'North', value: 'north' }, { label: 'South', value: 'south' },
              ] },
            ],
            createdAt: 0, updatedAt: 0,
          });
          transaction.objectStore('installedIntegrations').put({
            id: 'config-fixture-installation', templateId: 'config-fixture-template',
            name: 'Local configuration fixture', enabled: false,
            config: { limit: 0, enabled: false, regions }, scopeType: 'all', scopeFolderIds: [],
            runCount: 0, errorCount: 0, createdAt: 0, updatedAt: 0,
          });
        };
      });
    }, regions);
    await page.reload();
    const panel = await openFixtureConfiguration(page);
    const apiKey = panel.getByLabel(/^Fixture API key/);
    const limit = panel.getByRole('spinbutton', { name: 'Fixture limit', exact: true });
    const option = panel.getByRole('switch', { name: 'Fixture option', exact: true });
    const regionSelect = panel.getByRole(multiple ? 'listbox' : 'combobox', { name: 'Fixture regions', exact: true });
    const save = panel.getByRole('button', { name: 'Save', exact: true });

    await expect(limit).toHaveValue('0');
    await expect(option).toHaveAttribute('aria-checked', 'false');
    if (multiple) await expect(regionSelect).toHaveValues(['north', 'south']);
    else await expect(regionSelect).toHaveValue('north');
    await save.click();
    await expect(apiKey).toBeFocused();
    await expect(apiKey).toHaveAttribute('aria-invalid', 'true');
    await expect(apiKey).toHaveAccessibleDescription('Fixture API key is required.');
    await expect(panel.getByText('Fixture API key is required.', { exact: true })).toBeVisible();
    await apiKey.fill('   ');
    await save.click();
    await expect(apiKey).toBeFocused();
    await expect(apiKey).toHaveAttribute('aria-invalid', 'true');
    expect(await readStoredConfiguration(page)).toEqual({ limit: 0, enabled: false, regions });

    const fictionalKey = 'fictional-local-fixture-key';
    await apiKey.fill(fictionalKey);
    await expect(apiKey).toHaveAttribute('type', 'password');
    await expect(apiKey).not.toHaveAttribute('aria-invalid', 'true');
    await save.click();
    await expect(apiKey).toHaveCount(0);
    await expect.poll(() => readStoredConfiguration(page)).toEqual({ apiKey: fictionalKey, limit: 0, enabled: false, regions });

    await page.reload();
    const reopened = await openFixtureConfiguration(page);
    await expect(reopened.getByLabel(/^Fixture API key/)).toHaveValue(fictionalKey);
    await expect(reopened.getByLabel(/^Fixture API key/)).toHaveAttribute('type', 'password');
    await expect(reopened.getByRole('spinbutton', { name: 'Fixture limit', exact: true })).toHaveValue('0');
    await expect(reopened.getByRole('switch', { name: 'Fixture option', exact: true })).toHaveAttribute('aria-checked', 'false');
    if (multiple) await expect(reopened.getByRole('listbox', { name: 'Fixture regions', exact: true })).toHaveValues(['north', 'south']);
    else await expect(reopened.getByRole('combobox', { name: 'Fixture regions', exact: true })).toHaveValue('north');
  });
}
