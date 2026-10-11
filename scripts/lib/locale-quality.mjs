// Offline catalog primitives. Existing translations are never replaced by a merge.
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

export function extensionLocaleCode(code) {
  return code === 'pt-BR' ? 'pt_BR' : code === 'zh-CN' ? 'zh_CN' : code;
}

export function catalogLeaves(catalog, prefix = []) {
  if (!object(catalog)) throw new Error(`Expected a catalog object at ${prefix.join('.') || '<root>'}`);
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = [...prefix, key];
    if (typeof value === 'string') return [{ path, key: path.join('.'), value }];
    if (!object(value)) throw new Error(`Expected a string or object at ${path.join('.')}`);
    return catalogLeaves(value, path);
  });
}

export function chunkCatalog(catalog, maxBytes = 8000) {
  const chunks = [];
  let current = {};
  let size = 0;
  for (const { path, value } of catalogLeaves(catalog)) {
    const bytes = new TextEncoder().encode(JSON.stringify([path, value])).byteLength;
    if (size && size + bytes > maxBytes) { chunks.push(current); current = {}; size = 0; }
    let target = current;
    for (const key of path.slice(0, -1)) {
      if (!own(target, key)) put(target, key, {});
      target = target[key];
    }
    put(target, path.at(-1), value);
    size += bytes;
  }
  if (size) chunks.push(current);
  return chunks;
}

export function missingTranslations(english, existing) {
  catalogLeaves(english);
  if (!object(existing)) throw new Error('Existing catalog must be an object');
  const result = {};
  for (const [key, value] of Object.entries(english)) {
    if (!own(existing, key)) put(result, key, structuredClone(value));
    else if (typeof value === 'string') {
      if (typeof existing[key] !== 'string') throw new Error(`Existing catalog shape differs at ${key}`);
    } else {
      const missing = missingTranslations(value, existing[key]);
      if (Object.keys(missing).length) put(result, key, missing);
    }
  }
  return result;
}

export function interpolationParams(text) {
  return new Set([...text.matchAll(/\{\{\s*-?\s*([^{}]+?)\s*\}\}/g)].map(match => match[1].split(',')[0].trim()));
}

// These particular English strings assemble grammar with suffix parameters.
// Translations may omit those suffixes, never semantic values or unknown params.
const OPTIONAL_GRAMMAR = {
  'agent.dashboard.activeAgents': ['suffix'],
  'agent.meeting.roundsCompleted': ['suffix'],
  'analysis.iocStats.deleteSelectedMessage': ['plural'],
  'analysis.iocList.deleteSelectedMessage': ['plural'],
  'analysis.dedup.summary': ['groupPlural', 'totalPlural'],
  'graph.detail.foundInEntities': ['suffix'],
  'graph.editDialog.instancesAcrossEntities': ['entitySuffix', 'instanceSuffix'],
  'integrations.history.apiCalls': ['suffix'],
  'notes.list.deleteFolderConfirmWithNotes': ['s'],
  'settings.agents.connected': ['plural'],
  'settings.agents.skillsLastFetched': ['plural'],
  'evidence.readable.hiddenNoisy_one': ['totalS'],
  'evidence.readable.hiddenNoisy_two': ['totalS'],
  'evidence.readable.hiddenNoisy_few': ['totalS'],
  'evidence.readable.hiddenNoisy_many': ['totalS'],
  'evidence.readable.hiddenNoisy_zero': ['totalS'],
  'evidence.readable.hiddenNoisy_other': ['totalS'],
};

export function placeholderDifferences(english, translated, key, extension = false) {
  const params = extension
    ? text => new Set([...text.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)\$|\$(\d+)/g)].map(match => (match[1] ?? match[2]).toLowerCase()))
    : interpolationParams;
  const expected = params(english);
  const actual = params(translated);
  const optional = new Set(extension ? [] : OPTIONAL_GRAMMAR[key] ?? []);
  return {
    missing: [...expected].filter(param => !actual.has(param) && !optional.has(param)),
    extra: [...actual].filter(param => !expected.has(param)),
  };
}

export function validateTranslationBatch(requested, translated, { namespace = '', extension = false } = {}) {
  const visit = (source, target, path) => {
    if (!object(target)) throw new Error(`Translation must be an object at ${path.join('.') || '<root>'}`);
    for (const key of Object.keys(target)) {
      if (!own(source, key)) throw new Error(`Unexpected translated key: ${[...path, key].join('.')}`);
    }
    for (const [key, value] of Object.entries(source)) {
      const next = [...path, key];
      const label = next.join('.');
      if (!own(target, key)) throw new Error(`Missing translated key: ${label}`);
      if (typeof value === 'string') {
        if (typeof target[key] !== 'string' || (value.trim() && !target[key].trim())) throw new Error(`Invalid translated string: ${label}`);
        const differences = placeholderDifferences(value, target[key], [namespace, label].filter(Boolean).join('.'), extension);
        if (differences.missing.length || differences.extra.length) throw new Error(`Translation parameters differ: ${label}`);
      } else visit(value, target[key], next);
    }
  };
  catalogLeaves(requested);
  visit(requested, translated, []);
  return translated;
}

export function mergeMissingTranslations(english, existing, translated, options) {
  const missing = missingTranslations(english, existing);
  validateTranslationBatch(missing, translated, options);
  const merge = (prior, additions) => {
    const result = structuredClone(prior);
    for (const [key, value] of Object.entries(additions)) {
      if (!own(prior, key)) put(result, key, structuredClone(value));
      else if (object(prior[key]) && object(value)) put(result, key, merge(prior[key], value));
      else throw new Error(`Refusing to overwrite existing translation: ${key}`);
    }
    return result;
  };
  return merge(existing, translated);
}

export function extensionMessages(catalog) {
  if (!object(catalog)) throw new Error('Extension catalog must be an object');
  const messages = {};
  for (const [key, entry] of Object.entries(catalog)) {
    if (!object(entry) || typeof entry.message !== 'string') throw new Error(`Invalid extension message: ${key}`);
    put(messages, key, entry.message);
    const placeholders = entry.placeholders ?? {};
    if (!object(placeholders)) throw new Error(`Invalid extension placeholders: ${key}`);
    const definitions = new Map(Object.entries(placeholders).map(([name, definition]) => [name.toLowerCase(), definition]));
    for (const token of entry.message.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)\$/g)) {
      const definition = definitions.get(token[1].toLowerCase());
      if (!object(definition) || typeof definition.content !== 'string') throw new Error(`Undefined extension placeholder: ${key}.${token[1]}`);
    }
  }
  return messages;
}

export function auditCatalog(english, translated, { namespace = '', locale = 'en', extension = false } = {}) {
  const reference = catalogLeaves(english);
  const actual = catalogLeaves(translated);
  const target = new Map(actual.map(leaf => [leaf.key, leaf]));
  const base = new Map(reference.map(leaf => [leaf.key, leaf]));
  const issues = [];
  for (const [leaves, label] of [[reference, 'English'], [actual, locale]]) {
    if (new Set(leaves.map(leaf => leaf.key)).size !== leaves.length) issues.push({ kind: 'ambiguous-key', key: label });
  }
  for (const source of reference) {
    const value = target.get(source.key);
    if (!value) { issues.push({ kind: 'missing', key: source.key }); continue; }
    if (source.value.trim() && !value.value.trim()) issues.push({ kind: 'empty', key: source.key });
    const diff = placeholderDifferences(source.value, value.value, `${namespace}.${source.key}`, extension);
    if (diff.missing.length || diff.extra.length) issues.push({ kind: 'parameters', key: source.key, ...diff });
  }
  const pluralForms = new Map();
  if (!extension) {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const leaf of reference) {
      if (!leaf.key.endsWith('_other') || !interpolationParams(leaf.value).has('count')) continue;
      const stem = leaf.key.slice(0, -6);
      for (const category of categories) {
        // Historical catalogs use a bare singular alongside _other. i18next
        // legitimately resolves that shape for category one; it is not evidence
        // that a bare singular can serve Arabic few/many/zero or other forms.
        const key = category === 'one' && base.has(stem) && !base.has(`${stem}_one`) ? stem : `${stem}_${category}`;
        pluralForms.set(key, { stem, category });
        const value = target.get(key);
        if (!value) issues.push({ kind: 'plural-missing', key, category });
        else if (!base.has(key)) {
          const diff = placeholderDifferences(leaf.value, value.value, `${namespace}.${key}`);
          if (diff.missing.length || diff.extra.length) issues.push({ kind: 'parameters', key, ...diff });
        }
      }
    }
  }
  for (const leaf of actual) if (!base.has(leaf.key) && !pluralForms.has(leaf.key)) issues.push({ kind: 'extra', key: leaf.key });
  return { issues, leaves: actual.length, pluralForms: [...pluralForms.entries()] };
}
