import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { autoEnrichImportedIOCs } from '../lib/ioc-auto-enrichment';
import type { StandaloneIOC } from '../types';

// Simulate a VirusTotal integration run that succeeds AND emits an IOC update
// (which unions tags via persistIOCIntegrationUpdate, transiently double-tagging
// queued+checked) so we can assert the final tag set is cleaned to just checked.
vi.mock('../lib/integration-executor', () => ({
  IntegrationExecutor: vi.fn().mockImplementation(function () {
    return {
      run: vi.fn(async (_template: unknown, _installation: unknown, input: { ioc: { id: string } }, callbacks: { onUpdateEntity?: (type: string, id: string, fields: Record<string, unknown>) => Promise<void> }) => {
        await callbacks?.onUpdateEntity?.('ioc', input.ioc.id, { enrichment: { vt: { detections: 5 } } });
        return { id: 'run-1', status: 'success' };
      }),
    };
  }),
}));

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
  });

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
      getInstallationsForIOCType: () => [{
        installation: { id: 'inst-1', templateId: 'vt-domain-lookup' } as never,
        template: { id: 'vt-domain-lookup', name: 'VT Domain' } as never,
      }],
      addRun: vi.fn(),
    });

    expect(stats).toMatchObject({ enriched: 1, errors: 0 });
    const stored = await db.standaloneIOCs.get(ioc.id);
    const autoTags = (stored?.tags || []).filter((t) => t.startsWith('auto-enrich:vt:'));
    // Exactly one auto-enrich status tag, and it's 'checked' — no stale 'queued'.
    expect(autoTags).toEqual(['auto-enrich:vt:checked']);
  });
});
