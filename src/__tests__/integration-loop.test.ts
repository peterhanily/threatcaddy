import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationExecutor } from '../lib/integration-executor';
import type { IntegrationStep, IntegrationTemplate, InstalledIntegration } from '../types/integration-types';

function template(steps: IntegrationStep[]): IntegrationTemplate {
  return { id: 'fixture', name: 'Fixture', schemaVersion: '1.0', version: '1', description: '', author: '',
    icon: '', color: '', category: 'utility', tags: [], source: 'user', createdAt: 0, updatedAt: 0,
    triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps, outputs: [] };
}
function installation(config: Record<string, unknown> = {}): InstalledIntegration {
  return { id: 'installed', templateId: 'fixture', name: 'Fixture', enabled: true, scopeType: 'all', scopeFolderIds: [],
    config, createdAt: 0, updatedAt: 0, runCount: 0, errorCount: 0 };
}
const create = (id: string, title: string): IntegrationStep => ({ id, label: id, type: 'create-entity', entityType: 'note', fields: { title } });
const loop = (bodySteps: string[], extra = {}): IntegrationStep => ({ id: 'loop', label: 'Loop', type: 'loop', items: '{{config.items}}', itemVariable: 'item', indexVariable: 'index', bodySteps, ...extra });
afterEach(() => vi.useRealTimers());

describe('bounded declarative iteration', () => {
  it('returns a structured error for an invalid template without callbacks', async () => {
    const onCreateEntity = vi.fn();
    expect(await new IntegrationExecutor().run(null as unknown as IntegrationTemplate, installation(), {}, { onCreateEntity })).toMatchObject({ status: 'error', templateId: '', apiCallsMade: 0 });
    expect(onCreateEntity).not.toHaveBeenCalled();
  });
  it('preserves attempted request counts when a transport fails', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Synthetic offline state'));
    try {
      const definition = template([{ id: 'request', type: 'http', label: 'Request', method: 'GET', url: 'https://example.com/inert' }]);
      definition.requiredDomains = ['example.com'];
      const result = await new IntegrationExecutor().run(definition, installation(), {}, {});
      expect(result).toMatchObject({ status: 'error', apiCallsMade: 1 });
      expect(fetch).toHaveBeenCalledOnce();
    } finally { fetch.mockRestore(); }
  });
  it('does not count a request which was cancelled while awaiting a proxy token', async () => {
    const controller = new AbortController();
    const definition = template([{ id: 'request', type: 'http', label: 'Request', method: 'GET', url: 'https://example.com/inert' }]);
    definition.requiredDomains = ['example.com'];
    const result = new IntegrationExecutor().run(definition, installation(), {}, {}, controller.signal, {
      useServerProxy: { serverUrl: 'https://team.example', getAccessToken: () => new Promise(() => {}) },
    });
    controller.abort();
    expect(await result).toMatchObject({ status: 'cancelled', apiCallsMade: 0 });
  });
  it('keeps reserved transform names as data and ignores inherited lookup entries', async () => {
    const definition = template([{ id: 'transform', label: '', type: 'transform', input: '{{config.source}}', operations: [
      { op: 'extract', path: 'name', as: '__proto__' },
      { op: 'lookup', path: '', map: {}, default: 'Own fallback', as: 'lookup' },
    ] }]);
    definition.outputs = [{ type: 'display', template: { reserved: '{{steps.transform.__proto__}}', lookup: '{{steps.transform.lookup}}' } }];
    const result = await new IntegrationExecutor().run(definition, installation({ source: { name: 'constructor' } }), {}, {});
    expect(result).toMatchObject({ status: 'success', displayResults: { reserved: 'constructor', lookup: 'Own fallback' } });
  });
  it('charges flatten children before materializing them', async () => {
    const definition = template([{ id: 'transform', label: '', type: 'transform', input: '{{config.source}}', operations: [{ op: 'flatten', path: '', as: 'items' }] }, create('after', 'Must not run')]);
    const onCreateEntity = vi.fn();
    const result = await new IntegrationExecutor().run(definition, installation({ source: [[1, 2, 3], [4, 5, 6]] }), {}, { onCreateEntity }, undefined, { maxStepVisits: 4 });
    expect(result.status).toBe('error'); expect(result.error).toContain('budget');
    expect(onCreateEntity).not.toHaveBeenCalled();
  });
  it('marks bounded log truncation explicitly', async () => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const result = await new IntegrationExecutor().run(template([loop(['save'], { maxIterations: 250 }), create('save', 'Saved')]), installation({ items: Array.from({ length: 250 }, (_, index) => index) }), {}, { onCreateEntity });
    expect(result).toMatchObject({ status: 'success', entitiesCreated: 250 });
    expect(result.log).toHaveLength(500);
    expect(result.log.at(-1)?.detail).toContain('omitted');
  });
  it('runs the selected branch once and never invokes its other branch', async () => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const run = await new IntegrationExecutor().run(template([
      { id: 'branch', label: '', type: 'condition', expression: '{{config.active}} == true', thenSteps: ['yes'], elseSteps: ['no'] },
      create('yes', 'Selected'), create('no', 'Not selected'),
    ]), installation({ active: true }), {}, { onCreateEntity });
    expect(run).toMatchObject({ status: 'success', entitiesCreated: 1 });
    expect(onCreateEntity).toHaveBeenCalledExactlyOnceWith('note', { title: 'Selected' }, expect.any(AbortSignal));
  });
  it.each([[], ['first', 'second']].map(items => ({ items })))('iterates an array without executing the body as a root: $items', async ({ items }) => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const result = await new IntegrationExecutor().run(template([loop(['save']), create('save', '{{vars.index}}:{{vars.item}}')]), installation({ items }), {}, { onCreateEntity });
    expect(result).toMatchObject({ status: 'success', entitiesCreated: items.length });
    expect(onCreateEntity.mock.calls.map(call => call[1].title)).toEqual(items.map((item, index) => `${index}:${item}`));
  });
  it('restores outer loop frames, same-name indices, and pre-existing variables', async () => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const result = await new IntegrationExecutor().run(template([
      { id: 'init', label: '', type: 'set-variable', variables: { item: 'prior', index: 'prior-index' } },
      loop(['inner', 'outer-save']),
      loop(['inner-save'], { id: 'inner', items: '{{loop.item.children}}' }),
      create('inner-save', 'inner:{{vars.index}}:{{vars.item}}'),
      create('outer-save', 'outer:{{vars.index}}:{{loop.item.name}}'),
      create('after', '{{vars.item}}:{{vars.index}}:{{loop.index}}'),
    ]), installation({ items: [{ name: 'Outer', children: ['A', 'B'] }] }), {}, { onCreateEntity });
    expect(result.status).toBe('success');
    expect(onCreateEntity.mock.calls.map(call => call[1].title)).toEqual(['inner:0:A', 'inner:1:B', 'outer:0:Outer', 'prior:prior-index:']);
  });
  it('returns committed child counts when a later child fails', async () => {
    const onCreateEntity = vi.fn().mockResolvedValueOnce('saved').mockRejectedValueOnce(new Error('Synthetic save refusal'));
    const result = await new IntegrationExecutor().run(template([loop(['one', 'two']), create('one', 'Saved'), create('two', 'Refused')]), installation({ items: ['one'] }), {}, { onCreateEntity });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 1, error: 'Synthetic save refusal' });
  });
  it('returns acknowledged child counts on cancellation and does not execute later children', async () => {
    const controller = new AbortController();
    const onCreateEntity = vi.fn(async () => { controller.abort(); return 'saved'; });
    const result = await new IntegrationExecutor().run(template([loop(['one', 'two']), create('one', 'Saved'), create('two', 'Not started')]), installation({ items: ['one', 'two'] }), {}, { onCreateEntity }, controller.signal);
    expect(result).toMatchObject({ status: 'cancelled', entitiesCreated: 1 });
    expect(onCreateEntity).toHaveBeenCalledOnce();
  });
  it('stops an inter-iteration delay immediately and preserves committed counts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const run = new IntegrationExecutor().run(template([loop(['save'], { delayMs: 60_000 }), create('save', 'Saved')]), installation({ items: ['one', 'two'] }), {}, { onCreateEntity }, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect(await run).toMatchObject({ status: 'cancelled', entitiesCreated: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not delay after the final capped iteration', async () => {
    vi.useFakeTimers();
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const run = new IntegrationExecutor().run(template([loop(['save'], { maxIterations: 1, delayMs: 60_000 }), create('save', 'Saved')]), installation({ items: ['one', 'two'] }), {}, { onCreateEntity });
    expect(await run).toMatchObject({ status: 'success', entitiesCreated: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('enforces a shared small work budget even with continueOnError', async () => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const result = await new IntegrationExecutor().run(template([loop(['save'], { continueOnError: true }), create('save', 'Saved'), create('after', 'Must not run')]), installation({ items: ['one', 'two', 'three'] }), {}, { onCreateEntity }, undefined, { maxStepVisits: 4 });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 1 });
    expect(result.error).toContain('budget');
    expect(onCreateEntity).toHaveBeenCalledOnce();
  });
  it('does not let later edits replace the validated execution snapshot', async () => {
    const source = template([create('first', 'First'), create('second', 'Original')]);
    const onCreateEntity = vi.fn(async (type: string, fields: Record<string, unknown>) => {
      expect(type).toBe('note'); expect(fields).toHaveProperty('title');
      source.steps[1] = create('second', 'Changed'); return 'saved';
    });
    const result = await new IntegrationExecutor().run(source, installation(), {}, { onCreateEntity });
    expect(result.status).toBe('success');
    expect(onCreateEntity.mock.calls[1]?.[1]).toEqual({ title: 'Original' });
  });
  it('stops cumulative variable expansion even when the step allows ordinary errors', async () => {
    const onCreateEntity = vi.fn();
    const result = await new IntegrationExecutor().run(template([
      { id: 'expand', label: '', type: 'set-variable', continueOnError: true, variables: {
        first: '{{config.text}}', second: '{{vars.first}}{{vars.first}}', third: '{{vars.second}}{{vars.second}}',
      } },
      create('after', 'Must not run'),
    ]), installation({ text: 'ordinary fixture' }), {}, { onCreateEntity }, undefined, { maxDerivedBytes: 64 });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 0 });
    expect(result.error).toContain('derived-data');
    expect(onCreateEntity).not.toHaveBeenCalled();
  });
  it.each(['map', 'join'] as const)('bounds %s materialization before subsequent callbacks', async (operation) => {
    const onCreateEntity = vi.fn();
    const step: IntegrationStep = { id: 'transform', label: '', type: 'transform', input: '{{config.items}}', operations: operation === 'map'
      ? [{ op: 'map', path: '', template: { text: '{{item}}{{item}}{{item}}' }, as: 'result' }]
      : [{ op: 'join', path: '', separator: 'long separator', as: 'result' }] };
    const result = await new IntegrationExecutor().run(template([step, create('after', 'Must not run')]), installation({ items: ['one', 'two', 'three'] }), {}, { onCreateEntity }, undefined, { maxDerivedBytes: 40 });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 0 });
    expect(result.error).toContain('derived-data');
    expect(onCreateEntity).not.toHaveBeenCalled();
  });
  it('preserves an acknowledged nested write when a later child condition exceeds its data budget', async () => {
    const onCreateEntity = vi.fn().mockResolvedValue('saved');
    const result = await new IntegrationExecutor().run(template([
      loop(['saved', 'limited'], { continueOnError: true }),
      create('saved', 'Saved'),
      { ...create('limited', 'Must not run'), condition: '{{config.text}}{{config.text}}{{config.text}}', continueOnError: true },
      create('after', 'Must not run'),
    ]), installation({ items: [1], text: 'ordinary fixture' }), {}, { onCreateEntity }, undefined, { maxDerivedBytes: 40 });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 1 });
    expect(result.error).toContain('derived-data');
    expect(onCreateEntity).toHaveBeenCalledOnce();
  });
  it('bounds retained response data and still counts the attempted request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'ordinary fixture '.repeat(4) }), { headers: { 'Content-Type': 'application/json' } }));
    const onCreateEntity = vi.fn();
    try {
      const definition = template([{ id: 'request', type: 'http', label: 'Request', method: 'GET', url: 'https://example.com/inert' }, create('after', 'Must not run')]);
      definition.requiredDomains = ['example.com'];
      const result = await new IntegrationExecutor().run(definition, installation(), {}, { onCreateEntity }, undefined, { maxDerivedBytes: 64 });
      expect(result).toMatchObject({ status: 'error', apiCallsMade: 1, entitiesCreated: 0 });
      expect(result.error).toContain('derived-data');
      expect(onCreateEntity).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('charges repeated rich-note metadata references before the note callback materializes them', async () => {
    const onCreateEntity = vi.fn();
    const definition = template([{ id: 'transform', label: '', type: 'transform', input: '{{config.source}}', operations:
      ['first', 'second', 'third', 'fourth', 'fifth'].map(as => ({ op: 'extract' as const, path: '', as })),
    }]);
    definition.outputs = [{ type: 'create-note', template: { title: 'Local' } }];
    const result = await new IntegrationExecutor().run(definition, installation({ source: { message: 'ordinary fixture' } }), {}, { onCreateEntity }, undefined, { maxDerivedBytes: 180 });
    expect(result).toMatchObject({ status: 'error', entitiesCreated: 0 });
    expect(result.log).toContainEqual(expect.objectContaining({ stepId: 'transform', type: 'step-complete' }));
    expect(result.error).toContain('derived-data');
    expect(onCreateEntity).not.toHaveBeenCalled();
  });
});
