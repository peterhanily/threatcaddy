import { describe, expect, it, vi } from 'vitest';
import { IntegrationDataBudget, MAX_INTEGRATION_DERIVED_BYTES, MAX_INTEGRATION_DATA_NODES } from '../lib/integration-data-budget';

describe('integration derived data byte budget', () => {
  it.each(['plain', 'café', '调查', '😀', '\ud800', '\n\t"\\\u0000'])('counts JSON UTF-8 and escaping exactly before serialization (%j)', value => {
    const json = JSON.stringify({ value });
    const size = new TextEncoder().encode(json).byteLength;
    expect(new IntegrationDataBudget(size).stringify({ value })).toBe(json);
    const short = new IntegrationDataBudget(size - 1);
    expect(() => short.stringify({ value })).toThrow('budget'); expect(short.exceeded).toBe(true);
  });
  it('handles JSON numbers, optional fields and array holes without lossy coercion', () => {
    const sparse = Array<undefined>(2); sparse[1] = undefined;
    const value = { yes: true, no: false, absent: undefined, nil: null, numbers: [1e30, -0, NaN, Infinity], sparse };
    const expected = JSON.stringify(value);
    expect(new IntegrationDataBudget(new TextEncoder().encode(expected).byteLength).stringify(value)).toBe(expected);
  });
  it('counts aliases each time but refuses cycles and callable serialization', () => {
    const shared = { name: 'Fictional' };
    const value = [shared, shared];
    const expected = JSON.stringify(value);
    expect(new IntegrationDataBudget(expected.length).stringify(value)).toBe(expected);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => new IntegrationDataBudget().stringify(cycle)).toThrow('budget');
    const getter = vi.fn(() => 'never');
    expect(() => new IntegrationDataBudget().stringify(Object.defineProperty({}, 'value', { get: getter, enumerable: true }))).toThrow('budget');
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => 'never');
    expect(() => new IntegrationDataBudget().stringify({ toJSON })).toThrow('budget'); expect(toJSON).not.toHaveBeenCalled();
  });
  it('bounds incremental interpolation before constructing an oversized final output', () => {
    const budget = new IntegrationDataBudget(12);
    expect(budget.interpolate('A{{name}}!', () => 'café')).toBe('Acafé!');
    expect(() => budget.interpolate('{{name}}{{name}}', () => 'café')).toThrow('budget');
    expect(budget.exceeded).toBe(true);
    expect(() => budget.chargeText('')).toThrow('budget');
  });
  it('stringifies interpolated objects within the same cumulative budget', () => {
    const budget = new IntegrationDataBudget(14);
    expect(budget.interpolate('{{item}}', () => ({ ok: true }))).toBe('{"ok":true}');
    expect(() => budget.chargeText('again')).toThrow('budget');
  });
  it('preserves ordinary join semantics including nested arrays and checks separators before joining', () => {
    const values = ['café', [1, undefined, true], null, { item: 'ignored-by-join' }];
    const expected = values.join(' | ');
    const bytes = new TextEncoder().encode(expected).byteLength;
    expect(new IntegrationDataBudget(bytes).join(values, ' | ')).toBe(expected);
    const short = new IntegrationDataBudget(bytes - 1);
    expect(() => short.join(values, ' | ')).toThrow('budget');
    expect(short.exceeded).toBe(true);
  });
  it('bounds depth/node work and refuses custom coercion without invoking it', () => {
    expect(() => new IntegrationDataBudget(1000, 2).chargeJSON([1, 2])).toThrow('budget');
    let deep: unknown = 'leaf'; for (let i = 0; i < 26; i++) deep = [deep];
    expect(() => new IntegrationDataBudget().chargeJSON(deep)).toThrow('budget');
    const toString = vi.fn(() => 'never');
    expect(() => new IntegrationDataBudget().join([{ toString }], ',')).toThrow('budget'); expect(toString).not.toHaveBeenCalled();
  });
  it('allows only lower hard limits and charges repeated assignments cumulatively', () => {
    expect(() => new IntegrationDataBudget(MAX_INTEGRATION_DERIVED_BYTES + 1)).toThrow('lower');
    expect(() => new IntegrationDataBudget(10, MAX_INTEGRATION_DATA_NODES + 1)).toThrow('lower');
    expect(() => new IntegrationDataBudget(0)).toThrow('lower');
    const budget = new IntegrationDataBudget(9);
    budget.chargeText('four'); budget.chargeText('four');
    expect(() => budget.chargeText('four')).toThrow('budget');
  });
});
