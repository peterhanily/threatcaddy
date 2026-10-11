import { describe, expect, it } from 'vitest';
import { compileIntegrationPlan } from '../lib/integration-plan';
import { compileIntegrationPlan as serverPlan } from '../../server/src/lib/integration-plan';
import { resolveDataValue, resolveDeep, resolveVariables } from '../lib/integration-expression';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import type { IntegrationStep, IntegrationTemplate } from '../types/integration-types';

export function fixture(steps: IntegrationStep[] = []): IntegrationTemplate {
  return { id: 'fixture', name: 'Fixture', schemaVersion: '1.0', version: '1', description: '', author: '',
    icon: '', color: '', category: 'utility', tags: [], source: 'user', createdAt: 0, updatedAt: 0,
    triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps, outputs: [] };
}
const child: IntegrationStep = { id: 'child', type: 'delay', label: 'Child', ms: 0 };
describe('integration plan contracts', () => {
  it('accepts every built-in definition without mutation in both runtimes', () => {
    for (const template of BUILTIN_INTEGRATIONS) {
      const before = JSON.stringify(template);
      expect(compileIntegrationPlan(template).roots).toEqual(serverPlan(template).roots);
      expect(JSON.stringify(template)).toBe(before);
    }
  });
  it('owns a stable ordered snapshot and excludes children from roots', () => {
    const template = fixture([{ id: 'parent', type: 'condition', label: '', expression: '{{config.ok}} exists', thenSteps: ['child'] }, child]);
    const plan = compileIntegrationPlan(template);
    template.steps[0].label = 'Changed later';
    expect(plan.roots).toEqual(['parent']);
    expect(plan.byId.get('parent')?.label).toBe('');
  });
  it.each([
    ['duplicate IDs', [child, { ...child }]],
    ['missing reference', [{ id: 'parent', type: 'loop', label: '', items: '{{config.items}}', itemVariable: 'item', bodySteps: ['missing'] }]],
    ['cycle', [{ id: 'parent', type: 'condition', label: '', expression: 'true', thenSteps: ['parent'] }]],
    ['unknown step', [{ id: 'step', type: 'unsupported', label: '' }]],
    ['invalid loop bound', [{ id: 'parent', type: 'loop', label: '', items: '{{config.items}}', itemVariable: 'item', bodySteps: [], maxIterations: -1 }]],
  ])('rejects %s consistently before execution', (_name, steps) => {
    const input = fixture(steps as IntegrationStep[]);
    expect(() => compileIntegrationPlan(input)).toThrow('Invalid integration template');
    expect(() => serverPlan(input)).toThrow('Invalid integration template');
  });
  it('rejects unsupported features and malformed output/config shapes', () => {
    expect(() => compileIntegrationPlan({ ...fixture(), outputs: {} })).toThrow();
    expect(() => compileIntegrationPlan({ ...fixture(), configSchema: [{ key: 'x' }] })).toThrow();
    expect(() => compileIntegrationPlan({ ...fixture(), outputs: [{ type: 'post-to-feed', template: {} }] })).toThrow('unsupported');
  });
  it('preserves typed exact data references without changing text or legacy deep interpolation', () => {
    const context = { items: [{ title: 'Fixture' }], off: false, zero: 0, missing: null };
    expect(resolveDataValue('{{items}}', context)).toBe(context.items);
    expect(resolveDataValue('{{off}}', context)).toBe(false);
    expect(resolveDataValue('{{zero}}', context)).toBe(0);
    expect(resolveDataValue('{{missing}}', context)).toBeNull();
    expect(resolveDataValue('Items: {{items}}', context)).toBe('Items: [{"title":"Fixture"}]');
    expect(resolveVariables('{{off}}', context)).toBe('false');
    expect(resolveDeep({ body: '{{items}}' }, context)).toEqual({ body: '[{"title":"Fixture"}]' });
  });
});
