import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../public/locales');
const read = (locale: string, file: string) => JSON.parse(readFileSync(resolve(root, locale, file), 'utf8')) as Record<string, string>;
const english = read('en', 'identities.json');
const locales = readdirSync(root).filter(locale => locale !== 'en');

describe('Identities strings in every language', () => {
  it('has 20 translated locales', () => expect(locales).toHaveLength(20));

  it.each(locales)('%s translates the sentences, not just copies English', locale => {
    const translated = read(locale, 'identities.json');
    // The same keys as English, allowing each language its own plural forms (_few, _many…).
    const families = (keys: string[]) => [...new Set(keys.map(key => key.replace(/_(zero|one|two|few|many|other)$/, '')))];
    expect(families(Object.keys(translated))).toEqual(families(Object.keys(english)));
    for (const key of ['header.descScoped', 'detailForm.private', 'merge.confirmMessage', 'found.hint', 'trash.confirmMessage', 'readOnly.remote', 'org.desc']) {
      expect(translated[key], `${locale} ${key}`).not.toBe(english[key]);
    }
  });

  it.each(locales)('%s keeps built-in connection phrases and types distinct, so typed text maps to one of them', locale => {
    const translated = read(locale, 'identities.json');
    for (const prefix of ['connection.', 'type.']) {
      const values = Object.entries(translated).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value.toLowerCase().trim());
      expect(new Set(values).size, `${locale} ${prefix}`).toBe(values.length);
    }
  });
});
