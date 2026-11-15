import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { goToApp, navigateToView } from './fixtures';

test('first-run demo links evidence to a qualified downloadable report without AI setup', async ({ page }) => {
  await goToApp(page);
  await navigateToView(page, 'Investigations');
  const guide = page.getByRole('region', { name: 'Start with a case, finish with a report' });
  await expect(guide.getByRole('button', { name: 'Create Investigation' })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Import source files' })).toBeVisible();
  await guide.getByRole('button', { name: 'Try the realistic demo' }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('START HERE — Mailbox Compromise Exercise');
  await page.getByRole('button', { name: 'Preview mode', exact: true }).click();
  const preview = page.locator('.markdown-preview');
  await preview.locator('[data-note-id="sample-realistic-note-2"]').click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Authentication Evidence — Mailbox Exercise');
  await preview.locator('[data-note-id="sample-realistic-note-4"]').click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Assessment and Gaps — Mailbox Exercise');
  await preview.locator('[data-note-id="sample-realistic-note-6"]').click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Draft Incident Report — Mailbox Exercise');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download note as Markdown file' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Report download did not produce a file');
  const content = readFileSync(path, 'utf8');
  expect(content).toContain('SYNTHETIC / TRAINING / DRAFT');
  expect(content).toContain('amount of exposed data and initial access method remain unknown');
  expect(content).toContain('[[Authentication Evidence — Mailbox Exercise]]');
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

test('both demos coexist, revisiting preserves edits, and removing the displayed demo preserves the other', async ({ page }) => {
  await page.goto('/?demo');
  await page.getByRole('button', { name: 'Start Exploring', exact: true }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('START HERE — Mailbox Compromise Exercise');
  await page.getByPlaceholder('Note title...').fill('My reviewed mailbox exercise');
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

  // A nonempty existing case makes stale-array selection validation observable:
  // importing the second demo must reload records before selecting its first note.
  await page.goto('/?demo=parody');
  const welcome = page.getByRole('dialog', { name: 'Welcome to ThreatCaddy' });
  await expect(welcome).toContainText('FERMENTED PERSISTENCE');
  await welcome.getByRole('button', { name: 'Start Exploring', exact: true }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Executive Summary — FERMENTED PERSISTENCE');
  await page.getByRole('button', { name: 'Preview mode', exact: true }).click();
  await page.locator('.markdown-preview [data-note-id="sample-note-2"]').click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('Initial Compromise — Prompt Injection via Slaw Advisor');

  await page.goto('/?demo');
  await expect(welcome).toContainText('Mailbox Compromise');
  await welcome.getByRole('button', { name: 'Start Exploring', exact: true }).click();
  await expect(page.getByPlaceholder('Note title...')).toHaveValue('My reviewed mailbox exercise');
  await page.goto('/?demo');
  await welcome.getByRole('button', { name: 'Delete Demo & Start Fresh', exact: true }).click();
  // Removal is permanent, so it always asks first; an edited title is not an added item.
  const confirm = page.getByRole('dialog', { name: 'Remove sample investigation?' });
  await expect(confirm).toContainText('including any changes you made, will be permanently deleted');
  await confirm.getByRole('button', { name: 'Remove sample', exact: true }).click();
  await navigateToView(page, 'Investigations');
  await expect(page.getByRole('group', { name: 'FERMENTED PERSISTENCE — OpenSlaw.ai Compromise (Sample)', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Mailbox Compromise — Synthetic Exercise', exact: true })).toHaveCount(0);
});
