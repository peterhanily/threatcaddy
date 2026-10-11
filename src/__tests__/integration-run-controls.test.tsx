import { useState, type ComponentType, type ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIntegrationMenu } from '../components/Integrations/RunIntegrationMenu';
import { StandaloneIOCList } from '../components/Analysis/StandaloneIOCList';
import { IOCStatsView } from '../components/Analysis/IOCStatsView';
import { useIntegrationResult } from '../hooks/useIntegrationResult';
import { db } from '../db';
import { DEFAULT_SETTINGS, type StandaloneIOC } from '../types';
import type { IntegrationRun, IntegrationStep, IntegrationTemplate, InstalledIntegration } from '../types/integration-types';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../components/Analysis/StandaloneIOCForm', () => ({ StandaloneIOCForm: () => null }));
vi.mock('../components/Analysis/BulkIOCImportModal', () => ({ BulkIOCImportModal: () => null }));
vi.mock('../components/Analysis/BulkEnrichModal', () => ({ BulkEnrichModal: () => null }));
vi.mock('../components/Analysis/IOCDeduplicator', () => ({ IOCDeduplicator: () => null }));
vi.mock('../components/Analysis/STIXImportModal', () => ({ STIXImportModal: () => null }));
vi.mock('../components/Analysis/MISPImportModal', () => ({ MISPImportModal: () => null }));

// Preserve React's real component identity/remount behavior without relying on
// jsdom layout. Hiding rows models virtualization removing an offscreen row.
vi.mock('react-virtuoso', () => ({ TableVirtuoso: function TableFixture({ data, components, itemContent, computeItemKey }: {
  data: Array<{ id: string }>;
  components: Record<'Table' | 'TableBody' | 'TableRow', ComponentType<{ children?: ReactNode }>>;
  itemContent: (index: number, row: { id: string }) => ReactNode;
  computeItemKey?: (index: number, row: { id: string }) => string;
}) {
  const [visible, setVisible] = useState(true);
  const { Table, TableBody, TableRow } = components;
  return <><button onClick={() => setVisible(value => !value)}>Toggle virtual rows</button>
    <Table><TableBody>{visible && data.map((row, index) => <TableRow key={computeItemKey?.(index, row) ?? index}>{itemContent(index, row)}</TableRow>)}</TableBody></Table></>;
} }));

const indicator: StandaloneIOC = { id: 'fixture-ioc', type: 'domain', value: 'fictional.example', confidence: 'medium', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
function definition(steps: IntegrationStep[] = []): IntegrationTemplate {
  return { id: 'fixture-template', name: 'Fixture integration', schemaVersion: '1.0', version: '1', description: '', author: '', icon: '', color: '', category: 'utility', tags: [], source: 'user', createdAt: 1, updatedAt: 1,
    triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps, outputs: [] };
}
const installation: InstalledIntegration = { id: 'fixture-installation', templateId: 'fixture-template', name: 'Fixture', enabled: true, config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 };
const tables = [db.integrationTemplates, db.installedIntegrations, db.integrationRuns, db.standaloneIOCs, db.notes, db.tasks, db.timelineEvents];
beforeEach(async () => { for (const table of tables) await table.clear(); });
afterEach(() => vi.restoreAllMocks());

async function chooseRun() {
  fireEvent.click(await screen.findByTitle('Run Integration'));
  fireEvent.click(await screen.findByRole('button', { name: /Fixture integration/ }));
}

async function runControl(steps: IntegrationStep[]) {
  const addRun = vi.fn(async (run: IntegrationRun) => { await db.integrationRuns.add(run); });
  render(<RunIntegrationMenu ioc={indicator} matching={[{ installation, template: definition(steps) }]} addRun={addRun} />);
  await chooseRun();
  await waitFor(() => expect(addRun).toHaveBeenCalledOnce());
  const run = addRun.mock.calls[0]?.[0];
  if (!run) throw new Error('Expected a persisted run');
  return run;
}

describe('integration control acknowledgements', () => {
  it('rejects unsupported timeline creation without inventing an entity ID/count', async () => {
    const run = await runControl([{ id: 'create', label: '', type: 'create-entity', entityType: 'timeline-event', fields: { title: 'Not created' } }]);
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('not supported');
    expect(await db.timelineEvents.count()).toBe(0);
  });
  it.each(['note', 'task', 'timeline-event'] as const)('rejects unsupported %s updates', async entityType => {
    const run = await runControl([{ id: 'update', label: '', type: 'update-entity', entityType, entityId: 'not-used', fields: { title: 'Not updated' } }]);
    expect(run).toMatchObject({ status: 'error', entitiesCreated: 0, entitiesUpdated: 0 });
    expect(run.error).toContain('not supported');
  });
  it.each([false, true])('rejects a missing/trashed IOC update (trashed:%s)', async trashed => {
    if (trashed) await db.standaloneIOCs.add({ ...indicator, trashed: true });
    const run = await runControl([{ id: 'update', label: '', type: 'update-entity', entityType: 'ioc', entityId: indicator.id, fields: { confidence: 'high' } }]);
    expect(run).toMatchObject({ status: 'error', entitiesUpdated: 0 });
    expect(run.error).toContain('missing or in trash');
    if (trashed) expect(await db.standaloneIOCs.get(indicator.id)).toEqual({ ...indicator, trashed: true });
    else expect(await db.standaloneIOCs.count()).toBe(0);
  });
  it('counts actual supported writes and retains a prior acknowledgement before a refusal', async () => {
    await db.standaloneIOCs.add(indicator);
    const run = await runControl([
      { id: 'update', label: '', type: 'update-entity', entityType: 'ioc', entityId: indicator.id, fields: { confidence: 'high' } },
      { id: 'create', label: '', type: 'create-entity', entityType: 'task', fields: { title: 'Persisted task' } },
      { id: 'unsupported', label: '', type: 'create-entity', entityType: 'timeline-event', fields: { title: 'Not created' } },
    ]);
    expect(run).toMatchObject({ status: 'error', entitiesUpdated: 1, entitiesCreated: 1 });
    expect(await db.standaloneIOCs.get(indicator.id)).toMatchObject({ confidence: 'high' });
    expect(await db.tasks.toArray()).toEqual([expect.objectContaining({ title: 'Persisted task' })]);
    expect(await db.timelineEvents.count()).toBe(0);
  });
});

describe('integration result presentation ownership', () => {
  it.each(['standalone', 'all'] as const)('keeps %s results across real addRun refresh and virtualized row removal', async view => {
    const template = definition(); template.outputs = [{ type: 'display', template: { summary: 'Persisted local result' } }];
    await db.integrationTemplates.add(template);
    await db.installedIntegrations.add(installation);
    const properties = { folders: [], onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() };
    if (view === 'standalone') render(<StandaloneIOCList {...properties} iocs={[indicator]} />);
    else render(<IOCStatsView notes={[]} tasks={[]} timelineEvents={[]} settings={DEFAULT_SETTINGS} standaloneIOCs={[indicator]} filteredStandaloneIOCs={[indicator]} />);
    await waitFor(() => expect(screen.getByTitle('Run Integration')).toBeEnabled());
    await chooseRun();
    const dialog = await screen.findByRole('dialog', { name: 'Integration Results' });
    expect(dialog).toHaveTextContent('Persisted local result');
    await waitFor(async () => expect(await db.installedIntegrations.get(installation.id)).toMatchObject({ runCount: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle virtual rows' }));
    expect(screen.queryByTitle('Run Integration')).not.toBeInTheDocument();
    expect(dialog).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle virtual rows' }));
    expect(screen.getByRole('dialog', { name: 'Integration Results' })).toBe(dialog);
    expect(await db.integrationRuns.count()).toBe(1);
  });
  it('fences old-scope and workspace-switch completions without reviving old results', () => {
    const run = { id: 'run' } as IntegrationRun;
    const view = renderHook(({ folderId }) => useIntegrationResult(folderId), { initialProps: { folderId: 'first' } });
    const first = view.result.current.showResult;
    act(() => first(run)); expect(view.result.current.resultRun).toBe(run);
    view.rerender({ folderId: 'second' }); expect(view.result.current.resultRun).toBeNull();
    act(() => first(run)); expect(view.result.current.resultRun).toBeNull();
    view.rerender({ folderId: 'first' });
    act(() => first(run)); expect(view.result.current.resultRun).toBeNull();
    act(() => view.result.current.showResult(run)); expect(view.result.current.resultRun).toBe(run);
    act(() => window.dispatchEvent(new Event('workspace-will-switch')));
    expect(view.result.current.resultRun).toBeNull();
    act(() => view.result.current.showResult(run)); expect(view.result.current.resultRun).toBeNull();
  });
  it('does not carry results between investigation/global presentation in the same folder', () => {
    const run = { id: 'run' } as IntegrationRun;
    const view = renderHook(({ mode }) => useIntegrationResult('folder', mode), { initialProps: { mode: 'investigation' } });
    const previous = view.result.current.showResult;
    act(() => previous(run)); expect(view.result.current.resultRun).toBe(run);
    view.rerender({ mode: 'global' });
    act(() => previous(run)); expect(view.result.current.resultRun).toBeNull();
  });
});
