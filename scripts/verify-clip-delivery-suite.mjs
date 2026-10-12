// End-to-end clip delivery uses the built app's real IndexedDB transactions.
// No receiver fabricates successful acknowledgements and no provider is called.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { until } from './verify-clip-delivery-runtime.mjs';

const workspacePassword = 'fictional-clip-workspace-passphrase';
const refs = captures => captures.map(({ id, revision }) => ({ id, revision }));
const command = (page, message) => page.evaluate(value => chrome.runtime.sendMessage(value), message);
const storedCaptures = page => page.evaluate(async () => (await chrome.storage.local.get('captures')).captures || []);
const confirmed = capture => capture?.sent === true && capture.delivery?.status === 'confirmed'
  && capture.delivery.revision === capture.revision;
const content = index => `Fictional local observation ${index}. 中文 café. No provider request.`;
const clipInput = (index, entityType = 'note') => ({ title: `Fictional clip ${index}`, content: content(index),
  sourceUrl: '', sourceTitle: '', entityType, folderName: 'Fictional Clip Case', clsLevel: 'TLP:AMBER' });

async function save(page, index, type = 'note') {
  const response = await command(page, { type: 'SAVE_NOTE', note: clipInput(index, type) });
  assert.equal(response.success, true, JSON.stringify(response));
  const capture = (await storedCaptures(page)).find(item => item.id === response.id);
  assert.ok(capture, 'successful capture response resolves to persisted extension storage');
  return capture;
}

async function readDB(page, databaseName = 'ThreatCaddyDB') {
  return page.evaluate(databaseName => new Promise((done, fail) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => fail(request.error);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      fail(new Error('Expected initialized fixture database: ' + databaseName));
    };
    request.onsuccess = () => {
      const database = request.result;
      const names = ['notes', 'tasks', 'timelineEvents', 'folders', '_clipReceipts'];
      let transaction;
      try { transaction = database.transaction(names, 'readonly'); }
      catch (error) { database.close(); fail(error); return; }
      const result = {};
      transaction.oncomplete = () => { database.close(); done(result); };
      transaction.onabort = () => { database.close(); fail(transaction.error); };
      for (const name of names) {
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => { result[name] = read.result; };
      }
    };
  }), databaseName);
}

async function prepare(page, origin) {
  const response = await command(page, { type: 'PREPARE_CLIP_DELIVERY', targetUrl: origin });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.workspaceId, 'default');
  assert.equal(typeof response.workspaceLabel, 'string');
  return response;
}

async function send(page, session, captures) {
  return command(page, { type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: refs(captures) });
}

async function appReady(page) {
  await until(() => page.evaluate(() => !!document.querySelector('[data-tour="header"]')), 'app ready');
}

async function approve(popup, origin) {
  await popup.goto((await popup.url()).split('/popup.html')[0] + '/popup.html');
  await popup.click('#settings-btn');
  await until(() => popup.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    return document.querySelector('#settings-target-url').value === (settings.targetUrl || 'https://threatcaddy.com');
  }), 'initial target settings loaded');
  assert.equal(await popup.evaluate(() => document.querySelector('#settings-approval-status').textContent), '');
  await popup.fill('#settings-target-url', origin);
  await popup.click('#settings-save-url');
  // Reapproval may already have a stored entry; only this fresh document's
  // success feedback acknowledges the current action and bridge registration.
  await until(() => popup.evaluate(async origin => {
    const data = await chrome.storage.local.get('approvedAppsV1');
    return !!data.approvedAppsV1?.[origin]
      && document.querySelector('#settings-approval-status').textContent === chrome.i18n.getMessage('appApproved');
  }, origin), 'exact loopback app approval persisted and acknowledged');
}

async function assertCommitted(popup, app, captures) {
  const durable = await storedCaptures(popup);
  const data = await readDB(app);
  for (const expected of captures) {
    const saved = durable.find(item => item.id === expected.id);
    assert.ok(confirmed(saved), 'only committed current revisions are confirmed');
    assert.equal(saved.delivery.workspaceId, 'default');
    const receipt = data._clipReceipts.find(item => item.clipId === saved.id && item.revision === saved.revision);
    assert.ok(receipt, 'confirmed extension row has a durable app receipt');
    assert.equal(receipt.fingerprint, saved.delivery.fingerprint);
    assert.equal(receipt.entityId, saved.delivery.entityId);
    assert.equal(receipt.entityType, saved.entityType);
    const table = saved.entityType === 'note' ? 'notes' : saved.entityType === 'task' ? 'tasks' : 'timelineEvents';
    const entity = data[table].find(item => item.id === receipt.entityId);
    assert.ok(entity, 'receipt resolves to a committed entity');
    assert.ok((entity.content ?? entity.description).includes(expected.content), 'full captured content persisted');
    assert.equal(entity.clsLevel, expected.clsLevel);
    assert.equal(data.folders.find(folder => folder.id === entity.folderId)?.name, expected.folderName);
  }
  return data;
}

async function enableEncryption(app) {
  await app.clickText('Settings');
  await app.clickText('Data', 'tab');
  await app.clickText('Enable Encryption');
  await app.fill('input[placeholder="Enter passphrase..."]', workspacePassword);
  await app.fill('input[placeholder="Confirm passphrase..."]', workspacePassword);
  await app.clickText('Continue');
  await app.click('[role="dialog"] input[type="checkbox"]');
  // The setup dialog and the underlying Settings panel both use this label.
  await app.click('[role="dialog"] button.bg-accent');
  await until(() => app.evaluate(() => document.body.textContent.includes('Encryption is enabled')), 'workspace encryption enabled', 30000);
  await app.clickText('Close settings');
}

export async function verifyClipDelivery({ runtime, origin, unavailableOrigin, root, check }) {
  let app = await runtime.newPage();
  await app.goto(origin); await appReady(app);
  assert.equal(await app.evaluate(() => document.documentElement.dataset.tcBridgeCaps), undefined);
  const popup = await runtime.newPage();
  await popup.goto(runtime.extensionOrigin + '/popup.html');
  await approve(popup, origin);
  await app.goto(origin); await appReady(app);
  const second = await runtime.newPage();
  await second.goto(runtime.extensionOrigin + '/popup.html');
  const clipsPage = await runtime.newPage();
  await clipsPage.goto(runtime.extensionOrigin + '/pages/clips.html');
  assert.deepEqual(await storedCaptures(popup), []);
  assert.equal(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] })), false);
  check('real extension installed and exact local app approved without notification permission');

  // Both extension pages invoke the real background concurrently. Browser
  // storage is not stubbed or overwritten to manufacture serialization success.
  const saveMany = (page, start, count) => page.evaluate(async ({ start, count }) => Promise.all(
    Array.from({ length: count }, (_, offset) => chrome.runtime.sendMessage({ type: 'SAVE_NOTE', note: {
      title: `Fictional concurrent ${start + offset}`, content: `Local synthetic capture ${start + offset}`,
      sourceUrl: '', sourceTitle: '', entityType: 'note', folderName: 'Fictional Clip Case', clsLevel: '',
    } }))), { start, count });
  const concurrent = (await Promise.all([saveMany(popup, 0, 12), saveMany(second, 12, 12)])).flat();
  assert.ok(concurrent.every(item => item.success === true));
  const initial = await storedCaptures(popup);
  assert.equal(initial.length, 24);
  assert.equal(new Set(initial.map(item => item.id)).size, 24);
  assert.equal(new Set(initial.map(item => item.title)).size, 24);
  check('24 concurrent captures from two extension pages are retained exactly once');

  const capacity = await saveMany(popup, 24, 476);
  assert.ok(capacity.every(item => item.success === true));
  const full = await storedCaptures(popup);
  assert.equal(full.length, 500);
  assert.ok(initial.every(item => full.some(saved => saved.id === item.id)));
  await popup.goto(runtime.extensionOrigin + '/popup.html');
  await popup.fill('#capture-title', 'Fictional unsaved draft at capacity');
  await popup.fill('#capture-text', 'Preserve this fictional draft when storage refuses the save.');
  await popup.click('#save-btn');
  await until(() => popup.evaluate(() => document.querySelector('#save-error')?.classList.contains('show')), 'capacity error in popup');
  assert.equal(await popup.evaluate(() => document.querySelector('#capture-text').value), 'Preserve this fictional draft when storage refuses the save.');
  assert.equal(await popup.evaluate(() => document.querySelector('#capture-title').value), 'Fictional unsaved draft at capacity');
  assert.deepEqual(await storedCaptures(popup), full);
  await popup.screenshot(join(root, 'capacity-preserves-draft.png'));
  check('500-capture capacity rejects visibly, preserves popup draft and evicts no saved capture');
  const removed = await command(popup, { type: 'DELETE_CAPTURES', clips: refs(full) });
  assert.equal(removed.success, true);
  assert.deepEqual(await storedCaptures(popup), []);

  // Exercise real cold navigation, including Firefox's initial complete
  // about:blank document. Preparation must wait for the actual built app.
  const coldCapture = await save(popup, 'cold-app-navigation');
  const coldBefore = await readDB(app);
  await app.close();
  const coldSession = await prepare(popup, origin);
  const coldPages = [];
  for (const page of await runtime.pages()) {
    if ((await page.url()).replace(/\/$/, '') === origin) coldPages.push(page);
  }
  assert.equal(coldPages.length, 1, 'prepare opens exactly one real app when no target tab exists');
  app = coldPages[0];
  await appReady(app);
  assert.deepEqual(await readDB(app), coldBefore, 'cold preparation commits no capture before confirmation');
  assert.equal(confirmed((await storedCaptures(popup))[0]), false);
  assert.equal((await send(popup, coldSession, [coldCapture])).success, true);
  await assertCommitted(popup, app, [coldCapture]);
  assert.equal((await command(popup, { type: 'DELETE_CAPTURES', clips: refs([coldCapture]) })).success, true);
  assert.deepEqual(await storedCaptures(popup), []);
  check('cold target navigation waits for the actual app workspace; confirmed send creates a real database receipt');

  const selected = [];
  for (const [index, type] of ['note', 'task', 'timeline-event'].entries()) selected.push(await save(popup, `entity-${index}`, type));
  // Cross the production20-row wire boundary while the real app refreshes its
  // UI after the first committed batch; readiness may briefly become busy.
  for (let index = 0; index < 18; index++) selected.push(await save(popup, `batch-boundary-${index}`));
  const before = await readDB(app);
  await clipsPage.goto(runtime.extensionOrigin + '/pages/clips.html');
  await clipsPage.click('#send-all-btn');
  await until(() => clipsPage.evaluate(() => !document.querySelector('#modal-overlay').classList.contains('hidden')), 'actual workspace confirmation');
  assert.match(await clipsPage.evaluate(() => document.querySelector('#modal-message').textContent), /default/);
  assert.deepEqual(await readDB(app), before, 'preparing/confirming a workspace does not import content');
  assert.ok((await storedCaptures(popup)).every(item => !confirmed(item)));
  await clipsPage.screenshot(join(root, 'workspace-confirmation.png'));
  await clipsPage.click('#modal-confirm');
  await until(async () => (await storedCaptures(popup)).every(confirmed), 'database-backed delivery receipts');
  const committed = await assertCommitted(popup, app, selected);
  assert.equal(committed.notes.length, before.notes.length + 19);
  assert.equal(committed.tasks.length, before.tasks.length + 1);
  assert.equal(committed.timelineEvents.length, before.timelineEvents.length + 1);
  await clipsPage.goto(runtime.extensionOrigin + '/pages/clips.html');
  assert.ok((await storedCaptures(clipsPage)).every(confirmed), 'confirmation persists across extension page reload');
  check('explicit workspace confirmation imports21 clips across two batches with matching durable note/task/event receipts');

  const noteReceipt = committed._clipReceipts.find(item => item.clipId === selected[0].id);
  await app.evaluate(receipt => sessionStorage.setItem('threatcaddy-nav-state', JSON.stringify({
    view: 'notes', selectedNoteId: receipt.entityId, selectedFolderId: receipt.folderId,
  })), noteReceipt);
  await app.goto(origin); await appReady(app);
  await until(() => app.evaluate(() => !!document.querySelector('textarea[placeholder="Start writing in markdown..."]')), 'imported note editor');
  const analystEdit = 'Fictional analyst edit retained across delivery retries.';
  await app.fill('textarea[placeholder="Start writing in markdown..."]', analystEdit);
  await until(async () => (await readDB(app)).notes.find(item => item.id === noteReceipt.entityId)?.content === analystEdit, 'analyst edit persisted');
  const editedDB = await readDB(app);
  const duplicate = await send(popup, await prepare(popup, origin), selected);
  assert.equal(duplicate.success, true, JSON.stringify(duplicate));
  assert.deepEqual(await readDB(app), editedDB, 'same revision retry changes neither entities nor existing receipts');
  check('repeated delivery is idempotent and preserves an existing analyst edit');

  const oldSession = await prepare(popup, origin);
  const changed = await command(second, { type: 'UPDATE_CAPTURES', clips: refs([selected[0]]), values: { folderName: 'Fictional Revised Case' } });
  assert.equal(changed.success, true);
  const revised = (await storedCaptures(popup)).find(item => item.id === selected[0].id);
  assert.equal(revised.revision, selected[0].revision + 1);
  assert.ok(!confirmed(revised));
  const stale = await send(popup, oldSession, [selected[0]]);
  assert.equal(stale.success, false);
  assert.deepEqual(await readDB(app), editedDB);
  const revisionResult = await send(popup, await prepare(popup, origin), [revised]);
  assert.equal(revisionResult.success, true, JSON.stringify(revisionResult));
  await assertCommitted(popup, app, [revised]);
  const revisedDB = await readDB(app);
  assert.equal(revisedDB.notes.length, editedDB.notes.length + 1);
  assert.equal(revisedDB.notes.find(item => item.id === noteReceipt.entityId).content, analystEdit);
  check('stale revision selection is rejected; new revision creates a new item without overwriting analysis');

  // A historical receipt for an already removed item is an expected user-data
  // state. Seed metadata only; the companion positive import uses the real app.
  const failed = await save(popup, 'removed-historical-item');
  const valid = await save(popup, 'partial-companion');
  const partialSession = await prepare(popup, origin);
  const historical = await popup.evaluate(async capture => {
    const sourceId = (await chrome.storage.local.get('clipDeliveryV2')).clipDeliveryV2.sourceId;
    const canonical = { id: capture.id, revision: capture.revision, title: capture.title, content: capture.content,
      sourceUrl: capture.sourceUrl, sourceTitle: capture.sourceTitle, entityType: capture.entityType,
      folderName: capture.folderName, clsLevel: capture.clsLevel, createdAt: capture.createdAt };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
    const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    return { key: JSON.stringify([sourceId, capture.id, capture.revision]), sourceId, clipId: capture.id,
      revision: capture.revision, fingerprint, entityType: capture.entityType,
      entityId: 'fictional-previously-removed-item', folderId: 'fictional-historical-folder', committedAt: Date.now() };
  }, failed);
  await app.evaluate(receipt => new Promise((done, fail) => {
    const open = indexedDB.open('ThreatCaddyDB');
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('_clipReceipts', 'readwrite');
      transaction.oncomplete = () => { database.close(); done(); };
      transaction.onabort = () => { database.close(); fail(transaction.error); };
      transaction.objectStore('_clipReceipts').put(receipt);
    };
  }), historical);
  const partial = await send(popup, partialSession, [failed, valid]);
  assert.equal(partial.success, false);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.confirmed, 1);
  const partialRows = await storedCaptures(popup);
  assert.equal(partialRows.find(item => item.id === failed.id).delivery.status, 'failed');
  await assertCommitted(popup, app, [valid]);
  assert.equal((await readDB(app)).notes.some(item => item.id === historical.entityId), false);
  assert.equal((await command(popup, { type: 'UPDATE_CAPTURES', clips: refs([failed]), values: { folderName: 'Fictional Retry Case' } })).success, true);
  const retry = (await storedCaptures(popup)).find(item => item.id === failed.id);
  assert.equal((await send(popup, await prepare(popup, origin), [retry])).success, true);
  await assertCommitted(popup, app, [retry]);
  check('real partial result confirms only committed item; failed historical item remains retryable as a new revision');

  const pending = await save(popup, 'readiness-and-scope');
  const unconfirmed = await storedCaptures(popup);
  const priorDB = await readDB(app);
  await approve(popup, unavailableOrigin);
  const unavailable = await command(popup, { type: 'PREPARE_CLIP_DELIVERY', targetUrl: unavailableOrigin });
  assert.equal(unavailable.success, false);
  assert.match(unavailable.error, /workspace|unlock|confirm/i);
  assert.deepEqual(await storedCaptures(popup), unconfirmed);
  await approve(popup, origin);
  await app.goto(origin); await appReady(app);
  assert.deepEqual(await readDB(app), priorDB);
  check('a real page with no app receiver times out without falsely confirming or losing captures');

  const scopedSession = await prepare(popup, origin);
  const otherWorkspace = 'a'.repeat(64);
  await app.evaluate(id => sessionStorage.setItem('threatcaddy-active-workspace', id), otherWorkspace);
  await app.goto(origin); await appReady(app);
  const wrongWorkspaceBefore = await readDB(app, `ThreatCaddyDB:${otherWorkspace}`);
  const mismatch = await send(popup, scopedSession, [pending]);
  assert.equal(mismatch.success, false);
  assert.deepEqual(await readDB(app, `ThreatCaddyDB:${otherWorkspace}`), wrongWorkspaceBefore);
  assert.deepEqual(await storedCaptures(popup), unconfirmed);
  await app.evaluate(() => sessionStorage.removeItem('threatcaddy-active-workspace'));
  await app.goto(origin); await appReady(app);
  assert.deepEqual(await readDB(app), priorDB);
  check('a prepared delivery cannot follow a tab into another workspace or document');

  const revokedSession = await prepare(popup, origin);
  assert.equal((await command(popup, { type: 'REVOKE_APPS' })).success, true);
  assert.equal((await send(popup, revokedSession, [pending])).success, false);
  assert.deepEqual(await storedCaptures(popup), unconfirmed);
  assert.deepEqual(await readDB(app), priorDB);
  await approve(popup, origin);
  assert.equal((await send(popup, await prepare(popup, origin), [pending])).success, true);
  await assertCommitted(popup, app, [pending]);
  check('revoked approval invalidates a prepared delivery; explicit reapproval safely retries');

  const lockedCapture = await save(popup, 'locked-workspace');
  await enableEncryption(app);
  await app.evaluate(() => sessionStorage.removeItem('threatcaddy-session-cache'));
  await app.goto(origin);
  await until(() => app.evaluate(() => document.body.textContent.includes('Unlock ThreatCaddy')), 'real workspace lock screen');
  const lockedRows = await storedCaptures(popup);
  const lockedDB = await readDB(app);
  const locked = await command(popup, { type: 'PREPARE_CLIP_DELIVERY', targetUrl: origin });
  assert.equal(locked.success, false);
  assert.deepEqual(await storedCaptures(popup), lockedRows);
  assert.deepEqual(await readDB(app), lockedDB);
  await app.screenshot(join(root, 'locked-workspace-retains-capture.png'));
  await app.fill('input[placeholder="Enter passphrase..."]', workspacePassword);
  await app.clickText('Unlock'); await appReady(app);
  const unlocked = await send(popup, await prepare(popup, origin), [lockedCapture]);
  assert.equal(unlocked.success, true, JSON.stringify(unlocked));
  const final = (await storedCaptures(popup)).find(item => item.id === lockedCapture.id);
  assert.ok(confirmed(final));
  const encryptedDB = await readDB(app);
  const encryptedEntity = encryptedDB.notes.find(item => item.id === final.delivery.entityId);
  assert.equal(encryptedEntity.content.__enc, 1, 'real imported entity remains encrypted at rest');
  assert.ok(encryptedDB._clipReceipts.some(item => item.clipId === lockedCapture.id && item.entityId === encryptedEntity.id));
  assert.equal(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] })), false);
  check('locked workspace receives no import; explicit unlock/retry commits with encrypted-at-rest content');
}
