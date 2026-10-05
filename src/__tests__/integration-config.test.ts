import { describe, expect, it } from 'vitest';
import { resolveIntegrationConfig, validateIntegrationConfig } from '../lib/integration-config';
import type { IntegrationConfigField } from '../types/integration-types';

const field = (overrides: Partial<IntegrationConfigField> = {}): IntegrationConfigField => ({
  key: 'setting', label: 'Required setting', type: 'string', required: true, ...overrides,
});

describe('required integration settings', () => {
  it.each([undefined, null, '', ' \t\n ', [], [''], ['valid', ' '], {}, Number.NaN, Number.POSITIVE_INFINITY].map(value => ({ value })))(
    'rejects missing or empty configuration $value', ({ value }) => {
      expect(validateIntegrationConfig([field()], { setting: value })).toEqual([{ key: 'setting', label: 'Required setting' }]);
    },
  );

  it.each([false, true, 0, -1, 'configured', '  configured  '])('accepts a supplied scalar %j', value => {
    expect(validateIntegrationConfig([field()], { setting: value })).toEqual([]);
  });

  it('does not require optional fields', () => {
    expect(validateIntegrationConfig([field({ required: false })], {})).toEqual([]);
  });

  it.each(['selected', ['first'], ['first', 'second']].map(value => ({ value })))('accepts legacy scalar and array multi-select values $value', ({ value }) => {
    expect(validateIntegrationConfig([field({ type: 'multi-select' })], { setting: value })).toEqual([]);
  });

  it.each([[], [''], ['  '], [null], [undefined], ['selected', ''], [[]], [{}]].map(value => ({ value })))('rejects empty/malformed multi-select values $value', ({ value }) => {
    expect(validateIntegrationConfig([field({ type: 'multi-select' })], { setting: value })).toHaveLength(1);
  });

  it.each(['fallback', false, 0])('honors defaults only for absent or undefined values (%j)', defaultValue => {
    const fields = [field({ default: defaultValue })];
    expect(resolveIntegrationConfig(fields, {})).toEqual({ setting: defaultValue });
    expect(resolveIntegrationConfig(fields, { setting: undefined })).toEqual({ setting: defaultValue });
    expect(validateIntegrationConfig(fields, {})).toEqual([]);
    for (const cleared of ['', ' ', null]) {
      expect(resolveIntegrationConfig(fields, { setting: cleared })).toEqual({ setting: cleared });
      expect(validateIntegrationConfig(fields, { setting: cleared })).toHaveLength(1);
    }
  });

  it('does not accept a blank default', () => {
    expect(validateIntegrationConfig([field({ default: ' ' })], {})).toHaveLength(1);
  });

  it('preserves explicit false/zero and unknown configured settings without mutation', () => {
    const fields = [field({ key: 'off', default: true }), field({ key: 'zero', default: 2 })];
    const values = { off: false, zero: 0, other: 'retained' };
    expect(resolveIntegrationConfig(fields, values)).toEqual(values);
    expect(resolveIntegrationConfig(fields, values)).not.toBe(values);
    expect(values).toEqual({ off: false, zero: 0, other: 'retained' });
  });

  it('never returns configured secrets in validation errors', () => {
    const fields = [field({ key: 'apiKey', label: 'API key', type: 'password', secret: true }), field()];
    const errors = validateIntegrationConfig(fields, { apiKey: 'fictional-secret-never-in-error', setting: '' });
    expect(errors).toEqual([{ key: 'setting', label: 'Required setting' }]);
    expect(JSON.stringify(errors)).not.toContain('fictional-secret');
  });

  it('does not treat inherited properties as configured values', () => {
    const values = Object.create({ setting: 'inherited' }) as Record<string, unknown>;
    expect(validateIntegrationConfig([field()], values)).toHaveLength(1);
    expect(resolveIntegrationConfig([field({ default: 'own-default' })], values)).toEqual({ setting: 'own-default' });
  });

  it('resolves unusual schema keys as own properties without modifying prototypes', () => {
    const resolved = resolveIntegrationConfig([field({ key: '__proto__', default: 'own-default' })], {});
    expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
    expect(Object.hasOwn(resolved, '__proto__')).toBe(true);
    expect(resolved['__proto__']).toBe('own-default');
    expect(validateIntegrationConfig([field({ key: 'toString' })], {})).toHaveLength(1);
  });
});
