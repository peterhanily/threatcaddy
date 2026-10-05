import { test, expect, type Page } from '@playwright/test';
import { goToApp, createInvestigation, navigateToView, createQuickNote, getSidebar } from './fixtures';

test.describe('Tags', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('create a tag on a note and see it in the sidebar', async ({ page }) => {
    await createInvestigation(page, 'Tag Test Case');
    await navigateToView(page, 'Notes');

    // Create a note
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Tagged Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Find the tag input in the note editor footer
    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await expect(tagInput.first()).toBeVisible({ timeout: 5_000 });
    await tagInput.first().fill('phishing');
    await tagInput.first().press('Enter');

    // Wait for the tag to be created and saved
    await page.waitForTimeout(1_500);

    // The tag pill should appear in the note editor
    await expect(page.getByText('phishing').first()).toBeVisible({ timeout: 5_000 });

    // The tag should also appear in the sidebar tag list
    const sidebar = getSidebar(page);

    // Expand the Tags section if collapsed
    const tagsToggle = sidebar.getByText('Tags');
    if (await tagsToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Tags section exists — check if it has the tag
      await expect(sidebar.getByText('phishing')).toBeVisible({ timeout: 5_000 });
    }
  });

  test('create multiple tags on a note', async ({ page }) => {
    await createInvestigation(page, 'Multi Tag Test');
    await navigateToView(page, 'Notes');

    // Create a note
    await createQuickNote(page);

    const titleInput = page.getByPlaceholder('Note title...');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('Multi-tagged Note');

    // Wait for auto-save
    await page.waitForTimeout(1_500);

    // Add first tag
    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await tagInput.first().fill('malware');
    await tagInput.first().press('Enter');
    await page.waitForTimeout(500);

    // Add second tag
    await tagInput.first().fill('c2-traffic');
    await tagInput.first().press('Enter');
    await page.waitForTimeout(1_500);

    // Both tag pills should be visible in the note editor
    await expect(page.getByText('malware').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('c2-traffic').first()).toBeVisible({ timeout: 5_000 });

    // Both tags should appear in the sidebar
    const sidebar = getSidebar(page);
    await expect(sidebar.getByText('malware')).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByText('c2-traffic')).toBeVisible({ timeout: 5_000 });
  });

  test('filter notes by clicking a tag in the sidebar', async ({ page }) => {
    await createInvestigation(page, 'Tag Filter Test');
    await navigateToView(page, 'Notes');

    // Create first note with a tag
    await createQuickNote(page);
    const titleInput1 = page.getByPlaceholder('Note title...');
    await expect(titleInput1).toBeVisible({ timeout: 5_000 });
    await titleInput1.fill('Ransomware Analysis');
    await expect(page.getByRole('heading', { name: 'Ransomware Analysis', exact: true })).toBeVisible();

    const tagInput = page.getByRole('combobox', { name: /add tag/i }).or(
      page.getByPlaceholder('Add tag...')
    );
    await tagInput.first().fill('ransomware');
    await tagInput.first().press('Enter');
    const sidebar = getSidebar(page);
    const sidebarTag = sidebar.getByText('ransomware', { exact: true });
    await expect(sidebarTag).toBeVisible();
    const taggedNoteCard = page.getByRole('heading', { name: 'Ransomware Analysis', exact: true }).locator('../..');
    await expect(taggedNoteCard.getByText('ransomware', { exact: true })).toBeVisible();

    // Create second note without the tag
    await createQuickNote(page);
    const titleInput2 = page.getByPlaceholder('Note title...');
    await expect(titleInput2).toBeVisible({ timeout: 5_000 });
    await titleInput2.fill('Unrelated Finding');

    // Both notes should be visible
    await expect(page.getByText('Ransomware Analysis')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Unrelated Finding')).toBeVisible({ timeout: 5_000 });

    // Click the ransomware tag in the sidebar to filter
    await sidebarTag.click();

    // After filtering, only the tagged note should be visible.
    await expect(page.getByRole('heading', { name: 'Ransomware Analysis', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unrelated Finding', exact: true })).not.toBeVisible();

    // Reload resets the transient filter. Verify both titles and tag membership
    // persisted, including the note that was hidden by the filter.
    await page.reload();
    await expect(sidebarTag).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ransomware Analysis', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unrelated Finding', exact: true })).toBeVisible();
    await sidebarTag.click();
    await expect(page.getByRole('heading', { name: 'Ransomware Analysis', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unrelated Finding', exact: true })).not.toBeVisible();
  });
});

/** Fictional persisted fixtures avoid save-delay assumptions in keyboard tests. */
async function seedKeyboardTags(page: Page, singleTag = false) {
  await page.evaluate(async singleTag => {
    const now = Date.now();
    const tags = [
      { id: 'keyboard-alpha', name: 'tag-alpha', color: '#a855f7' },
      ...(singleTag ? [] : [{ id: 'keyboard-bravo', name: 'tag-bravo', color: '#22c55e' }]),
    ];
    const notes = tags.map((tag, index) => ({
      id: `keyboard-note-${tag.id}`, folderId: 'keyboard-folder',
      title: index === 0 ? 'Alpha tagged note' : 'Bravo tagged note',
      content: 'Fictional note for keyboard regression checks.', tags: [tag.name],
      pinned: false, archived: false, trashed: false, createdAt: now, updatedAt: now,
    }));
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open('ThreatCaddyDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['folders', 'tags', 'notes'], 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
        transaction.objectStore('folders').put({
          id: 'keyboard-folder', name: 'Tag keyboard investigation', order: 0,
          status: 'active', createdAt: now, updatedAt: now,
        });
        tags.forEach(tag => transaction.objectStore('tags').put(tag));
        notes.forEach(note => transaction.objectStore('notes').put(note));
      };
    });
    sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({
      view: 'notes', selectedFolderId: 'keyboard-folder',
    }));
  }, singleTag);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
}

test.describe('Tag keyboard accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await goToApp(page);
  });

  test('delete Enter and Space do not select a tag or change the investigation, and cancel restores focus', async ({ page }) => {
    const diagnostics: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && /cannot be a descendant|cannot contain a nested|validateDOMNesting/i.test(message.text())) {
        diagnostics.push(message.text());
      }
    });
    await seedKeyboardTags(page);
    const sidebar = getSidebar(page);
    const alpha = sidebar.getByRole('button', { name: 'tag-alpha', exact: true });
    const removeBravo = sidebar.getByRole('button', { name: 'Delete tag tag-bravo', exact: true });

    await expect(sidebar.locator('button button')).toHaveCount(0);
    await removeBravo.focus();
    await removeBravo.press('Enter');
    const confirmation = page.getByRole('dialog', { name: 'Delete Tag', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(removeBravo).toBeFocused();
    await expect(page.locator('[data-tour="search"]')).toHaveAttribute('title', /Tag keyboard investigation/);
    await expect(alpha).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).toBeVisible();

    await alpha.focus();
    await alpha.press('Space');
    await expect(alpha).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).not.toBeVisible();
    await removeBravo.focus();
    await removeBravo.press('Space');
    await expect(confirmation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmation).not.toBeVisible();
    await expect(removeBravo).toBeFocused();
    await expect(alpha).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).not.toBeVisible();
    expect(diagnostics).toEqual([]);
  });

  test('keyboard rename can cancel or commit while retaining the active tag filter', async ({ page }) => {
    await seedKeyboardTags(page);
    const sidebar = getSidebar(page);
    const alpha = sidebar.getByRole('button', { name: 'tag-alpha', exact: true });
    await alpha.focus();
    await alpha.press('Enter');
    await expect(alpha).toHaveAttribute('aria-pressed', 'true');
    const rename = sidebar.getByRole('button', { name: 'Rename tag tag-alpha', exact: true });
    await rename.focus();
    await rename.press('Space');
    const input = sidebar.getByRole('textbox', { name: 'New name for tag tag-alpha', exact: true });
    await expect(input).toBeFocused();
    await input.fill('discarded-name');
    await input.press('Escape');
    await expect(input).not.toBeVisible();
    await expect(rename).toBeFocused();
    await expect(alpha).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.getByRole('button', { name: 'discarded-name', exact: true })).toHaveCount(0);

    await rename.focus();
    await rename.press('Enter');
    await input.fill('  tag-renamed  ');
    await input.press('Enter');
    const renamed = sidebar.getByRole('button', { name: 'tag-renamed', exact: true });
    await expect(renamed).toBeVisible();
    await expect(renamed).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.getByRole('button', { name: 'Rename tag tag-renamed', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).not.toBeVisible();

    await page.reload();
    await expect(renamed).toBeVisible();
    await renamed.focus();
    await renamed.press('Space');
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).not.toBeVisible();
  });

  test('blank and case-insensitive duplicate names stay editable without changing the filter', async ({ page }) => {
    await seedKeyboardTags(page);
    const sidebar = getSidebar(page);
    await sidebar.getByRole('button', { name: 'tag-alpha', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Rename tag tag-alpha', exact: true }).click();
    const input = sidebar.getByRole('textbox', { name: 'New name for tag tag-alpha', exact: true });
    await input.fill(' TAG-BRAVO ');
    await input.press('Enter');
    await expect(sidebar.getByRole('alert')).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('   ');
    await input.press('Enter');
    await expect(sidebar.getByRole('alert')).toBeVisible();
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(sidebar.getByRole('button', { name: 'tag-alpha', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.getByRole('button', { name: 'tag-bravo', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bravo tagged note', exact: true })).not.toBeVisible();
  });

  test('confirmed removal of the last tag restores focus to Tags and clears only that filter', async ({ page }) => {
    await seedKeyboardTags(page, true);
    const sidebar = getSidebar(page);
    await sidebar.getByRole('button', { name: 'tag-alpha', exact: true }).click();
    const remove = sidebar.getByRole('button', { name: 'Delete tag tag-alpha', exact: true });
    await remove.focus();
    await remove.press('Space');
    const confirmation = page.getByRole('dialog', { name: 'Delete Tag', exact: true });
    const confirm = confirmation.getByRole('button', { name: 'Delete Tag', exact: true });
    await confirm.focus();
    await confirm.press('Enter');
    await expect(confirmation).not.toBeVisible();
    await expect(remove).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Tags', exact: true })).toBeFocused();
    await expect(sidebar.getByText('No tags yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await page.reload();
    await expect(sidebar.getByText('No tags yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alpha tagged note', exact: true })).toBeVisible();
    await expect(page.getByText('tag-alpha', { exact: true })).toHaveCount(0);
  });
});
