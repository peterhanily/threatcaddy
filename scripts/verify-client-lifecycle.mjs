// Saved local-AI approval acceptance in an installed, disposable browser.
// No model/provider request is sent; loopback host grants are pre-scoped by
// the shared native harness and OS permission prompts remain out of scope.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { until, withClipRuntime } from './verify-clip-delivery-runtime.mjs';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/verify-client-lifecycle.mjs chrome|firefox');

await withClipRuntime(browser, async ({ runtime, origin, unavailableOrigin, root, check }) => {
  const popup = await runtime.newPage();
  const approvals = page => page.evaluate(async () => (await chrome.storage.local.get('approvedAppsV1')).approvedAppsV1 || {});
  const permissions = page => page.evaluate(async () => {
    const saved = await chrome.permissions.getAll();
    return { origins: [...(saved.origins || [])].sort(), permissions: [...(saved.permissions || [])].sort() };
  });
  const openPopup = async () => {
    await popup.goto(runtime.extensionOrigin + '/popup.html');
    await popup.click('#settings-btn');
    await until(() => popup.evaluate(async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      return document.querySelector('#settings-target-url').value === (settings.targetUrl || 'https://threatcaddy.com');
    }), 'saved target displayed');
  };
  const approve = async target => {
    const previous = (await approvals(popup))[target]?.generation;
    await popup.fill('#settings-target-url', target);
    await popup.click('#settings-save-url');
    await until(async () => {
      const saved = (await approvals(popup))[target];
      return saved && saved.generation !== previous;
    }, 'real app approval persisted');
    const localOrigin = (await approvals(popup))[target].localLLMOrigin || '';
    await until(() => popup.evaluate(localOrigin => document.querySelector('#settings-local-ai-url').value === localOrigin
      && document.querySelector('#settings-local-ai-status').textContent === (localOrigin
        ? 'Saved for this app: ' + localOrigin : 'No local AI endpoint approved for this app.'), localOrigin), 'approved target settings reloaded');
  };
  const saveLocal = async (target, localOrigin) => {
    await until(() => popup.evaluate(() => document.querySelector('#settings-local-ai-status').textContent !== ''), 'local approval loaded');
    await popup.fill('#settings-local-ai-url', localOrigin + '/fictional-model-path');
    await popup.click('#settings-save-local-ai');
    await until(async () => (await approvals(popup))[target]?.localLLMOrigin === localOrigin, 'local origin explicitly saved');
    await until(() => popup.evaluate(() => !document.querySelector('#settings-save-local-ai').disabled), 'local approval action finished');
  };

  await openPopup();
  await approve(origin);
  const initialPermissions = await permissions(popup);
  await saveLocal(origin, unavailableOrigin);
  await openPopup();
  await until(() => popup.evaluate(expected => document.querySelector('#settings-local-ai-url').value === expected, unavailableOrigin), 'saved local origin restored after reopening popup');
  await approve(origin);
  assert.equal((await approvals(popup))[origin].localLLMOrigin, unavailableOrigin);
  assert.deepEqual(await permissions(popup), initialPermissions);
  check('popup reopens with its saved local origin and app-only approval preserves it without expanding host grants');

  const clips = await runtime.newPage();
  await clips.goto(runtime.extensionOrigin + '/pages/clips.html');
  await until(() => clips.evaluate(expected => document.querySelector('#local-ai-url').value === expected, unavailableOrigin), 'clips page restores per-app local origin');
  const beforeClipsSave = (await approvals(clips))[origin].generation;
  await clips.fill('#local-ai-url', unavailableOrigin + '/fictional-model-path');
  await clips.click('#save-local-ai-btn');
  await until(async () => (await approvals(clips))[origin]?.generation !== beforeClipsSave, 'clips local origin explicitly saved');
  assert.equal((await approvals(clips))[origin].localLLMOrigin, unavailableOrigin);
  await until(() => clips.evaluate(() => !document.querySelector('#save-local-ai-btn').disabled), 'clips local approval action finished');
  const beforeClipsApproval = (await approvals(clips))[origin].generation;
  await clips.click('#save-settings-btn');
  await until(async () => (await approvals(clips))[origin]?.generation !== beforeClipsApproval, 'clips app-only approval finished');
  assert.equal((await approvals(clips))[origin].localLLMOrigin, unavailableOrigin);
  assert.deepEqual(await permissions(clips), initialPermissions);
  check('clips-page explicit save and app-only approval retain the local endpoint without new browser permissions');

  await approve(unavailableOrigin);
  await saveLocal(unavailableOrigin, origin);
  const both = await approvals(popup);
  assert.equal(both[origin].localLLMOrigin, unavailableOrigin);
  assert.equal(both[unavailableOrigin].localLLMOrigin, origin);
  await clips.fill('#target-url', origin);
  await until(() => clips.evaluate(expected => document.querySelector('#local-ai-url').value === expected, unavailableOrigin), 'clips target-specific local origin loaded');
  await clips.click('#remove-local-ai-btn');
  await until(async () => !(await approvals(clips))[origin]?.localLLMOrigin, 'explicit selected-app local origin removal');
  assert.ok((await approvals(clips))[origin], 'removing local AI does not revoke the app');
  assert.equal((await approvals(clips))[unavailableOrigin].localLLMOrigin, origin);
  assert.deepEqual(await permissions(clips), initialPermissions);
  check('explicit clips-page removal changes only the selected app and leaves native host grants unchanged');

  await openPopup();
  await until(() => popup.evaluate(expected => document.querySelector('#settings-local-ai-url').value === expected, origin), 'second app saved endpoint survives first app removal');
  await popup.click('#settings-remove-local-ai');
  await until(async () => !(await approvals(popup))[unavailableOrigin]?.localLLMOrigin, 'explicit popup local origin removal');
  await openPopup();
  await until(() => popup.evaluate(() => document.querySelector('#settings-local-ai-status').textContent === 'No local AI endpoint approved for this app.'), 'removed local approval stays absent after reopening');
  const final = await approvals(popup);
  assert.deepEqual(Object.keys(final).sort(), [origin, unavailableOrigin].sort());
  assert.ok(Object.values(final).every(approval => !approval.localLLMOrigin));
  assert.deepEqual(await permissions(popup), initialPermissions);
  assert.equal(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] })), false);
  await popup.screenshot(join(root, 'local-approval-explicit-removal.png'));
  check('popup removal persists across reload while both app approvals and disabled notifications remain intact');
});
