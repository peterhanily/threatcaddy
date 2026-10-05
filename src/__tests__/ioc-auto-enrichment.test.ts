import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { autoEnrichImportedIOCs } from '../lib/ioc-auto-enrichment';
import type { StandaloneIOC } from '../types';
import type { InstalledIntegration, IntegrationConfigField, IntegrationTemplate } from '../types/integration-types';

const runIntegration = vi.hoisted(() => vi.fn());

// Simulate a VirusTotal integration run that succeeds AND emits an IOC update
// (which unions tags via persistIOCIntegrationUpdate, transiently double-tagging
// queued+checked) so we can assert the final tag set is cleaned to just checked.
vi.mock('../lib/integration-executor', () => ({
  IntegrationExecutor: vi.fn().mockImplementation(function () {
    return { run: runIntegration };
  }),
}));

function makeMatch(config: Record<string, unknown>, fields: IntegrationConfigField[] = [{
  key: 'apiKey', label: 'API key', type: 'password', required: true, secret: true,
}]): { installation: InstalledIntegration; template: IntegrationTemplate } {
  return {
    installation: {
      id: 'inst-1', templateId: 'vt-domain-lookup', name: 'Fictional VT fixture', enabled: true,
      config, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0,
      createdAt: 0, updatedAt: 0,
    },
    template: {
      id: 'vt-domain-lookup', name: 'Fictional VT fixture', schemaVersion: '1.0', version: '1.0.0',
      description: 'Local test fixture', author: 'Test', icon: 'search', color: '#000000',
      category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: fields,
      steps: [], outputs: [], requiredDomains: [], source: 'user', createdAt: 0, updatedAt: 0,
    },
  };
}

function makeIOC(overrides: Partial<StandaloneIOC> = {}): StandaloneIOC {
  const now = Date.now();
  return {
    id: overrides.id || 'ioc-1',
    type: overrides.type || 'domain',
    value: overrides.value || 'evil.example.com',
    confidence: overrides.confidence || 'medium',
    folderId: overrides.folderId || 'folder-1',
    tags: overrides.tags || ['source:evidence'],
    relationships: overrides.relationships || [],
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('autoEnrichImportedIOCs', () => {
  beforeEach(async () => {
    await db.standaloneIOCs.clear();
    runIntegration.mockReset();
    runIntegration.mockImplementation(async (
      _template: IntegrationTemplate,
      _installation: InstalledIntegration,
      input: { ioc: { id: string } },
      callbacks: { onUpdateEntity?: (type: string, id: string, fields: Record<string, unknown>) => Promise<void> },
    ) => {
      await callbacks.onUpdateEntity?.('ioc', input.ioc.id, { enrichment: { vt: { detections: 5 } } });
      return { id: 'run-1', status: 'success' };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks extracted evidence IOCs as skipped when VirusTotal is not installed', async () => {
    const ioc = makeIOC();
    await db.standaloneIOCs.add(ioc);
    const onComplete = vi.fn();

    const stats = await autoEnrichImportedIOCs([ioc], {
      getInstallationsForIOCType: () => [],
      addRun: vi.fn(),
      onComplete,
    });

    expect(stats).toMatchObject({
      queued: 1,
      enriched: 0,
      errors: 0,
      skipped: 1,
      missingIntegration: 1,
    });
    expect(onComplete).toHaveBeenCalledWith(stats);
    const stored = await db.standaloneIOCs.get(ioc.id);
    expect(stored?.tags).toContain('auto-enrich:vt:skipped');
  });

  it('marks a successfully-enriched IOC as checked with no lingering queued tag', async () => {
    const ioc = makeIOC();
    await db.standaloneIOCs.add(ioc);

    const stats = await autoEnrichImportedIOCs([ioc], {
      getInstallationsForIOCType: () => [makeMatch({ apiKey: 'fictional-test-token' })],
      addRun: vi.fn(),
    });

    expect(stats).toMatchObject({ enriched: 1, errors: 0 });
    const stored = await db.standaloneIOCs.get(ioc.id);
    const autoTags = (stored?.tags || []).filter((t) => t.startsWith('auto-enrich:vt:'));
    // Exactly one auto-enrich status tag, and it's 'checked' — no stale 'queued'.
    expect(autoTags).toEqual(['auto-enrich:vt:checked']);
  });

  it.each([undefined, null, '', ' \t\n ', [], {}])('does not execute or mutate an IOC for missing required config (%j)', async value => {
    const ioc = makeIOC({ updatedAt: 123, tags: ['source:evidence', 'auto-enrich:vt:checked'] });
    await db.standaloneIOCs.add(ioc);
    const update = vi.spyOn(db.standaloneIOCs, 'update');
    const addRun = vi.fn();
    const onComplete = vi.fn();
    const stats = await autoEnrichImportedIOCs([ioc], {
      getInstallationsForIOCType: () => [makeMatch({ apiKey: value })],
      addRun,
      onComplete,
    });

    expect(stats).toMatchObject({ queued: 1, errors: 1, enriched: 0, missingIntegration: 0 });
    expect(onComplete).toHaveBeenCalledWith(stats);
    expect(runIntegration).not.toHaveBeenCalled();
    expect(addRun).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await db.standaloneIOCs.get(ioc.id)).toEqual(ioc);
    expect(JSON.stringify(stats)).not.toContain('apiKey');
  });

  it('continues to queue and run when required config uses defaults or valid false/zero values', async () => {
    const ioc = makeIOC();
    await db.standaloneIOCs.add(ioc);
    const match = makeMatch({ flag: false, limit: 0 }, [
      { key: 'apiKey', label: 'API key', type: 'password', required: true, secret: true, default: 'fictional-default-token' },
      { key: 'flag', label: 'Flag', type: 'boolean', required: true },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ]);
    const addRun = vi.fn();
    const stats = await autoEnrichImportedIOCs([ioc], {
      getInstallationsForIOCType: () => [match],
      addRun,
    });

    expect(stats).toMatchObject({ queued: 1, errors: 0, enriched: 1 });
    expect(runIntegration).toHaveBeenCalledOnce();
    expect(addRun).toHaveBeenCalledOnce();
    expect(match.installation.config).toEqual({ flag: false, limit: 0 });
    expect((await db.standaloneIOCs.get(ioc.id))?.tags).toContain('auto-enrich:vt:checked');
  });
});
