#!/usr/bin/env node
// Offline only: no provider, browser, or network requests. --report allows a
// nonzero translation backlog to be inspected without presenting it as a pass.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstance } from 'i18next';
import { auditCatalog, catalogLeaves, extensionLocaleCode, extensionMessages, interpolationParams } from './lib/locale-quality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'public/locales');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
let namespaces = readdirSync(join(appRoot, 'en')).filter(name => name.endsWith('.json'));
let locales = readdirSync(appRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const localeFilter = option('--locale');
const namespaceFilter = option('--namespace');
if (process.argv.includes('--locale')) {
  const requested = localeFilter?.split(',') ?? [];
  if (!requested.length || requested.some(locale => !locales.includes(locale))) throw new Error('--locale requires supported app codes, optionally comma-separated');
  locales = requested;
}
if (process.argv.includes('--namespace')) {
  if (namespaceFilter !== 'extension' && !namespaces.includes(`${namespaceFilter}.json`)) throw new Error('--namespace requires a supported app namespace or extension');
  namespaces = namespaceFilter === 'extension' ? [] : [`${namespaceFilter}.json`];
}
const records = [];
const add = (locale, namespace, issue) => records.push({ locale, namespace, ...issue });
const enExtension = read(join(root, 'extension/src/_locales/en/messages.json'));
const enMessages = extensionMessages(enExtension);

for (const locale of locales) {
  for (const filename of namespaces) {
    const namespace = filename.slice(0, -5);
    try {
      const english = read(join(appRoot, 'en', filename));
      const translated = read(join(appRoot, locale, filename));
      const result = auditCatalog(english, translated, { locale, namespace });
      result.issues.forEach(issue => add(locale, namespace, issue));
      // Exercise the same plural resolver used in the app, not just suffix names.
      const instance = createInstance();
      await instance.init({ lng: locale, fallbackLng: 'en', resources: { en: { translation: english }, [locale]: { translation: translated } }, interpolation: { escapeValue: false }, initImmediate: false });
      const rules = new Intl.PluralRules(locale);
      const samples = new Map();
      for (const number of [0, 1, 2, 3, 4, 5, 11, 21, 100, 101, 1_000_000, 0.1, 1.1, 2.1]) samples.set(rules.select(number), number);
      const params = Object.fromEntries(catalogLeaves(english).flatMap(leaf => [...interpolationParams(leaf.value)].map(name => [name, 'sample'])));
      for (const [key, { stem, category }] of result.pluralForms) {
        if (!samples.has(category)) { add(locale, namespace, { kind: 'plural-sample', key }); continue; }
        const detail = instance.t(stem, { ...params, count: samples.get(category), returnDetails: true });
        if (detail.usedLng !== locale || detail.exactUsedKey !== key || /\{\{/.test(detail.res)) add(locale, namespace, { kind: 'plural-render', key, usedLng: detail.usedLng, usedKey: detail.exactUsedKey });
      }
    } catch (error) { add(locale, namespace, { kind: 'invalid', key: '', message: error.message }); }
  }
  if (!namespaceFilter || namespaceFilter === 'extension') try {
    const translated = read(join(root, 'extension/src/_locales', extensionLocaleCode(locale), 'messages.json'));
    const messages = extensionMessages(translated);
    auditCatalog(enMessages, messages, { locale, extension: true }).issues.forEach(issue => add(locale, 'extension', issue));
    for (const [key, entry] of Object.entries(translated)) {
      if (!enExtension[key]) continue;
      const definitions = value => Object.fromEntries(Object.entries(value.placeholders ?? {}).map(([name, definition]) => [name.toLowerCase(), definition.content]));
      const expected = definitions(enExtension[key]);
      const actual = definitions(entry);
      if (Object.keys(expected).length !== Object.keys(actual).length || Object.entries(expected).some(([name, content]) => actual[name] !== content)) add(locale, 'extension', { kind: 'placeholder-definition', key });
    }
  } catch (error) { add(locale, 'extension', { kind: 'invalid', key: '', message: error.message }); }
}
const counts = {};
for (const record of records) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
const failures = records.filter(record => record.kind !== 'extra').length;
const report = { locales: locales.length, namespaces: namespaces.length, extensionKeys: Object.keys(enMessages).length, failures, counts, issues: records };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Locale audit: ${locales.length} languages, ${namespaces.length} app namespaces, ${report.extensionKeys} extension messages`);
  console.log(JSON.stringify(counts));
  console.log(failures ? `INCOMPLETE: ${failures} coverage/validation findings; existing extra keys are warnings and remain preserved.` : 'PASS: keys, semantic parameters, extension definitions, and runtime plural selection validated.');
  if (process.argv.includes('--details')) for (const record of records) console.log(`${record.locale}/${record.namespace}: ${record.kind} ${record.key}`);
}
if (failures && !process.argv.includes('--report')) process.exitCode = 1;
