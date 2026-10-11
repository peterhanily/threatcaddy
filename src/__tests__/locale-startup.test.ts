import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import pako from 'pako';

const transport = vi.hoisted(() => ({
  reads: [] as string[],
  hold: false,
  pending: [] as Array<() => void>,
}));
vi.mock('i18next-http-backend', () => ({ default: {
  type: 'backend',
  init() {},
  read(language: string, namespace: string, callback: (error: null, data: unknown) => void) {
    transport.reads.push(`${language}/${namespace}`);
    const complete = () => callback(null, namespace === 'encryption' ? { 'passphrase.unlock': `unlock-${language}` } : {});
    if (transport.hold) transport.pending.push(complete);
    else complete();
  },
} }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  transport.reads = [];
  transport.pending = [];
  transport.hold = false;
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});
afterEach(() => {
  for (const complete of transport.pending.splice(0)) complete();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('locale ownership before any unlocked app or settings hook mounts', () => {
  it.each([
    ['ar-EG', 'ar', 'rtl'], ['he-IL', 'he', 'rtl'], ['fa', 'fa', 'rtl'],
    ['DE-de', 'de', 'ltr'], ['pt_BR', 'pt-BR', 'ltr'], ['zh_CN', 'zh-CN', 'ltr'],
    ['zh-Hans', 'zh-CN', 'ltr'], ['zh-TW', 'en', 'ltr'], ['ar-Latn', 'en', 'ltr'],
    ['unsupported', 'en', 'ltr'], ['../../other', 'en', 'ltr'],
  ])('initializes %s as %s before the lock screen', async (stored, expected, direction) => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: stored }));
    const module = await import('../i18n');
    expect(document.documentElement.lang).toBe(expected);
    expect(document.documentElement.dir).toBe(direction);
    await waitFor(() => expect(module.default.language).toBe(expected));
    expect(transport.reads.every(path => path.startsWith(`${expected}/`))).toBe(true);
    if (expected !== 'en') expect(module.default.t('passphrase.unlock', { ns: 'encryption' })).toBe(`unlock-${expected}`);
  });
  it('reads only the active immutable workspace setting, not another account or original workspace', async () => {
    const workspace = 'a'.repeat(64);
    sessionStorage.setItem('threatcaddy-active-workspace', workspace);
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'de' }));
    localStorage.setItem(`threatcaddy-settings:${workspace}`, JSON.stringify({ language: 'ar' }));
    const module = await import('../i18n');
    expect(module.getInitialLanguage()).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
  it.each(['null', '[]', '{bad', '{"language":42}'])('falls back safely for invalid settings %s', async raw => {
    localStorage.setItem('threatcaddy-settings', raw);
    const module = await import('../i18n');
    expect(module.getInitialLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
  it('does not let a deferred old locale change win after a newer selection', async () => {
    const module = await import('../i18n');
    transport.hold = true;
    module.applyAppLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    module.applyAppLanguage('en');
    for (const complete of transport.pending.splice(0)) complete();
    await waitFor(() => expect(module.default.language).toBe('en'));
    expect(document.documentElement.dir).toBe('ltr');
  });
  it('loads an embedded standalone RTL lock-screen namespace without HTTP', async () => {
    const compressed = pako.deflateRaw(JSON.stringify({ encryption: { 'passphrase.unlock': 'פתיחה' } }));
    vi.stubGlobal('__STANDALONE__', true);
    vi.stubGlobal('__STANDALONE_LOCALES_GZ__', { he: btoa(String.fromCharCode(...compressed)) });
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'he' }));
    const module = await import('../i18n');
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() => expect(module.default.t('passphrase.unlock', { ns: 'encryption' })).toBe('פתיחה'));
    expect(transport.reads).toEqual([]);
  });
  it('keeps English fallback available when the embedded chosen catalog is absent', async () => {
    vi.stubGlobal('__STANDALONE__', true);
    vi.stubGlobal('__STANDALONE_LOCALES_GZ__', {});
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ language: 'ar' }));
    const module = await import('../i18n');
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() => expect(module.default.t('passphrase.unlock', { ns: 'encryption' })).toBe('Unlock'));
    expect(transport.reads).toEqual([]);
  });
});
