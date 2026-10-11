import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createInstance } from 'i18next';
import { auditCatalog, catalogLeaves, chunkCatalog, extensionLocaleCode, extensionMessages, mergeMissingTranslations, missingTranslations, placeholderDifferences, validateTranslationBatch } from '../../scripts/lib/locale-quality.mjs';

describe('offline locale quality and non-destructive translation merging', () => {
  it('finds nested leaves, preserving existing and legacy keys exactly', () => {
    const en = { flat: 'New', input: { keep: 'Keep', nested: { missing: 'Hello {{name}}' } } };
    const prior = { input: { keep: 'Conserver', legacy: 'Antérieur' }, old: 'Ancien' };
    expect(missingTranslations(en, prior)).toEqual({ flat: 'New', input: { nested: { missing: 'Hello {{name}}' } } });
    expect(mergeMissingTranslations(en, prior, { flat: 'Nouveau', input: { nested: { missing: 'Bonjour {{name}}' } } })).toEqual({ flat: 'Nouveau', input: { keep: 'Conserver', legacy: 'Antérieur', nested: { missing: 'Bonjour {{name}}' } }, old: 'Ancien' });
    expect(prior).toEqual({ input: { keep: 'Conserver', legacy: 'Antérieur' }, old: 'Ancien' });
  });
  it.each([
    ['missing', { nested: {} }],
    ['extra', { nested: { text: 'Bonjour', other: 'Extra' } }],
    ['empty', { nested: { text: '' } }],
    ['nonstring', { nested: { text: 1 } }],
    ['array', { nested: ['Bonjour'] }],
  ])('rejects %s translated output instead of copying English', (_name, output) => {
    expect(() => validateTranslationBatch({ nested: { text: 'Hello' } }, output)).toThrow();
  });
  it('refuses an attempted overwrite at any depth, including valid translated text', () => {
    expect(() => mergeMissingTranslations({ nested: { old: 'Old', new: 'New' } }, { nested: { old: 'Ancien' } }, { nested: { old: 'Remplacé', new: 'Nouveau' } })).toThrow('Unexpected translated key');
  });
  it('rejects an existing shape mismatch without changing it', () => {
    expect(() => missingTranslations({ nested: { text: 'Hello' } }, { nested: 'Existing' })).toThrow();
  });
  it('chunks recursive leaves by UTF-8 bytes and merges repeated parents without losing siblings', () => {
    const en = { nested: { a: '你好你好', b: 'Bonjour', c: 'Hello' }, 'literal.key': 'World' };
    const chunks = chunkCatalog(en, 32);
    expect(chunks.length).toBeGreaterThan(1);
    let result = {};
    for (const chunk of chunks) result = mergeMissingTranslations(chunk, result, chunk);
    expect(result).toEqual(en);
    expect(catalogLeaves(result)).toHaveLength(4);
  });
  it('keeps literal dotted keys distinct and reports runtime ambiguities', () => {
    const result = auditCatalog({ 'a.b': 'One', a: { b: 'Two' } }, { 'a.b': 'Un', a: { b: 'Deux' } });
    expect(result.issues.filter(issue => issue.kind === 'ambiguous-key')).toHaveLength(2);
  });
  it('requires semantic interpolation while narrowly allowing English grammar suffix omission', () => {
    expect(placeholderDifferences('{{count}} agent{{suffix}}', '{{count}} agents', 'agent.dashboard.activeAgents')).toEqual({ missing: [], extra: [] });
    expect(placeholderDifferences('{{count}} agent{{suffix}}', 'agents', 'agent.dashboard.activeAgents').missing).toEqual(['count']);
    expect(placeholderDifferences('{{suffix}}', 'text', 'other.key').missing).toEqual(['suffix']);
    expect(placeholderDifferences('Reply', '{{author}} replied', 'caddyshack.notifications.reply').extra).toEqual(['author']);
  });
  it('understands formatted and unescaped interpolation without losing parameter names', () => {
    expect(placeholderDifferences('{{- name}} {{count, number}}', '{{count}} {{name}}', 'sample')).toEqual({ missing: [], extra: [] });
  });
  it('allows only the identified evidence grammar suffix, not count or total, to disappear', () => {
    const english = '{{count}} cleaner fragments from {{total}} line{{totalS}}';
    for (const form of ['one', 'two', 'few', 'many', 'zero', 'other']) {
      const key = `evidence.readable.hiddenNoisy_${form}`;
      expect(placeholderDifferences(english, '{{count}} קטעים מתוך {{total}} שורות', key)).toEqual({ missing: [], extra: [] });
      expect(placeholderDifferences(english, '{{count}} קטעים', key).missing).toEqual(['total']);
      expect(placeholderDifferences(english, '{{total}} שורות', key).missing).toEqual(['count']);
      expect(placeholderDifferences(english, '{{count}} {{total}} {{unknown}}', key).extra).toEqual(['unknown']);
    }
    expect(placeholderDifferences('{{totalS}}', 'text', 'evidence.other').missing).toEqual(['totalS']);
  });
  it('maps WebExtension locale folders without introducing duplicate regional folders', () => {
    expect(extensionLocaleCode('pt-BR')).toBe('pt_BR');
    expect(extensionLocaleCode('zh-CN')).toBe('zh_CN');
    expect(extensionLocaleCode('ar')).toBe('ar');
  });
  it('requires extension substitutions and their definitions; no English fallback for missing output', () => {
    const catalog = { item: { message: '$COUNT$ clips', placeholders: { count: { content: '$1' } } } };
    expect(extensionMessages(catalog)).toEqual({ item: '$COUNT$ clips' });
    expect(() => extensionMessages({ item: { message: '$COUNT$ clips' } })).toThrow('Undefined extension placeholder');
    expect(() => validateTranslationBatch(extensionMessages(catalog), {}, { extension: true })).toThrow('Missing translated key');
    expect(() => validateTranslationBatch({ item: '$COUNT$ clips $1' }, { item: '$COUNT$ clips' }, { extension: true })).toThrow('parameters');
  });
  it('requires actual Arabic plural categories, not an English one/other approximation', () => {
    const en = { members_one: '{{count}} member', members_other: '{{count}} members' };
    const result = auditCatalog(en, en, { locale: 'ar' });
    expect(result.issues.filter(issue => issue.kind === 'plural-missing').map(issue => issue.category).sort()).toEqual(['few', 'many', 'two', 'zero']);
    const complete = { ...en, ...Object.fromEntries(['zero', 'two', 'few', 'many'].map(form => [`members_${form}`, '{{count}} أعضاء'])) };
    expect(auditCatalog(en, complete, { locale: 'ar' }).issues).toEqual([]);
  });
  it('keeps legacy extras as warnings while recognizing legitimate localized plural forms', () => {
    const result = auditCatalog({ count_other: '{{count}} items' }, { count_other: '{{count}} éléments', count_one: '{{count}} élément', count_many: '{{count}} éléments', legacy: 'Ancien' }, { locale: 'fr' });
    expect(result.issues).toEqual([{ kind: 'extra', key: 'legacy' }]);
  });
  it('accepts the supported legacy bare singular but not other-language plural fallback', async () => {
    const en = { item: '{{count}} item', item_other: '{{count}} items' };
    const fr = { item: '{{count}} élément', item_other: '{{count}} éléments', item_many: '{{count}} éléments' };
    expect(auditCatalog(en, fr, { locale: 'fr' }).issues).toEqual([]);
    const instance = createInstance();
    await instance.init({ lng: 'ar', fallbackLng: 'en', resources: { en: { translation: en }, ar: { translation: { item: '{{count}} عنصر', item_other: '{{count}} عناصر' } } } });
    expect(instance.t('item', { count: 3, returnDetails: true }).exactUsedKey).toBe('item');
    expect(auditCatalog(en, { item: '{{count}} عنصر', item_other: '{{count}} عناصر' }, { locale: 'ar' }).issues).toContainEqual({ kind: 'plural-missing', key: 'item_few', category: 'few' });
  });
  it('dry-runs only the selected extension namespace with its correct regional folder', () => {
    const script = resolve('scripts/translate-i18n.mjs');
    const result = spawnSync(process.execPath, [script, '--dry-run', '--sync', '--lang', 'pt-BR', '--ns', 'extension'], { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('extension/messages');
    expect(result.stdout).not.toMatch(/\n\s+[~→✓] (?:common|settings|chat) /);
  });
  it.each([{ args: ['--force'] }, { args: ['--ns', 'not-a-namespace'] }, { args: ['--lang'] }])('refuses unsafe or invalid CLI options $args even in dry-run', ({ args }) => {
    const script = resolve('scripts/translate-i18n.mjs');
    const result = spawnSync(process.execPath, [script, '--dry-run', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1);
  });
  it('offline checker exercises all current English catalogs without any missing or false plural findings', () => {
    const script = resolve('scripts/check-locales.mjs');
    const result = spawnSync(process.execPath, [script, '--locale', 'en', '--json'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).failures).toBe(0);
  });
});
