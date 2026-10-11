import type { IOCEntry } from '../types';

export const IOC_CACHE_MAX_ENTRIES = 8;
export const IOC_CACHE_MAX_CHARACTERS = 2_000_000;

// Extraction creates only these scalar fields. Keep the private snapshot separate
// from mutable analyst annotations and arrays returned to callers.
export type ExtractedIOC = Pick<IOCEntry, 'id' | 'type' | 'value' | 'confidence' | 'firstSeen' | 'dismissed'>;

interface CacheEntry {
  content: string;
  optionsKey: string;
  result: ExtractedIOC[];
  characters: number;
}

function copyEntries(entries: readonly ExtractedIOC[]): ExtractedIOC[] {
  return entries.map(({ id, type, value, confidence, firstSeen, dismissed }) => ({
    id, type, value, confidence, firstSeen, dismissed,
  }));
}

/** Exact-input, memory-only LRU. The character budget counts retained UTF-16
 * code units, not heap bytes; the entry and existing extraction-result limits
 * separately bound record overhead. Oversized results are returned, not cached.
 */
export class IOCExtractionCache {
  private readonly entries: CacheEntry[] = [];
  private characters = 0;
  private readonly maxEntries: number;
  private readonly maxCharacters: number;

  constructor(maxEntries = IOC_CACHE_MAX_ENTRIES, maxCharacters = IOC_CACHE_MAX_CHARACTERS) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0
      || !Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
      throw new RangeError('IOC cache limits must be nonnegative safe integers.');
    }
    this.maxEntries = maxEntries;
    this.maxCharacters = maxCharacters;
  }

  get size(): number { return this.entries.length; }
  get retainedCharacters(): number { return this.characters; }

  get(content: string, optionsKey: string): ExtractedIOC[] | undefined {
    if (content.length + optionsKey.length > this.maxCharacters) return undefined;
    const index = this.entries.findIndex(entry => entry.content === content && entry.optionsKey === optionsKey);
    if (index < 0) return undefined;
    const [entry] = this.entries.splice(index, 1);
    this.entries.push(entry);
    return copyEntries(entry.result);
  }

  set(content: string, optionsKey: string, result: readonly ExtractedIOC[]): boolean {
    if (this.maxEntries === 0) return false;
    let characters = content.length + optionsKey.length;
    if (characters > this.maxCharacters) return false;
    for (const entry of result) {
      characters += entry.id.length + entry.type.length + entry.value.length + entry.confidence.length;
      if (characters > this.maxCharacters) return false;
    }

    const previous = this.entries.findIndex(entry => entry.content === content && entry.optionsKey === optionsKey);
    if (previous >= 0) this.remove(previous);
    while (this.entries.length >= this.maxEntries || this.characters + characters > this.maxCharacters) {
      this.remove(0);
    }
    this.entries.push({ content, optionsKey, result: copyEntries(result), characters });
    this.characters += characters;
    return true;
  }

  private remove(index: number): void {
    const [entry] = this.entries.splice(index, 1);
    if (entry) this.characters -= entry.characters;
  }
}
