import { expect, test } from '@playwright/test';
import { getSidebar } from './fixtures';
import { readRows, seedRows } from './client-lifecycle-fixtures';

// Only HTTP/WebSocket responses are simulated. Sharing, catalog rendering,
// compiler validation and IndexedDB installation use the production client.
test.use({ serviceWorkers: 'block' });

function definition(id: string, name: string) {
  return { id, name, schemaVersion: '1.0', version: '1.0.0', description: 'Fictional inert team fixture.',
    author: 'Fictional analyst', icon: '', color: '#123456', category: 'utility', tags: [], source: 'user',
    triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [], createdAt: 1, updatedAt: 1 };
}

test('team sharing preserves local data on rejection, then lists and installs valid templates', async ({ page, context, baseURL }, testInfo) => {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('A loopback test origin is required');
  const origin = new URL(baseURL).origin;
  const prefix = '/fictional-integration-team';
  const local = definition('fictional-local-template', 'Fictional local integration');
  const remote = definition('fictional-remote-template', 'Fictional team integration');
  const unsafe = definition('../../users/fictional-victim', 'Unsafe legacy template');
  const rows = [remote, unsafe, { ...definition('invalid-legacy', 'Invalid legacy template'), triggers: [] }]
    .map(template => ({ id: template.id, name: template.name, template, sharedBy: 'fictional-colleague' }));
  const unexpected: string[] = [];
  const errors: string[] = [];
  const shares: unknown[] = [];
  let rejectShare = true;
  let unavailable = false;
  const deletes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket(/.*/, socket => {
    socket.onMessage(message => {
      if (typeof message === 'string' && JSON.parse(message).type === 'auth') socket.send(JSON.stringify({ type: 'auth-ok' }));
    });
  });
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(url.origin); await route.abort(); return; }
    if (!url.pathname.startsWith(prefix + '/')) { await route.continue(); return; }
    const path = url.pathname.slice(prefix.length);
    if (request.method() === 'DELETE') {
      deletes.push(path);
      expect(path).toBe('/api/integrations/templates/' + remote.id);
      await route.fulfill({ json: { ok: true } }); return;
    }
    if (path === '/api/integrations/templates') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        shares.push(body);
        expect(body).toEqual({ template: local });
        if (rejectShare) await route.fulfill({ status: 400, json: { error: 'Fictional template rejected by team server' } });
        else {
          const row = { id: local.id, name: local.name, template: local, sharedBy: 'fictional-analyst' };
          rows.push(row);
          await route.fulfill({ status: 201, json: { template: row } });
        }
      } else if (unavailable) await route.fulfill({ status: 503, json: { error: 'Synthetic unavailable' } });
      else await route.fulfill({ json: { templates: rows } });
      return;
    }
    let body: unknown;
    if (path === '/api/server/info') body = { serverName: 'Fictional integration transport' };
    else if (['/api/notifications', '/api/audit/team'].includes(path)) body = [];
    else if (path === '/api/investigations') body = { data: [], total: 0, offset: 0, limit: 50 };
    else if (path === '/api/saved-searches') body = { searches: [] };
    else if (path === '/api/llm/config') body = { providers: [] };
    else if (path === '/api/sync/pull') body = { changes: [], serverTimestamp: new Date().toISOString(), cursor: '0',
      generation: '11111111-2222-4333-8444-555555555555', hasMore: false };
    else { unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: { error: 'Unconfigured fictional endpoint' } }); return; }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(prefix => {
    localStorage.setItem('caddyshack-onboarded', '1');
    localStorage.setItem('caddyai-onboarded', '1');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'en', tiAutoExtractEnabled: false }));
    localStorage.setItem('threatcaddy-auth', JSON.stringify({ serverUrl: location.origin + prefix,
      accessToken: 'fictional-not-a-credential', refreshToken: 'fictional-not-a-refresh-credential',
      user: { id: 'fictional-analyst', email: 'fictional@example.invalid', displayName: 'Fictional analyst', role: 'analyst' } }));
  }, prefix);
  await page.goto('/');
  await expect(page.locator('[data-tour="header"]')).toBeVisible();
  const welcome = page.getByRole('dialog', { name: /^Welcome to / });
  await welcome.getByRole('button', { name: 'Get Started', exact: true }).click();
  await seedRows(page, {
    integrationTemplates: [local],
    installedIntegrations: [{ id: 'fictional-local-installation', templateId: local.id, name: local.name, enabled: false,
      config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 }],
  });
  await getSidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Integrations', exact: true });
  await expect(panel.getByText(local.name, { exact: true })).toBeVisible();
  const tables = ['integrationTemplates', 'installedIntegrations', 'integrationRuns', 'tasks'];
  const before = await readRows(page, tables);
  await panel.getByTitle('Share with Team', { exact: true }).click();
  await expect(page.getByText('Fictional template rejected by team server', { exact: true })).toBeVisible();
  expect(await readRows(page, tables)).toEqual(before);
  expect(rows).toHaveLength(3);

  rejectShare = false;
  await panel.getByTitle('Share with Team', { exact: true }).click();
  await expect(page.getByText('Template shared with team', { exact: true })).toBeVisible();
  expect(shares).toHaveLength(2);
  expect(await readRows(page, tables)).toEqual(before);
  await panel.getByRole('button', { name: /^Catalog/ }).click();
  const remoteCard = panel.locator('div.bg-gray-800.rounded-lg').filter({ hasText: remote.name })
    .filter({ has: page.getByTitle('Remove from team', { exact: true }) });
  await expect(remoteCard).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveText('Some team templates are invalid and were not loaded.');
  await expect(panel.getByText(unsafe.name, { exact: true })).toHaveCount(0);
  unavailable = true;
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Team templates could not be loaded. Check your connection and refresh.');
  await expect(panel.getByText(/No team templates/)).toHaveCount(0);
  unavailable = false;
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(remoteCard).toBeVisible();
  await remoteCard.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByText(`Installed ${remote.name} from team`, { exact: true })).toBeVisible();
  const after = await readRows(page, tables);
  expect(after.integrationTemplates).toHaveLength(2);
  expect(after.integrationTemplates.find(template => template.id === local.id)).toEqual(local);
  expect(after.integrationTemplates.find(template => template.id === remote.id)).toEqual({ ...remote, source: 'team' });
  expect(after.installedIntegrations).toHaveLength(2);
  expect(after.integrationRuns).toEqual(before.integrationRuns);
  expect(after.tasks).toEqual(before.tasks);
  await panel.getByRole('button', { name: /^Installed/ }).click();
  const installedCard = panel.locator('div.bg-gray-800.border.border-gray-700.rounded-lg.p-3').filter({ hasText: remote.name });
  await installedCard.getByTitle('Delete', { exact: true }).click();
  await expect.poll(async () => (await readRows(page, ['installedIntegrations'])).installedIntegrations.length).toBe(1);
  await panel.getByRole('button', { name: /^Catalog/ }).click();
  await remoteCard.getByRole('button', { name: 'Install', exact: true }).click();
  await expect.poll(async () => (await readRows(page, ['installedIntegrations'])).installedIntegrations.length).toBe(2);
  expect((await readRows(page, ['integrationTemplates'])).integrationTemplates).toHaveLength(2);
  await remoteCard.getByTitle('Remove from team', { exact: true }).click();
  await expect(remoteCard).toHaveCount(0);
  expect(deletes).toEqual(['/api/integrations/templates/' + remote.id]);
  await page.screenshot({ path: testInfo.outputPath('team-template-installed.png'), animations: 'disabled' });
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
