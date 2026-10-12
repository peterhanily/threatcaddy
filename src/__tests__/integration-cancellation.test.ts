import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationExecutor, type ExecutionCallbacks, type ExecutionOptions } from '../lib/integration-executor';
import { integrationWrite } from '../lib/integration-cancellation';
import type { IntegrationStep, IntegrationTemplate, InstalledIntegration } from '../types/integration-types';

const installation: InstalledIntegration = { id: 'installed', templateId: 'fixture', name: 'Fixture', enabled: true,
  config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 };
const template = (steps: IntegrationStep[] = []): IntegrationTemplate => ({ id: 'fixture', schemaVersion: '1.0', version: '1',
  name: 'Cancellation fixture', description: '', author: 'test', icon: '', color: '', category: 'enrichment', tags: [],
  triggers: [{ type: 'manual' }], configSchema: [], steps, outputs: [
    { type: 'create-note', template: { title: 'Synthetic output' } }, { type: 'notify', template: { message: 'Complete' } },
  ], requiredDomains: ['example.com'], source: 'user', createdAt: 1, updatedAt: 1 });
const http: IntegrationStep = { id: 'fetch', label: 'Fetch', type: 'http', method: 'GET', url: 'https://example.com/fixture' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup(steps: IntegrationStep[] = [], options?: ExecutionOptions) {
  const controller = new AbortController();
  const callbacks: ExecutionCallbacks = { onCreateEntity: vi.fn().mockResolvedValue('note'), onNotify: vi.fn() };
  return { controller, callbacks, run: () => new IntegrationExecutor().run(template(steps), installation, {}, callbacks, controller.signal, options) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete document.documentElement.dataset.tcBridgeCaps; });

describe('integration cancellation ownership', () => {
  it('never executes a step, output or notification for a pre-aborted run', async () => {
    const h = setup([{ id: 'create', label: 'Create', type: 'create-entity', entityType: 'note', fields: {} }]);
    h.controller.abort();
    expect(await h.run()).toMatchObject({ status: 'cancelled', entitiesCreated: 0, displayResults: undefined });
    expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled(); expect(h.callbacks.onNotify).not.toHaveBeenCalled();
  });
  it('stops waiting for a shared token lookup and never starts a proxy request after its late result', async () => {
    const token = deferred<string>(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const getAccessToken = vi.fn(() => token.promise);
    const h = setup([http], { useServerProxy: { serverUrl: 'https://server.example.test', getAccessToken } });
    const run = h.run(); expect(getAccessToken).toHaveBeenCalledOnce(); h.controller.abort();
    expect((await run).status).toBe('cancelled'); token.resolve('synthetic-token'); await token.promise;
    expect(fetch).not.toHaveBeenCalled(); expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled();
  });
  it.each(['direct', 'server'])('cancels %s response-body waiting without processing late content', async transport => {
    const body = deferred<unknown>();
    const response = transport === 'server' ? { ok: true, status: 200, json: () => body.promise, headers: new Headers() }
      : new Response(new ReadableStream({ start(controller) {
        void body.promise.then(value => { try { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } catch { /* reader was cancelled */ } });
      } }));
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    const h = setup([http], transport === 'server' ? { useServerProxy: { serverUrl: 'https://server.example.test', getAccessToken: async () => null } } : undefined);
    const run = h.run(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); h.controller.abort();
    expect((await run).status).toBe('cancelled'); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    body.resolve({ status: 200, data: 'late' }); await body.promise;
    expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled(); expect(h.callbacks.onNotify).not.toHaveBeenCalled();
  });
  it('cancels retry backoff without a second request or later output', async () => {
    vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const h = setup([{ ...http, retry: { maxRetries: 2, backoffMs: 60000, retryOn: [503] } }]);
    const run = h.run(); await vi.advanceTimersByTimeAsync(1); h.controller.abort();
    expect((await run).status).toBe('cancelled'); await vi.advanceTimersByTimeAsync(120000);
    expect(fetch).toHaveBeenCalledOnce(); expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled();
  });
  it('cancels a long delay immediately and also responds to workspace switching without a caller signal', async () => {
    vi.useFakeTimers(); const callbacks = { onCreateEntity: vi.fn(), onNotify: vi.fn() };
    const run = new IntegrationExecutor().run(template([{ id: 'wait', type: 'delay', label: 'Wait', ms: 200000 }]), installation, {}, callbacks);
    window.dispatchEvent(new Event('workspace-will-switch'));
    expect((await run).status).toBe('cancelled'); expect(vi.getTimerCount()).toBe(0);
    expect(callbacks.onCreateEntity).not.toHaveBeenCalled();
  });
  it('keeps the execution deadline active through a delay and never processes timed-out outputs', async () => {
    vi.useFakeTimers(); const h = setup([{ id: 'wait', type: 'delay', label: 'Wait', ms: 400000 }]);
    const run = h.run(); await vi.advanceTimersByTimeAsync(300001);
    expect((await run).status).toBe('timeout'); expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled();
    expect(h.callbacks.onNotify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('stops extension waiting, posts scoped cancellation, and removes the response listener', async () => {
    document.documentElement.dataset.tcBridgeCaps = 'proxy_fetch,proxy_fetch_abort';
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const add = vi.spyOn(window, 'addEventListener'); const remove = vi.spyOn(window, 'removeEventListener');
    const h = setup([http]); const run = h.run();
    const request = post.mock.calls[0][0]; h.controller.abort();
    expect((await run).status).toBe('cancelled');
    expect(post).toHaveBeenCalledWith({ type: 'TC_PROXY_ABORT', requestId: request.requestId }, expect.any(String));
    const listener = add.mock.calls.find(([type]) => type === 'message')?.[1];
    expect(remove).toHaveBeenCalledWith('message', listener);
    expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled();
  });
  it('cleans up a bridge listener when posting the request itself fails', async () => {
    vi.useFakeTimers(); document.documentElement.dataset.tcBridgeCaps = 'proxy_fetch';
    vi.spyOn(window, 'postMessage').mockImplementation(() => { throw new Error('Synthetic unavailable bridge'); });
    const add = vi.spyOn(window, 'addEventListener'); const remove = vi.spyOn(window, 'removeEventListener');
    const h = setup([http]); expect((await h.run()).status).toBe('error');
    expect(remove).toHaveBeenCalledWith('message', add.mock.calls.find(([type]) => type === 'message')?.[1]);
    expect(vi.getTimerCount()).toBe(0); expect(h.callbacks.onCreateEntity).not.toHaveBeenCalled();
  });
  it('does not start the next output after a callback cancels, and passes the owned signal to the write', async () => {
    const h = setup(); h.callbacks.onCreateEntity = vi.fn(async (_type, _fields, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal); h.controller.abort(); return 'already-committed';
    });
    expect(await h.run()).toMatchObject({ status: 'cancelled', entitiesCreated: 1 }); expect(h.callbacks.onNotify).not.toHaveBeenCalled();
  });
  it.each(['create-step', 'update-step', 'create-output', 'update-output', 'create-branch'] as const)(
    'acknowledges the committed %s before stopping subsequent work', async mode => {
      const database = new Dexie('integration-commit-accounting-' + mode); database.version(1).stores({ records: 'id' });
      const records = database.table('records'); const controller = new AbortController();
      const update = mode.startsWith('update'); const output = mode.endsWith('output');
      if (update) await records.add({ id: 'entity', content: 'before' });
      const commit = (signal?: AbortSignal) => integrationWrite([records], signal, async () => {
        const transaction = Dexie.currentTransaction;
        if (!transaction) throw new Error('Expected active fixture transaction');
        // Native commit happens before the write helper acknowledges it. Abort
        // here must not reclassify that committed transaction as a failed write.
        transaction.idbtrans.addEventListener('complete', () => controller.abort());
        if (update) await records.update('entity', { content: 'committed' });
        else await records.add({ id: 'entity', content: 'committed' });
        return 'entity';
      });
      const onCreateEntity = vi.fn(async (_type: string, _fields: Record<string, unknown>, signal?: AbortSignal) => commit(signal));
      const onUpdateEntity = vi.fn(async (_type: string, _id: string, _fields: Record<string, unknown>, signal?: AbortSignal) => { await commit(signal); });
      const onNotify = vi.fn();
      const value = template(output ? [] : [update
        ? { id: 'update', type: 'update-entity', label: 'Update', entityType: 'ioc', entityId: 'entity', fields: {} }
        : { id: 'create', type: 'create-entity', label: 'Create', entityType: 'note', fields: {} }]);
      if (mode === 'create-branch') value.steps.unshift({ id: 'branch', type: 'condition', label: 'Branch', expression: '1 == 1', thenSteps: ['create'] });
      if (output && update) value.outputs.unshift({ type: 'update-ioc', template: { id: 'entity', confidence: 'high' } });
      try {
        const result = await new IntegrationExecutor().run(value, installation, {}, { onCreateEntity, onUpdateEntity, onNotify }, controller.signal);
        expect(result).toMatchObject({ status: 'cancelled', entitiesCreated: update ? 0 : 1, entitiesUpdated: update ? 1 : 0 });
        expect(await records.toArray()).toEqual([{ id: 'entity', content: 'committed' }]);
        expect(onCreateEntity).toHaveBeenCalledTimes(update ? 0 : 1);
        expect(onUpdateEntity).toHaveBeenCalledTimes(update ? 1 : 0); expect(onNotify).not.toHaveBeenCalled();
      } finally { await database.delete(); }
    });
  it('retains previous output counts when cancellation is observed at the start of a later output', async () => {
    const h = setup(); h.callbacks.onNotify = vi.fn(() => h.controller.abort());
    const value = template(); value.outputs.push({ type: 'create-note', template: { title: 'Must not start' } });
    const result = await new IntegrationExecutor().run(value, installation, {}, h.callbacks, h.controller.signal);
    expect(result).toMatchObject({ status: 'cancelled', entitiesCreated: 1 });
    expect(h.callbacks.onCreateEntity).toHaveBeenCalledOnce(); expect(h.callbacks.onNotify).toHaveBeenCalledOnce();
  });
  it('rolls back a still-active IndexedDB output transaction when cancellation occurs during the write', async () => {
    const database = new Dexie('integration-cancellation-fixture'); database.version(1).stores({ records: 'id' });
    const records = database.table('records'); const h = setup();
    const cancel = () => { h.controller.abort(); }; records.hook('creating', cancel);
    h.callbacks.onCreateEntity = async (_type, _fields, signal) => integrationWrite([records], signal, async () => {
      await records.add({ id: 'synthetic-note' }); return 'synthetic-note';
    });
    try {
      expect(await h.run()).toMatchObject({ status: 'cancelled', entitiesCreated: 0 }); expect(await records.count()).toBe(0);
      expect(h.callbacks.onNotify).not.toHaveBeenCalled();
    } finally { records.hook('creating').unsubscribe(cancel); await database.delete(); }
  });
  it('leaves an earlier committed transaction intact when a later operation is cancelled', async () => {
    const database = new Dexie('integration-committed-fixture'); database.version(1).stores({ records: 'id' });
    const controller = new AbortController(); const records = database.table('records');
    try {
      await integrationWrite([records], controller.signal, () => records.add({ id: 'committed' }));
      controller.abort();
      await expect(integrationWrite([records], controller.signal, () => records.add({ id: 'not-started' }))).rejects.toThrow();
      expect(await records.toArray()).toEqual([{ id: 'committed' }]);
    } finally { await database.delete(); }
  });
});
