import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { executeTool } from '../lib/llm-tools';
import { IntegrationExecutor } from '../lib/integration-executor';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import type { ToolUseBlock } from '../types';

const call = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ id: 'call', type: 'tool_use', name, input });
beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.tasks.clear(), db.standaloneIOCs.clear(), db.installedIntegrations.clear(), db.integrationTemplates.clear(), db.integrationRuns.clear()]);
  localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem(workspaceStorageKey('threatcaddy-settings')); });

describe('integration tool cancellation boundaries', () => {
  it('passes cancellation to enrichment and rejects late entity output callbacks', async () => {
    await db.standaloneIOCs.add({ id: 'ioc', type: 'domain', value: 'example.test', confidence: 'medium', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    await db.integrationTemplates.add({ id: 'template', schemaVersion: '1.0', version: '1.0.0', name: 'Fixture enrichment', description: 'Synthetic', author: 'test', icon: 'search', color: '#000', category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: [], steps: [], outputs: [], requiredDomains: [], source: 'user', createdAt: 1, updatedAt: 1 });
    await db.installedIntegrations.add({ id: 'installed', templateId: 'template', name: 'Fixture', enabled: true, config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    const controller = new AbortController();
    vi.spyOn(IntegrationExecutor.prototype, 'run').mockImplementation(async (_template, _installation, _input, callbacks, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      await expect(callbacks.onCreateEntity?.('note', { title: 'Late output' })).rejects.toThrow();
      await expect(callbacks.onUpdateEntity?.('ioc', 'ioc', { value: 'changed.test' })).rejects.toThrow();
      throw new DOMException('Cancelled', 'AbortError');
    });
    const result = await executeTool(call('enrich_ioc', { iocId: 'ioc' }), undefined, undefined, { signal: controller.signal, allowedTools: new Set(['enrich_ioc']) });
    expect(result.isError).toBe(true); expect(result.result).toContain('cancelled');
    expect(await db.notes.count()).toBe(0); expect((await db.standaloneIOCs.get('ioc'))?.value).toBe('example.test');
    expect(await db.integrationRuns.count()).toBe(0);
  });

  it('cancels remote ticket fetch and reports unknown remote completion without local fallback writes', async () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ ticketEndpoint: 'https://tickets.example.test' }));
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      controller.abort();
      expect(options.signal?.aborted).toBe(true);
      throw new DOMException('Cancelled', 'AbortError');
    }));
    const result = await executeTool(call('create_ticket', { title: 'Review', description: 'Prepared summary' }), undefined, undefined, { signal: controller.signal, allowedTools: new Set(['create_ticket']) });
    expect(result.isError).toBe(true); expect(result.result).toContain('Remote completion is unknown');
    expect(await db.tasks.count()).toBe(0);
  });

  it('bounds SIEM responses and ignores a response returned after cancellation', async () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ siemEndpoint: 'https://siem.example.test' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('small fixture', { headers: { 'content-length': '3000000' } })));
    expect((await executeTool(call('query_siem', { query: 'prepared query' }))).isError).toBe(true);
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async () => { controller.abort(); return new Response('late result'); });
    const result = await executeTool(call('query_siem', { query: 'prepared query' }), undefined, undefined, { signal: controller.signal, allowedTools: new Set(['query_siem']) });
    expect(result.isError).toBe(true); expect(result.result).not.toContain('late result');
  });

  it('permits normal configured SIEM results and local ticket fallback', async () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ siemEndpoint: 'https://siem.example.test' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Prepared SIEM result')));
    expect(await executeTool(call('query_siem', { query: 'prepared query' }))).toEqual({ result: 'Prepared SIEM result', isError: false });
    const result = await executeTool(call('create_ticket', { title: 'Review', description: 'Prepared summary' }));
    expect(result.isError).toBe(false); expect(await db.tasks.count()).toBe(1);
  });
});
