import { describe, it, expect } from 'vitest';
import i18n from 'i18next';

describe('i18n foundation', () => {
  it('initializes with English as default language', () => {
    expect(i18n.language).toBe('en');
  });

  it('resolves keys from the common namespace', () => {
    expect(i18n.t('appName')).toBe('ThreatCaddy');
    expect(i18n.t('save')).toBe('Save');
    expect(i18n.t('cancel')).toBe('Cancel');
  });

  it('returns the key itself for missing translations (never null)', () => {
    const result = i18n.t('nonexistent.key');
    expect(result).toBe('nonexistent.key');
    expect(result).not.toBeNull();
  });

  it('supports interpolation', () => {
    // Even without a defined key, interpolation syntax works on fallback
    i18n.addResource('en', 'common', 'greeting', 'Hello {{name}}');
    expect(i18n.t('greeting', { name: 'Analyst' })).toBe('Hello Analyst');
  });

  it('has labels, dates, and analysis namespaces loaded', () => {
    expect(i18n.hasLoadedNamespace('labels')).toBe(true);
    expect(i18n.hasLoadedNamespace('dates')).toBe(true);
    expect(i18n.hasLoadedNamespace('analysis')).toBe(true);
  });
});
