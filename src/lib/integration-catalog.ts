import type { CatalogEntry, IntegrationTemplate } from '../types/integration-types';

const CATALOG_URL = 'https://raw.githubusercontent.com/peterhanily/threatcaddy-integrations/main/catalog.json';
const CACHE_KEY = 'threatcaddy-integration-catalog';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

interface CachedCatalog {
  entries: CatalogEntry[];
  fetchedAt: number;
}

export type CatalogFailure = 'not-found' | 'offline' | 'network' | 'invalid';

export interface CatalogResult {
  entries: CatalogEntry[];
  source: 'network' | 'cache' | 'unavailable';
  error?: CatalogFailure;
}

const CATEGORIES = new Set(['enrichment', 'threat-feed', 'siem-soar', 'notification', 'export', 'pipeline', 'utility']);

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  const strings = ['id', 'name', 'description', 'author', 'category', 'icon', 'color', 'version', 'templateUrl', 'sha256', 'updatedAt'];
  if (!strings.every((key) => typeof entry[key] === 'string')) return false;
  if (!entry.id || !entry.name || !CATEGORIES.has(entry.category as string)) return false;
  if (!Array.isArray(entry.tags) || !entry.tags.every((tag) => typeof tag === 'string')) return false;
  if (typeof entry.downloads !== 'number' || !Number.isFinite(entry.downloads) || entry.downloads < 0) return false;
  if (entry.sha256 && !/^[a-f\d]{64}$/i.test(entry.sha256 as string)) return false;
  try {
    const url = new URL(entry.templateUrl as string);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCatalogEntries(value: unknown): value is CatalogEntry[] {
  return Array.isArray(value) && value.length <= 1_000 && value.every(isCatalogEntry);
}

export function getCachedCatalog({ allowExpired = false }: { allowExpired?: boolean } = {}): CatalogEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedCatalog> | null;
    if (!cached || typeof cached.fetchedAt !== 'number' || !Number.isFinite(cached.fetchedAt) || !isCatalogEntries(cached.entries)) return null;
    if (cached.fetchedAt > Date.now() + 60_000) return null;
    if (!allowExpired && Date.now() - cached.fetchedAt > CACHE_TTL) return null;
    return cached.entries;
  } catch {
    return null;
  }
}

export function clearCatalogCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage may be disabled; this must not prevent a network retry.
  }
}

function catalogFallback(error: CatalogFailure): CatalogResult {
  const entries = getCachedCatalog({ allowExpired: true });
  return { entries: entries ?? [], source: entries === null ? 'unavailable' : 'cache', error };
}

/** Optional remote catalog. Call only after an explicit user request. */
export async function fetchCatalog(): Promise<CatalogResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return catalogFallback('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(CATALOG_URL, { cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!resp.ok) return catalogFallback(resp.status === 404 ? 'not-found' : 'network');
    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      return catalogFallback('invalid');
    }
    if (!data || typeof data !== 'object' || !('entries' in data) || !isCatalogEntries(data.entries)) return catalogFallback('invalid');
    const entries = data.entries;

    // Cache in localStorage
    const cached: CachedCatalog = { entries, fetchedAt: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    } catch {
      // A storage quota or privacy restriction must not hide a valid response.
    }

    return { entries, source: 'network' };
  } catch {
    return catalogFallback('network');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTemplate(entry: CatalogEntry): Promise<IntegrationTemplate> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const resp = await fetch(entry.templateUrl, { signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!resp.ok) throw new Error(`Failed to fetch template: HTTP ${resp.status}`);
  const body = await resp.text();

  // Verify SHA-256 integrity when the catalog entry declares a hash
  if (entry.sha256) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (hashHex !== entry.sha256.toLowerCase()) {
      throw new Error(
        `Template integrity check failed: expected SHA-256 ${entry.sha256}, got ${hashHex}`,
      );
    }
  }

  const template: IntegrationTemplate = JSON.parse(body);

  // Validate required fields
  if (!template.id || !template.name || !template.steps) {
    throw new Error('Invalid template: missing required fields (id, name, steps)');
  }

  return template;
}
