import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { BulkEnrichModal } from '../components/Analysis/BulkEnrichModal';
import { autoEnrichImportedIOCs } from '../lib/ioc-auto-enrichment';
import { executeTool } from '../lib/llm-tools';
import type { StandaloneIOC } from '../types';
import type { InstalledIntegration, IntegrationRun, IntegrationStep, IntegrationTemplate } from '../types/integration-types';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false }) }));
vi.mock('../lib/integration-cancellation', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/integration-cancellation')>();
  return { ...actual, integrationDelay: async (_milliseconds: number, signal?: AbortSignal) => { signal?.throwIfAborted(); } };
});

type Caller = 'bulk' | 'automatic' | 'tool';
let fixtureNumber = 0;
const subject: StandaloneIOC = {
  id: 'subject', type: 'domain', value: 'example.test', confidence: 'medium', tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1,
};

function definition(steps: IntegrationStep[] = []): IntegrationTemplate {
  return {
    id: 'vt-domain-lookup', name: 'Local acknowledgement fixture', schemaVersion: '1.0', version: '1.0.0',
    description: 'Inert local fixture', author: 'Test', icon: 'search', color: '#000000',
    category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: [],
    steps, outputs: [], requiredDomains: ['example.test'], source: 'user', createdAt: 1, updatedAt: 1,
  };
}

async function invoke(caller: Caller, template: IntegrationTemplate, createNotes = true): Promise<IntegrationRun> {
  // Independent inert definitions must not share the modal's provider throttle.
  template = { ...template, requiredDomains: [`fixture-${++fixtureNumber}.example.test`] };
  if (caller === 'tool') template = { ...template, id: 'local-acknowledgement-fixture' };
  const installation: InstalledIntegration = {
    id: 'installation', templateId: template.id, name: template.name, enabled: true, config: {},
    scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1,
  };
  const addRun = vi.fn<(run: IntegrationRun) => Promise<void>>().mockResolvedValue(undefined);
  const getInstallationsForIOCType = () => [{ template, installation }];
  if (caller === 'automatic') {
    const stats = await autoEnrichImportedIOCs([subject], { getInstallationsForIOCType, addRun });
    expect(stats.enriched).toBe(addRun.mock.calls[0]?.[0].status === 'success' ? 1 : 0);
  } else if (caller === 'bulk') {
    const onCompleted = vi.fn();
    render(<BulkEnrichModal open onClose={() => {}} iocs={[subject]}
      getInstallationsForIOCType={getInstallationsForIOCType} addRun={addRun} onCompleted={onCompleted} />);
    if (createNotes) fireEvent.click(screen.getByRole('checkbox', { name: /Create enrichment notes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enrich 1 IOC' }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ success: addRun.mock.calls[0]?.[0].status === 'success' ? 1 : 0 }));
  } else {
    await db.integrationTemplates.add(template);
    await db.installedIntegrations.add(installation);
    await executeTool({ id: 'call', type: 'tool_use', name: 'enrich_ioc', input: { iocId: subject.id } });
    const run = await db.integrationRuns.toArray();
    expect(run).toHaveLength(1);
    return run[0];
  }
  expect(addRun).toHaveBeenCalledOnce();
  return addRun.mock.calls[0][0];
}

beforeEach(async () => {
  await Promise.all([db.standaloneIOCs.clear(), db.notes.clear(), db.tasks.clear(), db.integrationRuns.clear(),
    db.integrationTemplates.clear(), db.installedIntegrations.clear()]);
  await db.standaloneIOCs.add(subject);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(['bulk', 'automatic', 'tool'] as const)('%s integration callback acknowledgements', caller => {
  it('rejects unsupported updates without inventing an updated entity', async () => {
    const run = await invoke(caller, definition([{ id: 'update', label: 'Update', type: 'update-entity',
      entityType: 'note', entityId: 'missing', fields: { title: 'Local fixture' } }]));
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('only supports updating IOCs');
    expect(await db.notes.count()).toBe(0);
  });

  it.each(['missing', 'trashed'] as const)('refuses a %s IOC target without acknowledging a write', async state => {
    const target = { ...subject, id: 'target', trashed: true };
    if (state === 'trashed') await db.standaloneIOCs.add(target);
    const run = await invoke(caller, definition([{ id: 'update', label: 'Update', type: 'update-entity',
      entityType: 'ioc', entityId: 'target', fields: { confidence: 'high' } }]));
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('missing or deleted');
    expect(await db.standaloneIOCs.get('target')).toEqual(state === 'trashed' ? target : undefined);
  });

  it('acknowledges a supported committed IOC update', async () => {
    const run = await invoke(caller, definition([{ id: 'update', label: 'Update', type: 'update-entity',
      entityType: 'ioc', entityId: subject.id, fields: { confidence: 'high' } }]));
    expect(run).toMatchObject({ status: 'success', entitiesCreated: 0, entitiesUpdated: 1 });
    expect((await db.standaloneIOCs.get(subject.id))?.confidence).toBe('high');
  });
});

describe.each(['bulk', 'tool'] as const)('%s create callback acknowledgements', caller => {
  it('does not acknowledge an update when storage reports zero affected rows', async () => {
    vi.spyOn(db.standaloneIOCs, 'update').mockResolvedValueOnce(0);
    const run = await invoke(caller, definition([{ id: 'update', label: 'Update', type: 'update-entity',
      entityType: 'ioc', entityId: subject.id, fields: { confidence: 'high' } }]));
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('not saved');
    expect(await db.standaloneIOCs.get(subject.id)).toEqual(subject);
  });

  it('rejects unsupported creation without returning a fabricated ID', async () => {
    const template = definition();
    template.outputs = [{ type: 'create-task', template: { title: 'Local fixture' } }];
    const run = await invoke(caller, template);
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('only supports creating');
    expect(await db.tasks.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
  });

  it('acknowledges a supported committed note', async () => {
    const template = definition();
    template.outputs = [{ type: 'create-note', template: { title: 'Local fixture', content: 'Ordinary note' } }];
    const run = await invoke(caller, template);
    expect(run).toMatchObject({ status: 'success', entitiesCreated: 1, entitiesUpdated: 0 });
    expect(await db.notes.count()).toBe(1);
  });
});

it('keeps bulk note creation deliberately disabled without claiming a created entity', async () => {
  const template = definition();
  template.outputs = [{ type: 'create-note', template: { title: 'Local fixture' } }];
  const run = await invoke('bulk', template, false);
  expect(run).toMatchObject({ status: 'success', entitiesCreated: 0 });
  expect(await db.notes.count()).toBe(0);
});

it('refuses an already-trashed enrichment tool input without starting a run', async () => {
  await db.standaloneIOCs.update(subject.id, { trashed: true });
  const result = await executeTool({ id: 'call', type: 'tool_use', name: 'enrich_ioc', input: { iocId: subject.id } });
  expect(result.result).toContain('not found or deleted');
  expect(await db.integrationRuns.count()).toBe(0);
  expect(await db.notes.count()).toBe(0);
});
