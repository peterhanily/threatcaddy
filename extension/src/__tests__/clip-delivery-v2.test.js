import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../background.js'), 'utf8');
const TARGET = 'https://paired.example.test/app';
const hook = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
const clone = value => structuredClone(value);
function harness(storage = {}) {
  let listener;
  const delivered = [];
  const h = { storage, delivered, ready: true, documentToken: 'document-one', workspaceId: 'default' };
  const chrome = {
    runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path.replace(/^\//, ''),
      onMessage: { addListener: fn => { listener = fn; } }, onInstalled: hook(), onConnect: hook() },
    storage: { local: {
      get: vi.fn(async keys => Object.fromEntries(keys.map(key => [key, clone(storage[key])]))),
      set: vi.fn(async values => { Object.assign(storage, clone(values)); }),
      remove: vi.fn(async key => { delete storage[key]; }),
    }, onChanged: hook() },
    scripting: { unregisterContentScripts: vi.fn().mockResolvedValue(), registerContentScripts: vi.fn().mockResolvedValue(), executeScript: vi.fn().mockResolvedValue([]) },
    contextMenus: { onClicked: hook(), create: vi.fn() }, commands: { onCommand: hook() },
    tabs: { onUpdated: hook(), query: vi.fn(async () => [{ id: 7, url: TARGET, status: 'complete', lastAccessed: 1 }]),
      get: vi.fn(async () => ({ id: 7, url: TARGET, status: 'complete' })), create: vi.fn(),
      sendMessage: vi.fn(async (_id, message) => {
        if (message.type === 'GET_CLIP_IMPORT_TARGET') return { ready: h.ready, protocol: 2, workspaceId: h.workspaceId,
          workspaceLabel: 'Synthetic local workspace', documentToken: h.documentToken };
        delivered.push(clone(message.envelope));
        if (h.onDeliver) await h.onDeliver(message.envelope);
        return { delivered: true, confirmed: false };
      }) },
    i18n: { getMessage: key => key }, permissions: { contains: vi.fn().mockResolvedValue(true) },
    action: { setBadgeText: vi.fn().mockResolvedValue(), setTitle: vi.fn().mockResolvedValue() },
  };
  const context = createContext({ chrome, crypto: webcrypto, URL, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, console, Date });
  new Script(source).runInContext(context);
  const internal = { id: 'fixture', url: 'chrome-extension://fixture/pages/clips.html' };
  const sender = { id: 'fixture', url: TARGET, frameId: 0, tab: { id: 7, url: TARGET } };
  const message = (payload, from = internal) => new Promise(done => listener(payload, from, done));
  Object.assign(h, { chrome, context, sender, message,
    approve: () => message({ type: 'APPROVE_APP', targetUrl: TARGET }),
    save: (content = 'Harmless clip') => message({ type: 'SAVE_NOTE', note: { title: 'Fixture', content } }),
    prepare: () => message({ type: 'PREPARE_CLIP_DELIVERY', targetUrl: TARGET }),
    ack: (envelope, results, extras = {}, from = sender) => message({ type: 'CLIP_IMPORT_RESULT', result: {
      protocol: 2, sourceId: envelope.sourceId, attemptId: envelope.attemptId, workspaceId: h.workspaceId,
      documentToken: h.documentToken, results: results || envelope.clips.map(clip => ({ id: clip.id, revision: clip.revision,
        fingerprint: clip.fingerprint, status: 'imported', entityId: 'entity-' + clip.id, entityType: clip.entityType })), ...extras,
    } }, from),
  });
  return h;
}
const references = h => h.storage.captures.map(({ id, revision = 1 }) => ({ id, revision }));
async function prepared(h, count = 1) {
  expect((await h.approve()).success).toBe(true);
  for (let i = 0; i < count; i++) expect((await h.save('Harmless ' + i)).success).toBe(true);
  const result = await h.prepare(); expect(result.success).toBe(true); return result;
}
afterEach(() => vi.useRealTimers());

describe('destination preparation navigation ownership', () => {
  it('waits through a new Firefox blank complete document before probing the intended app', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve();
    h.chrome.tabs.query.mockResolvedValue([]);
    h.chrome.tabs.create.mockResolvedValue({ id: 7, url: 'about:blank', status: 'complete' });
    h.chrome.tabs.get.mockResolvedValueOnce({ id: 7, url: 'about:blank', status: 'complete' })
      .mockResolvedValueOnce({ id: 7, url: TARGET, status: 'loading' });
    const pending = h.prepare();
    await vi.waitFor(() => expect(h.chrome.tabs.get).toHaveBeenCalled());
    expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(h.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toMatchObject({ success: true, workspaceId: 'default' });
    expect(h.chrome.scripting.executeScript).toHaveBeenCalledOnce();
    expect(h.delivered).toHaveLength(0);
  });
  it('bounds a new tab that never leaves its initial blank document without injecting', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve();
    h.chrome.tabs.query.mockResolvedValue([]);
    h.chrome.tabs.create.mockResolvedValue({ id: 7, url: 'about:blank', status: 'complete' });
    h.chrome.tabs.get.mockResolvedValue({ id: 7, url: 'about:blank', status: 'complete' });
    const pending = h.prepare();
    await vi.waitFor(() => expect(h.chrome.tabs.get).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(30250);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('30 seconds') });
    expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('stops an initial navigation wait when approval is revoked or replaced', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve();
    h.chrome.tabs.query.mockResolvedValue([]);
    h.chrome.tabs.create.mockResolvedValue({ id: 7, url: 'about:blank', status: 'complete' });
    h.chrome.tabs.get.mockResolvedValue({ id: 7, url: 'about:blank', status: 'complete' });
    const pending = h.prepare();
    await vi.waitFor(() => expect(h.chrome.tabs.get).toHaveBeenCalled());
    await h.message({ type: 'REVOKE_APPS' }); await h.approve();
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('approval changed') });
    expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(h.chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('rereads approval after a delayed final browser lookup before injection', async () => {
    const h = harness(); await h.approve();
    h.chrome.tabs.get.mockResolvedValueOnce({ id: 7, url: TARGET, status: 'complete' })
      .mockImplementationOnce(async () => {
        await h.message({ type: 'REVOKE_APPS' });
        return { id: 7, url: TARGET, status: 'complete' };
      });
    expect(await h.prepare()).toMatchObject({ success: false, error: expect.stringContaining('approval changed') });
    expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(h.chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('rejects a completed foreign redirect without injecting or probing', async () => {
    const h = harness(); await h.approve();
    h.chrome.tabs.get.mockResolvedValue({ id: 7, url: 'https://elsewhere.example.test', status: 'complete' });
    expect(await h.prepare()).toMatchObject({ success: false, error: expect.stringContaining('different app') });
    expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(h.chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('allows a cold app to become ready beyond the former four-probe limit', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve(); let probes = 0;
    h.chrome.tabs.sendMessage.mockImplementation(async () => ({ protocol: 2, ready: ++probes >= 6,
      workspaceId: 'default', documentToken: 'same-document' }));
    const pending = h.prepare();
    await vi.waitFor(() => expect(probes).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toMatchObject({ success: true });
    expect(probes).toBe(6);
    expect(h.delivered).toHaveLength(0);
  });
  it('rejects a changed workspace during a cold readiness wait', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve();
    h.chrome.tabs.sendMessage.mockResolvedValueOnce({ protocol: 2, ready: false, workspaceId: 'default', documentToken: 'one' })
      .mockResolvedValueOnce({ protocol: 2, ready: true, workspaceId: 'other-workspace', documentToken: 'two' });
    const pending = h.prepare();
    await vi.waitFor(() => expect(h.chrome.tabs.sendMessage).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('workspace changed') });
    expect(h.delivered).toHaveLength(0);
  });
  it('bounds readiness failure and never opens a clip delivery attempt', async () => {
    vi.useFakeTimers(); const h = harness(); await h.approve(); h.ready = false;
    const pending = h.prepare();
    await vi.waitFor(() => expect(h.chrome.tabs.sendMessage).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10250);
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('unlocked workspace') });
    expect(h.storage.clipDeliveryV2).toBeUndefined();
    expect(h.delivered).toHaveLength(0);
  });
});

describe('single-writer capture storage', () => {
  it('serializes simultaneous captures without dropping content', async () => {
    const h = harness();
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => h.save('clip ' + i)));
    expect(results.every(result => result.success)).toBe(true);
    expect(new Set(h.storage.captures.map(clip => clip.id)).size).toBe(24);
    expect(h.storage.captures.map(clip => clip.content)).toEqual(Array.from({ length: 24 }, (_, i) => 'clip ' + i));
  });
  it('refuses capture 501 without evicting any sent or unsent record', async () => {
    const storage = { captures: Array.from({ length: 500 }, (_, i) => ({ id: 'legacy-' + i, sent: i % 2 === 0 })) };
    const before = clone(storage); const h = harness(storage);
    expect(await h.save()).toMatchObject({ success: false, error: expect.stringContaining('500') });
    expect(storage).toEqual(before);
  });
  it('does not poison the mutation queue after a rejected storage write', async () => {
    const h = harness(); h.chrome.storage.local.set.mockRejectedValueOnce(new Error('Synthetic quota failure'));
    expect((await h.save('first')).success).toBe(false);
    expect((await h.save('second')).success).toBe(true);
    expect(h.storage.captures.map(clip => clip.content)).toEqual(['second']);
  });
  it('reports context-menu capacity refusal visibly without claiming capture success', async () => {
    const h = harness({ captures: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) });
    expect(await h.context.captureAndSave('Harmless extra clip', { id: 7, url: TARGET })).toBe(false);
    expect(h.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(h.storage.captureErrorV1).toContain('500');
    expect(h.chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('still confirms a committed save when cosmetic badge cleanup throws synchronously', async () => {
    const h = harness(); h.chrome.action.setBadgeText.mockImplementation(() => { throw new Error('Synthetic badge failure'); });
    expect((await h.save()).success).toBe(true);
    expect(h.storage.captures).toHaveLength(1);
  });
  it('edits with revisions and rejects a stale destructive confirmation', async () => {
    const h = harness(); await h.save(); const clips = references(h);
    expect((await h.message({ type: 'UPDATE_CAPTURES', clips, values: { folderName: 'Research' } })).success).toBe(true);
    expect(h.storage.captures[0]).toMatchObject({ revision: 2, folderName: 'Research', sent: false });
    expect((await h.message({ type: 'DELETE_CAPTURES', clips })).success).toBe(false);
    expect(h.storage.captures).toHaveLength(1);
  });
  it('clear confirmation deletes only its snapshot and retains a later capture', async () => {
    const h = harness(); await h.save('first'); const clips = references(h); await h.save('later');
    expect((await h.message({ type: 'DELETE_CAPTURES', clips })).success).toBe(true);
    expect(h.storage.captures.map(clip => clip.content)).toEqual(['later']);
  });
  it('preserves concurrent approvals and gives reapproval fresh authority at the same clock', async () => {
    const h = harness(); vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      await Promise.all([h.approve(), h.message({ type: 'APPROVE_APP', targetUrl: 'https://other.example.test' })]);
      expect(Object.keys(h.storage.approvedAppsV1)).toHaveLength(2);
      const generation = h.storage.approvedAppsV1[new URL(TARGET).origin].generation;
      await h.message({ type: 'REVOKE_APPS' }); await h.approve();
      expect(h.storage.approvedAppsV1[new URL(TARGET).origin].generation).not.toBe(generation);
    } finally { vi.restoreAllMocks(); }
  });
  it('reconciles registrations in order after concurrent approval and revoke', async () => {
    const h = harness();
    await Promise.all([h.approve(), h.message({ type: 'REVOKE_APPS' })]);
    expect(h.storage.approvedAppsV1).toEqual({});
    expect(h.chrome.scripting.unregisterContentScripts.mock.invocationCallOrder.at(-1))
      .toBeGreaterThan(h.chrome.scripting.registerContentScripts.mock.invocationCallOrder.at(-1));
  });
});

describe('durable, destination-bound clip confirmations', () => {
  it('matches the canonical application SHA256 vector', async () => {
    const h = harness();
    const clip = { id: 'clip-example', revision: 1, title: 'Synthetic café', content: 'A fictional research note.',
      sourceUrl: 'https://example.com/research', sourceTitle: 'Example', entityType: 'note', folderName: 'Clips', clsLevel: 'TLP:CLEAR', createdAt: 1700000000000 };
    expect(await h.context.fingerprintClip(clip)).toBe('97493d328cfb2bf4cae5d13b07ba6e99ad6c3818bf11dd44505f69175f40450e');
  });
  it('marks sent only after matching per-clip commit receipts and sends no storage-only fields', async () => {
    const h = harness(); const session = await prepared(h, 2);
    h.onDeliver = async envelope => {
      expect(h.storage.captures.every(clip => !clip.sent)).toBe(true);
      expect(envelope.clips.every(clip => clip.sent === undefined && clip.delivery === undefined)).toBe(true);
      await h.ack(envelope);
    };
    expect(await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) }))
      .toMatchObject({ success: true, confirmed: 2, total: 2 });
    expect(h.storage.captures.every(clip => clip.delivery.status === 'confirmed' && clip.sent)).toBe(true);
  });
  it('keeps partial failures unsent instead of acknowledging the whole batch', async () => {
    const h = harness(); const session = await prepared(h, 2);
    h.onDeliver = envelope => h.ack(envelope, envelope.clips.map((clip, i) => ({ id: clip.id, revision: clip.revision,
      fingerprint: clip.fingerprint, status: i ? 'failed' : 'imported', entityId: 'record', entityType: clip.entityType, error: 'Synthetic import failure' })));
    expect(await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) }))
      .toMatchObject({ success: false, status: 'partial', confirmed: 1 });
    expect(h.storage.captures.map(clip => clip.sent)).toEqual([true, false]);
  });
  it('persists an attempt before transport and accepts a late receipt after worker restart', async () => {
    const h = harness(); const session = await prepared(h);
    h.onDeliver = () => { throw new Error('Synthetic message channel closed'); };
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).success).toBe(false);
    const restarted = harness(h.storage);
    expect(await restarted.ack(h.delivered[0])).toMatchObject({ success: true, accepted: 1 });
    expect(h.storage.captures[0]).toMatchObject({ sent: true, delivery: { status: 'confirmed' } });
    expect(await restarted.ack(h.delivered[0])).toMatchObject({ success: true, accepted: 0 });
  });
  it('never marks a revised clip sent from an older in-flight receipt', async () => {
    const h = harness(); const session = await prepared(h);
    h.onDeliver = async envelope => {
      await h.message({ type: 'UPDATE_CAPTURES', clips: references(h), values: { folderName: 'New folder' } });
      expect((await h.ack(envelope)).accepted).toBe(0);
    };
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).success).toBe(false);
    expect(h.storage.captures[0]).toMatchObject({ revision: 2, sent: false, folderName: 'New folder' });
  });
  it.each(['workspace', 'document', 'tab', 'approval'])('rejects a receipt with changed %s ownership', async boundary => {
    const h = harness(); const session = await prepared(h);
    h.onDeliver = () => { throw new Error('Receipt delayed'); };
    await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) });
    if (boundary === 'approval') { await h.message({ type: 'REVOKE_APPS' }); await h.approve(); }
    const extra = boundary === 'workspace' ? { workspaceId: 'other' } : boundary === 'document' ? { documentToken: 'new-document' } : {};
    const sender = boundary === 'tab' ? { ...h.sender, tab: { ...h.sender.tab, id: 8 } } : h.sender;
    expect((await h.ack(h.delivered[0], undefined, extra, sender)).success).toBe(false);
    expect(h.storage.captures[0].sent).toBe(false);
  });
  it.each(['entityType', 'entityId'])('does not confirm an incompatible %s receipt', async field => {
    const h = harness(); const session = await prepared(h);
    h.onDeliver = envelope => h.ack(envelope, envelope.clips.map(clip => ({ id: clip.id, revision: clip.revision,
      fingerprint: clip.fingerprint, status: 'imported', entityType: field === 'entityType' ? 'task' : 'note', entityId: field === 'entityId' ? 'x'.repeat(129) : 'record' })));
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).confirmed).toBe(0);
    expect(h.storage.captures[0].sent).toBe(false);
  });
  it('does not deliver after the confirmed document or workspace changes', async () => {
    const h = harness(); const session = await prepared(h); h.documentToken = 'navigated';
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).success).toBe(false);
    expect(h.delivered).toHaveLength(0);
  });
  it('times out a hop acknowledgement without changing sent state', async () => {
    vi.useFakeTimers(); const h = harness(); const session = await prepared(h);
    const pending = h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) });
    await vi.waitFor(() => expect(h.delivered).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(10001);
    expect(await pending).toMatchObject({ success: false, confirmed: 0 });
    expect(h.storage.captures[0]).toMatchObject({ sent: false, delivery: { status: 'pending' } });
  });
  it('chunks a send-all snapshot into bounded per-attempt batches', async () => {
    const h = harness(); const session = await prepared(h, 21); h.onDeliver = envelope => h.ack(envelope);
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).confirmed).toBe(21);
    expect(h.delivered.map(envelope => envelope.clips.length)).toEqual([20, 1]);
  });
  it('waits for a transient same-workspace refresh between committed batches', async () => {
    const h = harness(); const session = await prepared(h, 21);
    const original = h.chrome.tabs.sendMessage.getMockImplementation(); let busyProbes = 0;
    h.chrome.tabs.sendMessage.mockImplementation(async (id, message) => {
      if (message.type === 'GET_CLIP_IMPORT_TARGET' && h.delivered.length === 1 && busyProbes++ < 2) {
        return { protocol: 2, ready: false, workspaceId: h.workspaceId, documentToken: h.documentToken };
      }
      return original(id, message);
    });
    h.onDeliver = envelope => h.ack(envelope);
    expect((await h.message({ type: 'SEND_TO_TARGET', sessionId: session.sessionId, clips: references(h) })).confirmed).toBe(21);
    expect(busyProbes).toBeGreaterThanOrEqual(3);
  });
});
