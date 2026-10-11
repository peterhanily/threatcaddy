// Installed Chrome/Firefox, disposable profiles, synthetic local storage only.
// No native permission requests/grants, app connections or provider traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withClipRuntime, until } from './verify-clip-delivery-runtime.mjs';

const browser = process.argv[2] || 'chrome';
const locale = process.argv[3] || 'en-US';
assert.ok(['chrome', 'firefox'].includes(browser));
assert.ok(['en-US', 'ar'].includes(locale));

async function useArabicCatalog(page) {
  // Explicit presentation fixture only: native browser locale may not be installed.
  // Storage, background commands, permissions and keyboard input remain real.
  const catalog = JSON.parse(await readFile(new URL(`../extension/dist/${browser}/_locales/ar/messages.json`, import.meta.url), 'utf8'));
  await page.evaluate(async catalog => {
    chrome.i18n.getUILanguage = () => 'ar';
    chrome.i18n.getMessage = (key, substitutions = []) => {
      if (key === '@@bidi_dir') return 'rtl';
      const entry = catalog[key];
      if (!entry) return '';
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return entry.message.replace(/\$([a-z_]+)\$/gi, (_match, name) => {
        const value = entry.placeholders?.[name.toLowerCase()]?.content || '';
        return value.replace(/\$(\d+)/g, (_token, number) => String(values[Number(number) - 1] ?? ''));
      });
    };
    globalThis.TC_UI.localize();
    if (typeof refresh === 'function') await refresh();
    if (typeof loadLocalAIApproval === 'function') await loadLocalAIApproval();
  }, catalog);
}

await withClipRuntime(browser, async ({ runtime, root, check }) => {
  const popup = await runtime.newPage();
  await popup.goto(runtime.extensionOrigin + '/popup.html');
  const before = await popup.evaluate(async () => ({ permissions: await chrome.permissions.getAll(), language: chrome.i18n.getUILanguage() }));
  console.log('Requested and actual UI locale:', locale, before.language);
  const catalogFixture = locale === 'ar' && !before.language.toLowerCase().startsWith('ar');
  const mode = catalogFixture ? 'Arabic catalog-backed presentation fixture; native browser UI locale unchanged' : 'Native browser UI locale';
  console.log('Locale qualification mode:', mode);
  await writeFile(join(root, 'locale-mode.json'), JSON.stringify({ requested: locale, actual: before.language, mode }, null, 2));
  if (catalogFixture) await useArabicCatalog(popup);
  const effectiveLanguage = catalogFixture ? 'ar' : before.language;
  const expectedDirection = locale === 'ar' ? 'rtl' : 'ltr';
  for (const width of [320, 390]) {
    await popup.setViewport(width, 900);
    const layout = await popup.evaluate(() => ({ language: document.documentElement.lang, direction: document.documentElement.dir,
      overflow: document.documentElement.scrollWidth > innerWidth,
      controls: ['save-btn', 'options-toggle', 'settings-btn'].map(id => ({ id, height: document.getElementById(id).getBoundingClientRect().height })),
      names: ['capture-title', 'capture-text', 'ai-perm-toggle', 'url-perm-toggle'].map(id => document.getElementById(id).getAttribute('aria-label')),
      privacy: document.querySelector('[data-i18n="privacyText"]').textContent === chrome.i18n.getMessage('privacyText'),
    }));
    assert.equal(layout.direction, expectedDirection); assert.equal(layout.language, effectiveLanguage.replaceAll('_', '-'));
    assert.equal(layout.overflow, false); assert.ok(layout.controls.every(control => control.height >= 44));
    assert.ok(layout.names.every(Boolean)); assert.equal(layout.privacy, true);
  }
  check('Popup ' + mode + ', named controls, 44px targets and 320/390px bounds');

  await popup.fill('#capture-title', 'Fictional keyboard capture');
  await popup.fill('#capture-text', 'Local synthetic capture with café and 🙂.');
  await popup.click('#save-btn');
  await until(() => popup.evaluate(async () => (await chrome.storage.local.get('captures')).captures?.length === 1), 'real quick capture saved');
  assert.equal(await popup.evaluate(() => document.getElementById('capture-text').value), '');
  await popup.evaluate(() => document.getElementById('settings-btn').focus()); await popup.press('Enter');
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'settings-back');
  await until(() => popup.evaluate(() => document.getElementById('settings-notification-status').textContent.length > 0), 'passive notification feedback');
  await popup.evaluate(() => document.getElementById('settings-revoke-apps').focus()); await popup.press('Enter');
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'modal-cancel');
  await popup.press('Escape');
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'settings-revoke-apps');
  assert.equal(await popup.evaluate(() => document.getElementById('settings-page').inert), false);
  check('Popup native keyboard navigation and revocation cancellation restore focus');
  await popup.screenshot(join(root, 'popup-settings-' + locale + '.png'));

  const seeded = await popup.evaluate(async () => chrome.runtime.sendMessage({ type: 'SAVE_NOTE', note: {
    title: 'Second fictional capture', content: 'Synthetic ' + 'long content '.repeat(100), sourceUrl: '', sourceTitle: '',
    entityType: 'note', folderName: 'Fictional "café" ' + 'long name '.repeat(12), clsLevel: 'TLP:CLEAR',
  } }));
  assert.equal(seeded.success, true);
  const clips = await runtime.newPage(); await clips.goto(runtime.extensionOrigin + '/pages/clips.html');
  if (catalogFixture) await useArabicCatalog(clips);
  await until(() => clips.evaluate(() => document.querySelectorAll('.capture-card').length === 2), 'two real captured cards');
  for (const width of [320, 390]) {
    await clips.setViewport(width, 900);
    const layout = await clips.evaluate(() => ({ direction: document.documentElement.dir, overflow: document.documentElement.scrollWidth > innerWidth,
      text: document.querySelector('h1').textContent === chrome.i18n.getMessage('clipReview'),
      controls: [...document.querySelectorAll('.controls-bar button, .settings-row button, button.meta-badge, .capture-delete-btn')]
        .map(element => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })),
      inputRows: [...document.querySelectorAll('.settings-row input')].map(element => ({
        width: element.getBoundingClientRect().width, row: element.closest('.settings-row').getBoundingClientRect().width,
      })),
    }));
    assert.equal(layout.direction, expectedDirection); assert.equal(layout.overflow, false); assert.equal(layout.text, true);
    assert.ok(layout.controls.every(control => control.height >= 44 && control.width > 0));
    assert.ok(layout.inputRows.every(input => Math.abs(input.width - input.row) < 1), 'Narrow URL inputs must occupy a usable full row, not shrink beside translated buttons');
  }
  check('Clip Review ' + mode + ' and long-content layout fit320/390px without overflow');

  await clips.evaluate(() => document.querySelector('.capture-delete-btn').focus()); await clips.press('Enter');
  assert.deepEqual(await clips.evaluate(() => ({ focus: document.activeElement.id, inert: document.querySelector('.container').inert,
    role: document.querySelector('.modal').getAttribute('role'), described: document.querySelector('.modal').getAttribute('aria-describedby') })),
  { focus: 'modal-cancel', inert: true, role: 'dialog', described: 'modal-message' });
  await clips.press('Shift+Tab'); assert.equal(await clips.evaluate(() => document.activeElement.id), 'modal-confirm');
  await clips.press('Tab'); assert.equal(await clips.evaluate(() => document.activeElement.id), 'modal-cancel');
  await clips.press('Enter');
  assert.equal(await clips.evaluate(() => document.activeElement.className), 'capture-delete-btn');
  assert.equal(await clips.evaluate(async () => (await chrome.storage.local.get('captures')).captures.length), 2);
  check('Delete dialog native Enter cancels by default, traps Tab and restores focus without mutation');

  await clips.press('Enter'); await clips.press('Shift+Tab');
  await clips.screenshot(join(root, 'clip-confirmation-' + locale + '.png'));
  await clips.press('Enter');
  await until(() => clips.evaluate(async () => (await chrome.storage.local.get('captures')).captures.length === 1), 'explicit delete committed');
  await until(() => clips.evaluate(() => document.activeElement.id === 'refresh-btn'), 'removed opener focus fallback');
  assert.equal(await clips.evaluate(() => document.querySelector('.container').inert), false);
  check('Explicit confirmed delete commits once and focuses stable Refresh control');

  await clips.evaluate(() => document.querySelector('button.meta-badge').focus()); await clips.press('Enter');
  assert.equal(await clips.evaluate(() => document.activeElement.getAttribute('aria-label') === chrome.i18n.getMessage('saveAs')), true);
  await clips.fill('.meta-inline-edit input', 'Fictional updated investigation'); await clips.press('Enter');
  await until(() => clips.evaluate(async () => (await chrome.storage.local.get('captures')).captures[0].folderName === 'Fictional updated investigation'), 'real metadata edit committed');
  assert.equal(await clips.evaluate(() => document.querySelectorAll('.capture-card').length), 1);
  await until(() => clips.evaluate(() => document.querySelector('.meta-inline-edit').getAttribute('aria-busy') === 'false'), 'metadata write finished');
  await clips.evaluate(() => { const button = document.querySelector('button.meta-badge'); if (button.getAttribute('aria-expanded') !== 'true') button.click(); });
  await clips.fill('.meta-inline-edit input', 'Fictional unsent metadata draft');
  const concurrent = await popup.evaluate(async () => {
    const capture = (await chrome.storage.local.get('captures')).captures[0];
    return chrome.runtime.sendMessage({ type: 'UPDATE_CAPTURES', clips: [{ id: capture.id, revision: capture.revision }], values: { folderName: 'Fictional separately saved metadata' } });
  });
  assert.equal(concurrent.success, true);
  await clips.press('Enter');
  await until(() => clips.evaluate(() => document.querySelector('.toast.error') && !document.querySelector('.discard-metadata-draft').disabled), 'stale metadata refusal');
  const savedBeforeDiscard = await popup.evaluate(async () => (await chrome.storage.local.get('captures')).captures);
  await clips.evaluate(() => document.querySelector('.discard-metadata-draft').focus()); await clips.press('Enter');
  assert.equal(await clips.evaluate(() => document.activeElement.id), 'modal-cancel');
  await clips.press('Enter');
  assert.equal(await clips.evaluate(() => document.querySelector('.meta-inline-edit input').value), 'Fictional unsent metadata draft');
  await clips.press('Enter'); await clips.press('Shift+Tab'); await clips.press('Enter');
  await until(() => clips.evaluate(() => document.querySelector('.meta-inline-edit input').value === 'Fictional separately saved metadata'), 'explicit discard loads current saved metadata');
  assert.equal(await clips.evaluate(() => document.activeElement.matches('button.meta-badge')), true);
  assert.deepEqual(await popup.evaluate(async () => (await chrome.storage.local.get('captures')).captures), savedBeforeDiscard, 'Discard must not write saved metadata');
  check('Conflicted metadata draft survives cancel; explicit discard loads current revision without writing storage');
  const after = await popup.evaluate(async () => chrome.permissions.getAll());
  assert.deepEqual(after, before.permissions, 'UI checks must not add or remove any native permission');
  check('Keyboard metadata edit commits through background writer with unchanged native permissions');
  await clips.screenshot(join(root, 'clip-review-' + locale + '.png'));
}, { grantLoopback: false, locale });
