import type { CatalogEntry, IntegrationTemplate } from '../types/integration-types';

const CATALOG_URL = 'https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/catalog.json';
const CACHE_KEY = 'threatcaddy-integration-catalog';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

interface CachedCatalog {
  entries: CatalogEntry[];
  fetchedAt: number;
}

export function getCachedCatalog(): CatalogEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedCatalog = JSON.parse(raw);
    if (Date.now() - cached.fetchedAt > CACHE_TTL) return null;
    return cached.entries;
  } catch {
    return null;
  }
}

export function clearCatalogCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  try {
    const resp = await fetch(CATALOG_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const entries: CatalogEntry[] = data.entries ?? [];

    // Cache in localStorage
    const cached: CachedCatalog = { entries, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    return entries;
  } catch {
    // On network error, return cached version or empty array
    const cached = getCachedCatalog();
    return cached ?? [];
  }
}

export async function fetchTemplate(entry: CatalogEntry): Promise<IntegrationTemplate> {
  const resp = await fetch(entry.templateUrl);
  if (!resp.ok) throw new Error(`Failed to fetch template: HTTP ${resp.status}`);
  const template: IntegrationTemplate = await resp.json();

  // Validate required fields
  if (!template.id || !template.name || !template.steps) {
    throw new Error('Invalid template: missing required fields (id, name, steps)');
  }

  return template;
}
