/** Inert protocol/UI gate: real generated HTML/CSP and chunked loopback HTTP,
 * fictional responses only, no database, actual AI providers or external hosts. */
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit, expect, type BrowserType } from '@playwright/test';
import { getAdminHtml } from '../src/routes/admin-html/index.js';

const evidence = await mkdtemp(join(tmpdir(), 'threatcaddy-admin-ai-ui-'));
const engines: Record<string, BrowserType> = { chromium, firefox, webkit };
const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines);
assert(selected.every(name => engines[name]), 'Only chromium/firefox/webkit engine names are accepted.');
const records: { engine: string; method: string; path: string; body: Record<string, unknown> }[] = [];
const results: { engine: string; name: string }[] = [];
const unexpected: string[] = [];
let currentEngine = '';
let mode = 'good';
let providerFailures = 1;
let holdProviders = false;
let heldProvidersResponse: ServerResponse | undefined;
let providerModel = 'Fictional "quoted" model';
let settingsFailures = 1;
let saveFailure = false;
let holdSettings = false;
let heldSettingsResponse: ServerResponse | undefined;
let freshSettings = false;
let approvalSequence = 0;
let receiptMode = 'retry';
let botEnabled = true;
let botDeleted = false;
let abortedStreams = 0;
const receiptAttempts = new Map<string, number>();
const held = new Set<ServerResponse>();
const fixtureBot = () => ({ id: 'legacy-integration', name: 'Fictional legacy integration', type: 'integration', enabled: botEnabled,
  runtimeAvailable: false, unavailableReason: 'Server integration execution is unavailable. Stored configuration and run history are retained.',
  scopeType: 'global', scopeFolderIds: [], capabilities: [], config: {}, triggers: {}, rateLimitPerHour: 5, rateLimitPerDay: 10,
  runCount: 1, errorCount: 0, createdAt: '2026-01-01T00:00:00Z' });
const fixtureRun = { id: 'fictional-run', status: 'completed', trigger: 'manual', createdAt: '2026-01-01T00:00:00Z',
  startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', durationMs: 1000,
  log: [{ ts: '2026-01-01T00:00:00Z', type: 'llm_response', text: 'Fictional retained run history' }],
  entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0 };
function json(response: ServerResponse, body: unknown, status = 200) {
  if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
}
function sse(value: unknown) { return `data: ${JSON.stringify(value)}\r\n\r\n`; }
function hold(response: ServerResponse) {
  held.add(response);
  response.on('close', () => { held.delete(response); abortedStreams++; });
}
const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk.toString(); if (raw.length > 256 * 1024) throw new Error('Fixture request too large'); }
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    records.push({ engine: currentEngine, method: request.method || 'GET', path, body });
    if (path === '/admin') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'nonce-fictional-fixture'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      response.end(getAdminHtml('fictional-fixture')); return;
    }
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (path === '/admin/api/setup-status') return json(response, { hasAdminAccounts: true });
    if (path === '/admin/api/login') return json(response, { token: 'fictional-session-token', admin: { id: 'fictional-admin', displayName: 'Fictional operator' } });
    if (path === '/admin/api/stats') return json(response, { totalUsers: 2, activeUsers: 2, investigations: 0, activeSessions: 1, auditLogEntries24h: 0 });
    if (path === '/admin/api/settings') return json(response, { registrationMode: 'invite', serverName: 'Inert UI fixture' });
    if (path === '/admin/api/allowed-emails') return json(response, { emails: [] });
    if (path === '/admin/api/users') return json(response, { users: [] });
    if (path === '/admin/api/investigations') return json(response, { investigations: [] });
    if (path === '/admin/api/bots') return json(response, { bots: botDeleted ? [] : [fixtureBot()] });
    if (path === '/admin/api/bots/legacy-integration' && request.method === 'DELETE') { botDeleted = true; return json(response, { ok: true }); }
    if (path === '/admin/api/bots/legacy-integration/disable') { botEnabled = false; return json(response, { ok: true }); }
    if (path === '/admin/api/bots/legacy-integration') return json(response, { bot: fixtureBot(), recentRuns: [fixtureRun], memberships: [] });
    if (path === '/admin/api/bots/legacy-integration/runs') return json(response, { runs: [fixtureRun], total: 1 });
    if (path === '/admin/api/bots/legacy-integration/runs/fictional-run') return json(response, { run: fixtureRun });
    if (path === '/admin/api/ai/providers') {
      if (providerFailures-- > 0) return json(response, { error: 'Fictional temporary provider-list failure' }, 503);
      if (holdProviders) { heldProvidersResponse = response; hold(response); return; }
      return json(response, { providers: [{ provider: 'local', models: [providerModel] }], settings: { defaultProvider: 'local', defaultModel: providerModel } });
    }
    if (path === '/admin/api/ai/settings') {
      if (request.method === 'PATCH') {
        if (saveFailure) return json(response, { error: 'Fictional save failure' }, 503);
        return json(response, { ...body, ok: true, localApiKey: '***configured***' });
      }
      if (settingsFailures-- > 0) return json(response, { error: 'Fictional temporary settings failure' }, 503);
      if (holdSettings) { heldSettingsResponse = response; hold(response); return; }
      return json(response, { temperature: 0, localApiKey: '***configured***', localEndpoint: freshSettings ? 'http://127.0.0.1:9/fresh' : '', localModelName: 'Fictional model', customSystemPrompt: '' });
    }
    if (path.startsWith('/admin/api/ai/approvals/')) {
      assert.deepEqual(Object.keys(body), ['decision']);
      assert(['approve', 'reject'].includes(String(body.decision)));
      const id = path.split('/').at(-1)!;
      const attempt = (receiptAttempts.get(id) || 0) + 1; receiptAttempts.set(id, attempt);
      if (receiptMode === 'hold') { hold(response); return; }
      if (body.decision === 'reject') return json(response, { approvalId: id, name: 'update_user', status: 'rejected', completedAt: Date.now() });
      if (receiptMode === 'retry' && attempt === 1) {
        // Start the receipt before disconnecting: a pre-header socket failure
        // may be transparently retried by the browser's HTTP transport.
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
        response.write('{"approvalId":'); await delay(25); response.destroy(); return;
      }
      if (receiptMode === 'retry' && attempt === 2) return json(response, { approvalId: id, name: 'update_user', status: 'executing' }, 202);
      return json(response, { approvalId: id, name: 'update_user', status: 'completed', result: { fictional: true }, completedAt: Date.now() });
    }
    if (path === '/admin/api/ai/chat') {
      const currentMode = mode;
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }); response.flushHeaders();
      if (currentMode === 'hold') { response.write(sse({ type: 'text', text: 'Initial fictional partial text' })); hold(response); return; }
      if (currentMode === 'malformed') { response.end('data: not-json\r\n\r\n'); return; }
      if (currentMode === 'truncated') { response.end(sse({ type: 'text', text: 'Fictional truncated response' })); return; }
      if (currentMode === 'oversized') { response.end(sse({ type: 'text', text: 'a'.repeat(256 * 1024) })); return; }
      if (currentMode === 'confirmation' || currentMode === 'expired') {
        const event = { type: 'confirmation_required', approvalId: `fictional-approval-${++approvalSequence}`, name: 'update_user',
          input: { userId: 'fictional-user', active: false, reason: 'Fictional <label> & café' }, expiresAt: Date.now() + (currentMode === 'expired' ? -1000 : 300000) };
        response.end(sse(event)); return;
      }
      const wire = Buffer.from(sse({ type: 'provider', provider: 'local', model: 'Fictional model' })
        + sse({ type: 'text', text: 'Fictional **café** 🙂\nwith `code` and <label>.' })
        + sse({ type: 'tool_call', name: 'get_server_stats', input: {} })
        + sse({ type: 'tool_result', name: 'get_server_stats', result: { fictional: true } }) + sse({ type: 'done' }));
      for (let offset = 0; offset < wire.length && !response.destroyed; offset += 3) { response.write(wire.subarray(offset, offset + 3)); await delay(2); }
      if (!response.destroyed) response.end(); return;
    }
    unexpected.push(`${request.method} ${path}`); json(response, { error: 'Unknown inert fixture route' }, 404);
  } catch (error) { unexpected.push(String(error)); json(response, { error: 'Fixture error' }, 500); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address(); assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
try {
  for (const engine of selected) {
    currentEngine = engine; providerFailures = 1; holdProviders = false; heldProvidersResponse = undefined; providerModel = 'Fictional "quoted" model';
    settingsFailures = 1; mode = 'good'; saveFailure = false; holdSettings = false; freshSettings = false; botEnabled = true; botDeleted = false;
    const browser = await engines[engine].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const pageErrors: string[] = []; const cspErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (/refused.*(script|inline)|content security policy/i.test(message.text())) cspErrors.push(message.text()); });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      unexpected.push(`External request: ${route.request().url()}`); return route.abort('blockedbyclient');
    });
    const chatCount = () => records.filter(row => row.engine === engine && row.path === '/admin/api/ai/chat').length;
    const approvalRequests = () => records.filter(row => row.engine === engine && row.path.startsWith('/admin/api/ai/approvals/'));
    async function check(name: string) { assert.deepEqual(pageErrors, []); assert.deepEqual(cspErrors, []); assert.deepEqual(unexpected, []); results.push({ engine, name }); console.log(JSON.stringify({ engine, passed: name })); }
    async function login() { await page.locator('#loginUsername').fill('fictional-admin'); await page.locator('#loginPassword').fill('fictional-local-only-password'); await page.getByRole('button', { name: 'Sign In', exact: true }).click(); await expect(page.locator('#dashboard')).toBeVisible(); }
    async function send(text = 'Fictional request') { await page.locator('#aiInput').fill(text); await page.locator('#aiSendBtn').click(); }
    async function clear() { await page.locator('#aiClearBtn').click(); await expect(page.locator('.ai-msg')).toHaveCount(0); }
    async function ready() { await expect(page.locator('#aiSendBtn')).toBeEnabled(); }
    try {
      await page.goto(`${origin}/admin`); await login(); await page.locator('[data-tab="tab-ai"]').click();
      await expect(page.locator('#aiProviderHint')).toContainText('Could not load providers');
      await expect(page.locator('#aiSettingsStatus')).toContainText('Could not load settings');
      await expect(page.locator('#aiSettingsSave')).toBeDisabled(); await expect(page.locator('#aiLocalEndpoint')).toBeDisabled();
      await page.locator('#aiSettingsToggle').click();
      await page.locator('#aiReloadBtn').click(); await expect(page.locator('#aiModelSelect')).toHaveValue('Fictional "quoted" model');
      await expect(page.locator('#aiTemperature')).toHaveValue('0');
      await page.locator('#aiCustomPrompt').fill('Fictional settings draft'); saveFailure = true;
      await page.locator('#aiSettingsSave').click(); await expect(page.locator('#aiSettingsStatus')).toContainText('Could not save');
      await expect(page.locator('#aiCustomPrompt')).toHaveValue('Fictional settings draft'); saveFailure = false;
      await page.locator('#aiSettingsSave').click(); await expect(page.locator('#aiSettingsStatus')).toHaveText('AI settings saved.');
      const saved = records.filter(row => row.engine === engine && row.path === '/admin/api/ai/settings' && row.method === 'PATCH');
      assert(saved.length === 2 && saved.every(row => row.body.temperature === 0));
      for (const outcome of ['success', 'failure']) {
        heldSettingsResponse = undefined; holdSettings = true; await page.locator('#aiReloadBtn').click();
        await expect.poll(() => !!heldSettingsResponse).toBe(true);
        const savedEndpoint = `http://127.0.0.1:9/saved-${outcome}`;
        await page.locator('#aiLocalEndpoint').fill(savedEndpoint);
        await page.locator('#aiSettingsSave').click(); await expect(page.locator('#aiSettingsStatus')).toHaveText('AI settings saved.');
        const responsePromise = page.waitForResponse(response => response.url().endsWith('/admin/api/ai/settings') && response.request().method() === 'GET');
        if (outcome === 'success') json(heldSettingsResponse!, { temperature: 0, localApiKey: '', localEndpoint: 'http://127.0.0.1:9/old', localModelName: 'Old fictional model', customSystemPrompt: '' });
        else json(heldSettingsResponse!, { error: 'Fictional delayed settings failure' }, 503);
        holdSettings = false; await (await responsePromise).finished();
        await expect.poll(() => page.evaluate(() => (window as unknown as { aiSettingsLoading: boolean }).aiSettingsLoading)).toBe(false);
        await expect(page.locator('#aiLocalEndpoint')).toHaveValue(savedEndpoint); await expect(page.locator('#aiSettingsStatus')).toHaveText('AI settings saved.');
      }
      await ready();
      holdProviders = true; const providerReads = () => records.filter(row => row.engine === engine && row.path === '/admin/api/ai/providers').length;
      const readsBefore = providerReads(); await page.locator('#aiReloadBtn').click();
      await expect.poll(() => !!heldProvidersResponse).toBe(true); await expect(page.locator('#aiSendBtn')).toBeDisabled();
      const chatsBeforeRefresh = chatCount(); await page.locator('#aiInput').fill('Fictional draft during provider refresh'); await page.locator('#aiInput').press('Enter');
      await expect(page.locator('#aiInput')).toHaveValue('Fictional draft during provider refresh'); assert.equal(chatCount(), chatsBeforeRefresh);
      holdProviders = false; providerModel = 'Fictional refreshed model';
      await page.locator('#aiLocalModel').fill('Fictional newly saved model');
      await page.locator('#aiSettingsSave').click(); await expect(page.locator('#aiSettingsStatus')).toHaveText('AI settings saved.');
      await expect.poll(() => heldProvidersResponse!.destroyed).toBe(true);
      await expect(page.locator('#aiModelSelect')).toHaveValue(providerModel); await ready();
      expect(providerReads()).toBe(readsBefore + 2); assert.equal(chatCount(), chatsBeforeRefresh);
      await expect(page.locator('#aiInput')).toHaveValue('Fictional draft during provider refresh');
      await page.locator('#aiSettingsToggle').click(); await check('provider/settings retries preserve zero/drafts; initial load gates edits and delayed reads cannot replace saved values/status or suppress a fresh provider list');

      await send(); await expect(page.locator('.ai-msg-assistant strong').last()).toHaveText('café'); await ready();
      await expect(page.locator('.ai-msg-assistant code')).toHaveText('code'); await expect(page.locator('.ai-msg-assistant .ai-text')).toContainText('🙂\nwith code and <label>.');
      await expect(page.locator('.ai-msg-assistant label')).toHaveCount(0); await check('real split UTF8/CRLF SSE renders formatting and completes under nonce CSP');
      for (const invalidMode of ['malformed', 'truncated', 'oversized']) {
        await clear(); mode = invalidMode; await send(); await expect(page.locator('#aiStatus')).toContainText('interrupted'); await ready();
        await expect(page.locator('.ai-msg-assistant [role="alert"]')).toBeVisible(); await check(`${invalidMode} stream is visibly rejected`);
      }
      await clear(); mode = 'good'; const beforeLong = chatCount(); const longDraft = 'a'.repeat(20001);
      await send(longDraft); await expect(page.locator('#aiInput')).toHaveValue(longDraft); await expect(page.locator('#aiStatus')).toContainText('Nothing was sent');
      assert.equal(chatCount(), beforeLong); await check('oversized message remains an unsent draft');

      await clear(); mode = 'hold'; const beforeAbort = abortedStreams; await send(); await expect(page.locator('.ai-text').last()).toContainText('Initial fictional');
      await clear(); await expect.poll(() => abortedStreams).toBeGreaterThan(beforeAbort); mode = 'good'; await send('Fresh generation'); await ready();
      await expect(page.locator('#aiChatArea')).not.toContainText('Initial fictional'); await check('Clear aborts the old stream and permits a fresh generation without stale output');

      await clear(); mode = 'confirmation'; receiptMode = 'retry'; const chatsBeforeApproval = chatCount(); await send();
      const card = page.getByRole('region', { name: 'Administrative action approval' });
      await expect(card).toBeVisible(); await expect(card.locator('pre').first()).toContainText('Fictional <label> & café');
      await expect(card.locator('input,textarea,select,label')).toHaveCount(0); await expect(page.locator('#aiSendBtn')).toBeDisabled();
      await expect(card.locator('button').filter({ hasText: 'Retry same action receipt' })).toBeHidden();
      await expect(card.locator('button').filter({ hasText: 'Retry same action receipt' })).toBeDisabled();
      await page.screenshot({ path: join(evidence, `${engine}-exact-approval.png`), animations: 'disabled' });
      await card.getByRole('button', { name: 'Approve exact action', exact: true }).click(); await expect(card.getByRole('status')).toContainText('Outcome not confirmed');
      await expect(card.getByRole('button', { name: 'Reject action', exact: true })).toBeDisabled();
      await card.getByRole('button', { name: 'Retry same action receipt', exact: true }).click(); await expect(card.getByRole('status')).toContainText('Action is executing');
      await card.getByRole('button', { name: 'Check action status', exact: true }).click(); await expect(card.getByRole('status')).toHaveText('Action completed.'); await ready();
      await expect(card.locator('button').filter({ hasText: 'Check action status' })).toBeHidden();
      const attempts = approvalRequests().slice(-3); assert.equal(new Set(attempts.map(row => row.path)).size, 1); attempts.forEach(row => assert.deepEqual(row.body, { decision: 'approve' }));
      assert.equal(chatCount(), chatsBeforeApproval + 1); await check('lost ACK and executing receipt retry only the immutable same-ID approval, never the model');

      await clear(); mode = 'confirmation'; await send(); await card.getByRole('button', { name: 'Reject action', exact: true }).click();
      await expect(card.getByRole('status')).toContainText('It was not executed'); await ready(); assert.deepEqual(approvalRequests().at(-1)!.body, { decision: 'reject' });
      await check('explicit rejection has its own terminal receipt');
      await clear(); mode = 'expired'; const beforeExpired = approvalRequests().length; await send(); await expect(card.getByRole('status')).toContainText('expired');
      await expect(card.getByRole('button', { name: 'Approve exact action', exact: true })).toBeDisabled(); assert.equal(approvalRequests().length, beforeExpired);
      await check('expired confirmation cannot submit a decision');

      await clear(); mode = 'confirmation'; receiptMode = 'hold'; await send(); await card.getByRole('button', { name: 'Approve exact action', exact: true }).click();
      await expect(card.getByRole('status')).toContainText('Waiting for its receipt'); await clear(); await expect(page.locator('#aiStatus')).toContainText('may already have completed');
      await expect(card).toHaveCount(0); await check('Clear detaches pending approval without falsely claiming to undo submitted work');

      holdSettings = true; await page.locator('#aiReloadBtn').click(); await expect.poll(() => held.size).toBeGreaterThan(0);
      await page.locator('#aiSettingsToggle').click(); await page.locator('#aiLocalApiKey').fill('fictional-unsaved-key');
      await page.locator('#logoutBtn').click(); await expect(page.locator('#loginForm')).toBeVisible();
      assert.equal(await page.locator('#aiLocalApiKey').inputValue(), ''); assert.equal(await page.locator('#aiInput').inputValue(), '');
      holdSettings = false; freshSettings = true; mode = 'good'; await login(); await ready();
      await page.locator('#aiSettingsToggle').click(); await expect(page.locator('#aiLocalEndpoint')).toHaveValue('http://127.0.0.1:9/fresh');
      await expect(page.locator('#aiLocalApiKey')).toHaveValue(''); await expect(page.locator('.ai-msg')).toHaveCount(0);
      await check('logout aborts pending loads, clears sensitive AI fields and reloads settings for the new session');

      await page.locator('[data-tab="tab-bots"]').click(); const row = page.locator('#botsBody tr').filter({ hasText: 'Fictional legacy integration' });
      await expect(row).toContainText('unavailable'); await expect(row.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(0); await expect(row.getByRole('button', { name: 'Trigger', exact: true })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Disable', exact: true })).toBeVisible(); await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'Fictional legacy integration', exact: true }).click(); await expect(page.locator('#detailContent')).toContainText('Execution unavailable');
      await page.locator('[data-bot-action="run"]').first().click(); await expect(page.locator('#detailContent')).toContainText('Fictional retained run history');
      await page.getByRole('button', { name: 'Back to Bot', exact: true }).click(); await expect(page.locator('#detailContent')).toContainText('Execution unavailable');
      await page.locator('#closeDetailBtn').click(); await row.getByRole('button', { name: 'Disable', exact: true }).click(); await expect(row.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(0);
      page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'Delete', exact: true }).click(); await expect(row).toHaveCount(0);
      assert(!records.some(record => record.engine === engine && /\/bots\/.*\/(enable|trigger)$/.test(record.path)));
      await check('unavailable legacy integration preserves history and disable/delete controls, with real delegated CSP-safe clicks');
    } catch (error) {
      await page.screenshot({ path: join(evidence, `${engine}-failure.png`), animations: 'disabled' }).catch(() => {}); throw error;
    } finally { try { await context.close(); } finally { await browser.close(); } }
  }
} finally {
  for (const response of held) response.destroy();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, records, unexpected }, null, 2));
  console.log(JSON.stringify({ evidence, passed: results.length }));
}
