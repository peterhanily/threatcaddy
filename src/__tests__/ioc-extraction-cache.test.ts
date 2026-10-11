import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IOCExtractionCache, IOC_CACHE_MAX_CHARACTERS, type ExtractedIOC } from '../lib/ioc-extraction-cache';
import type { extractIOCs } from '../lib/ioc-extractor';

const ids = vi.hoisted(() => {
  let next = 0;
  return vi.fn(() => `synthetic-ioc-${++next}`);
});
vi.mock('nanoid', () => ({ nanoid: ids }));

let extract: typeof extractIOCs;
beforeEach(async () => {
  ids.mockClear();
  vi.resetModules();
  extract = (await import('../lib/ioc-extractor')).extractIOCs;
});

const paragraph = (middle: string) => `${'Routine observation. '.repeat(20)}${middle}${' End of observation.'.repeat(20)}`;
const row = (value = '192.0.2.1'): ExtractedIOC => ({
  id: 'i', type: 'ipv4', value, confidence: 'medium', firstSeen: 1, dismissed: false,
});
const cost = (content: string, key: string, result: ExtractedIOC[]) => content.length + key.length
  + result.reduce((sum, item) => sum + item.id.length + item.type.length + item.value.length + item.confidence.length, 0);

describe('public IOC extraction cache identity', () => {
  it('extracts each equal-length middle edit independently despite unchanged first/last 200 characters', () => {
    const first = paragraph('192.0.2.1');
    const second = paragraph('192.0.2.2');
    expect(first.length).toBe(second.length);
    expect(first.slice(0, 200)).toBe(second.slice(0, 200));
    expect(first.slice(-200)).toBe(second.slice(-200));
    expect(extract(first).map(item => item.value)).toEqual(['192.0.2.1']);
    expect(extract(second).map(item => item.value)).toEqual(['192.0.2.2']);
    expect(extract(first).map(item => item.value)).toEqual(['192.0.2.1']);
    expect(ids).toHaveBeenCalledTimes(2);
  });

  it('reuses exact content and default options without exposing the retained objects', () => {
    const first = extract('Recorded 192.0.2.10');
    const second = extract('Recorded 192.0.2.10', { defaultConfidence: 'medium' });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(ids).toHaveBeenCalledTimes(1);
  });

  it('distinguishes all types from an explicit empty type selection in either call order', () => {
    for (const content of ['Recorded 192.0.2.11', 'Recorded 192.0.2.12']) {
      if (content.endsWith('12')) expect(extract(content, { enabledTypes: [] })).toEqual([]);
      expect(extract(content, {})).toHaveLength(1);
      expect(extract(content, { enabledTypes: [] })).toEqual([]);
      expect(extract(content, { enabledTypes: undefined })).toHaveLength(1);
    }
    expect(ids).toHaveBeenCalledTimes(2);
  });

  it('isolates type/confidence settings and snapshots the caller-owned type array', () => {
    const content = 'Recorded 192.0.2.13 and example.com';
    const enabledTypes = ['ipv4'];
    const first = extract(content, { enabledTypes, defaultConfidence: 'high' });
    expect(first.map(item => item.type)).toEqual(['ipv4']);
    enabledTypes.push('domain');
    expect(extract(content, { enabledTypes, defaultConfidence: 'low' }).map(item => [item.type, item.confidence]))
      .toEqual([['ipv4', 'low'], ['domain', 'low']]);
    expect(extract(content, { enabledTypes: ['ipv4'], defaultConfidence: 'high' })).toEqual(first);
    expect(extract(content, { enabledTypes: ['domain'] }).map(item => item.value)).toEqual(['example.com']);
  });

  it('isolates both miss and hit results from subsequent analyst mutations', () => {
    const content = 'Recorded 192.0.2.14';
    const first = extract(content);
    const expected = structuredClone(first);
    const firstRow = first[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) throw new Error('Expected synthetic indicator');
    firstRow.dismissed = true;
    firstRow.value = '192.0.2.99';
    firstRow.analystNotes = 'Local annotation';
    firstRow.relationships = [];
    first.length = 0;
    const second = extract(content);
    expect(second).toEqual(expected);
    const secondRow = second[0];
    if (!secondRow) throw new Error('Expected synthetic indicator');
    secondRow.confidence = 'low';
    second.push(row('192.0.2.98'));
    expect(extract(content)).toEqual(expected);
    expect(ids).toHaveBeenCalledTimes(1);
  });

  it('still extracts oversized cache inputs while bypassing retention on every call', () => {
    const content = `${'Routine observation. '.repeat(Math.ceil(IOC_CACHE_MAX_CHARACTERS / 21))} 192.0.2.15`;
    expect(content.length).toBeGreaterThan(IOC_CACHE_MAX_CHARACTERS);
    const first = extract(content, { enabledTypes: ['ipv4'] });
    const second = extract(content, { enabledTypes: ['ipv4'] });
    expect(first.map(item => item.value)).toEqual(['192.0.2.15']);
    expect(second.map(item => item.value)).toEqual(['192.0.2.15']);
    expect(ids).toHaveBeenCalledTimes(2);
  });
});

describe('bounded exact-input retention', () => {
  it('promotes a hit before evicting the least recently used entry', () => {
    const cache = new IOCExtractionCache(2, 1000);
    cache.set('first', '[]', [row()]);
    cache.set('second', '[]', [row('192.0.2.2')]);
    expect(cache.get('first', '[]')).toHaveLength(1);
    cache.set('third', '[]', [row('192.0.2.3')]);
    expect(cache.get('second', '[]')).toBeUndefined();
    expect(cache.get('first', '[]')).toHaveLength(1);
    expect(cache.get('third', '[]')).toHaveLength(1);
    expect(cache.size).toBe(2);
  });

  it('counts exact source, options and scalar-result strings, including UTF-16 pairs', () => {
    const content = '🙂'; const key = '[null,"medium"]'; const result = [row()];
    const budget = cost(content, key, result);
    const cache = new IOCExtractionCache(8, budget);
    expect(cache.set(content, key, result)).toBe(true);
    expect(cache.retainedCharacters).toBe(budget);
    expect(cache.set(`${content}x`, key, result)).toBe(false);
    expect(cache.retainedCharacters).toBe(budget);
    expect(cache.get(content, key)).toEqual(result);
    const tooSmall = new IOCExtractionCache(8, budget - 1);
    expect(tooSmall.set(content, key, result)).toBe(false);
    expect(tooSmall.size).toBe(0);
  });

  it('evicts for the total character budget, not only entry count, and keeps accounting exact on replacement', () => {
    const result = [row()]; const budget = cost('first', '[]', result) * 2;
    const cache = new IOCExtractionCache(8, budget);
    cache.set('first', '[]', result);
    cache.set('other', '[]', result);
    cache.set('third', '[]', result);
    expect(cache.size).toBe(2);
    expect(cache.get('first', '[]')).toBeUndefined();
    expect(cache.retainedCharacters).toBe(budget);
    cache.set('third', '[]', []);
    expect(cache.size).toBe(2);
    expect(cache.retainedCharacters).toBe(cost('other', '[]', result) + cost('third', '[]', []));
  });

  it('bypasses oversized source/options/results without evicting usable entries', () => {
    const cache = new IOCExtractionCache(8, 80);
    cache.set('small', '[]', [row()]);
    const before = cache.retainedCharacters;
    expect(cache.set('x'.repeat(81), '', [])).toBe(false);
    expect(cache.set('', 'x'.repeat(81), [])).toBe(false);
    expect(cache.set('source', '', [row('x'.repeat(81))])).toBe(false);
    expect(cache.get('small', '[]')).toEqual([row()]);
    expect(cache.retainedCharacters).toBe(before);
    expect(cache.size).toBe(1);
  });

  it('keeps empty results cacheable and permits a disabled cache with no retention', () => {
    const cache = new IOCExtractionCache(8, 50);
    cache.set('plain text', '[]', []);
    expect(cache.get('plain text', '[]')).toEqual([]);
    const disabled = new IOCExtractionCache(0, 0);
    expect(disabled.set('', '', [])).toBe(false);
    expect(disabled.size).toBe(0);
    expect(disabled.retainedCharacters).toBe(0);
  });

  it('never retains mutable caller rows or later annotations', () => {
    const cache = new IOCExtractionCache(8, 1000);
    const source = [row()]; const expected = [row()];
    cache.set('source', '[]', source);
    source[0].value = 'changed';
    source.length = 0;
    const hit = cache.get('source', '[]');
    expect(hit).toEqual(expected);
    if (!hit) throw new Error('Expected cache hit');
    hit[0].value = 'changed again';
    hit.push(row());
    expect(cache.get('source', '[]')).toEqual(expected);
  });
});
