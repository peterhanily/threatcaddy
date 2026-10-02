import type { StandaloneIOC } from '../types';
import { conservativeClsLevel } from './classification';

/** Deduplicate only after combining every source's handling restrictions and provenance. */
export function mergeImportedIOCs(rows: Partial<StandaloneIOC>[]): Partial<StandaloneIOC>[] {
  const merged = new Map<string, Partial<StandaloneIOC>>();
  const confidence = ['low', 'medium', 'high', 'confirmed'];
  for (const row of rows) {
    const key = JSON.stringify([row.type, row.value]);
    const prior = merged.get(key);
    if (!prior) { merged.set(key, { ...row }); continue; }
    prior.clsLevel = conservativeClsLevel([prior.clsLevel, row.clsLevel]);
    if (row.confidence && (!prior.confidence || confidence.indexOf(row.confidence) < confidence.indexOf(prior.confidence))) prior.confidence = row.confidence;
    prior.enrichment = { ...prior.enrichment };
    for (const [source, records] of Object.entries(row.enrichment ?? {})) prior.enrichment[source] = [...prior.enrichment[source] ?? [], ...records];
    prior.tags = [...new Set([...prior.tags ?? [], ...row.tags ?? []])];
  }
  return [...merged.values()];
}

/** Differently marked records are not silently skipped as ordinary duplicates. */
export function importDuplicateKey(ioc: Partial<StandaloneIOC>): string {
  return JSON.stringify([ioc.type, ioc.value, ioc.clsLevel ?? '', ioc.enrichment ?? null]);
}
