import { test, expect } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';

const DEMO = 'Mailbox Compromise — Synthetic Exercise';

test('opening an investigation lands on its Overview, which links to the items it lists', async ({ page }) => {
  await goToApp(page);
  await navigateToView(page, 'Investigations');
  await page.getByRole('button', { name: 'Try the realistic demo' }).click();
  // The demo itself starts on its first note; opening the investigation from the hub lands on Overview.
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('START HERE — Mailbox Compromise Exercise');
  await navigateToView(page, 'Investigations');
  await page.getByRole('group', { name: DEMO, exact: true }).getByRole('button', { name: DEMO, exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: DEMO })).toBeVisible();
  await expect(page.locator('nav[aria-label="Views"]').getByRole('button', { name: 'Overview' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('threatcaddy-nav-state') ?? '{}').view)).toBe('overview');

  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention).toContainText('Open tasks: 3');
  await expect(attention.getByRole('button', { name: /Collect complete audit and delivery records/ })).toBeVisible();
  await expect(attention).not.toContainText('Record simulated session revocation and rule removal');

  const timeline = page.getByRole('region', { name: 'Latest on the timeline' });
  await expect(timeline).toContainText('Events: 6');
  await expect(timeline.getByRole('listitem').first()).toContainText('Simulated sessions revoked and rule removed');
  await expect(timeline.getByRole('listitem').first()).toContainText('analyst@example.test');

  const involved = page.getByRole('region', { name: 'Who and what is involved' });
  await expect(involved).toContainText('Identities: 3');
  await expect(involved.getByRole('button', { name: 'Exercise mailbox owner' })).toBeVisible();
  await expect(involved.getByRole('button', { name: 'Training workstation' })).toBeVisible();

  await expect(page.getByRole('region', { name: 'Indicators' })).toContainText('Unique IOCs:');
  await expect(page.getByRole('region', { name: 'Evidence' })).toContainText('Files: 2');

  // A task on the Overview opens that task in Tasks.
  await attention.getByRole('button', { name: /Review account recovery configuration with owner/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Task' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Review account recovery configuration with owner');
});

test('a new investigation opens on an Overview that offers the first actions', async ({ page }) => {
  await goToApp(page);
  await navigateToView(page, 'Investigations');
  await page.getByRole('button', { name: /New Investigation/i }).click();
  await page.getByPlaceholder('e.g. Operation Midnight Storm').fill('Empty Case');
  await page.getByLabel('New Investigation').getByRole('button', { name: /Create Investigation/i }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Empty Case' })).toBeVisible();
  const empty = page.getByRole('region', { name: 'Nothing in this investigation yet' });
  await expect(empty.getByRole('button', { name: 'Import source files' })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Add an event' })).toBeVisible();
  await empty.getByRole('button', { name: 'Add a note' }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Untitled Note');
});
