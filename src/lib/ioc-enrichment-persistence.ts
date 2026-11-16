import { nanoid } from 'nanoid';
import { db } from '../db';
import { IOC_TYPE_LABELS, type ConfidenceLevel, type IOCType, type StandaloneIOC } from '../types';
import { getCurrentUserName } from './utils';

export type IOCIntegrationSource =
  | { kind: 'note'; id: string; title?: string }
  | { kind: 'task'; id: string; title?: string }
  | { kind: 'event'; id: string; title?: string }
  | { kind: 'evidence'; id: string; title?: string; fileName?: string };

export interface IOCIntegrationTarget {
  id?: string;
  value: string;
  type: string;
  confidence?: string;
}

export interface PersistIOCIntegrationUpdateOptions {
  ioc: IOCIntegrationTarget;
  fields: Record<string, unknown>;
  folderId?: string;
  source?: IOCIntegrationSource;
  tags?: string[];
}

function iocKey(type: string, value: string): string {
  return `${type}:${value.trim().toLowerCase()}`;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function confidence(value: unknown, fallback: ConfidenceLevel = 'medium'): ConfidenceLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'confirmed'
    ? value
    : fallback;
}

function iocType(value: string): IOCType {
  return Object.prototype.hasOwnProperty.call(IOC_TYPE_LABELS, value) ? value as IOCType : 'domain';
}

function sourceTags(source?: IOCIntegrationSource): string[] {
  if (!source) return ['source:integration'];
  return [`source:${source.kind}`, 'source:integration'];
}

function sourceNote(source?: IOCIntegrationSource): string | undefined {
  if (!source) return undefined;
  if (source.kind === 'evidence') {
    return `Promoted for enrichment from evidence file "${source.fileName || source.title || source.id}".`;
  }
  const label = source.kind === 'event' ? 'timeline event' : source.kind;
  return `Promoted for enrichment from ${label} "${source.title || source.id}".`;
}

function sourceLinkPatch(existing: Partial<StandaloneIOC>, source?: IOCIntegrationSource): Partial<StandaloneIOC> {
  if (!source) return {};
  if (source.kind === 'note') return { linkedNoteIds: unique([...(existing.linkedNoteIds || []), source.id]) };
  if (source.kind === 'task') return { linkedTaskIds: unique([...(existing.linkedTaskIds || []), source.id]) };
  if (source.kind === 'event') return { linkedTimelineEventIds: unique([...(existing.linkedTimelineEventIds || []), source.id]) };
  return { linkedEvidenceIds: unique([...(existing.linkedEvidenceIds || []), source.id]) };
}

export function normalizeIOCEnrichment(
  enrichment: unknown,
  now = Date.now(),
  source = 'integration',
): Record<string, Array<Record<string, unknown>>> | undefined {
  if (!isRecord(enrichment)) return undefined;

  const normalized: Record<string, Array<Record<string, unknown>>> = {};
  for (const [provider, rawSnapshots] of Object.entries(enrichment)) {
    const snapshots = Array.isArray(rawSnapshots) ? rawSnapshots : [rawSnapshots];
    const rows = snapshots
      .filter((snapshot): snapshot is Record<string, unknown> => isRecord(snapshot))
      .map((snapshot) => ({
        ...snapshot,
        ts: typeof snapshot.ts === 'number' ? snapshot.ts : now,
        source: snapshot.source || source,
      }))
      .slice(0, 20);
    if (rows.length > 0) normalized[provider] = rows;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function mergeEnrichment(
  existing: StandaloneIOC | undefined,
  incoming: unknown,
  now: number,
): StandaloneIOC['enrichment'] | undefined {
  const existingEnrichment = normalizeIOCEnrichment(existing?.enrichment, now, 'existing') || {};
  const incomingEnrichment = normalizeIOCEnrichment(incoming, now, 'integration');
  if (!incomingEnrichment) return Object.keys(existingEnrichment).length > 0 ? existingEnrichment : undefined;

  const merged: Record<string, Array<Record<string, unknown>>> = { ...existingEnrichment };
  for (const [provider, snapshots] of Object.entries(incomingEnrichment)) {
    merged[provider] = [...snapshots, ...(existingEnrichment[provider] || [])].slice(0, 20);
  }
  return merged;
}

async function findExistingIOC(target: IOCIntegrationTarget, folderId?: string): Promise<StandaloneIOC | undefined> {
  if (target.id) {
    const byId = await db.standaloneIOCs.get(target.id);
    if (byId) return byId;
  }

  const key = iocKey(target.type, target.value);
  const candidates = folderId
    ? await db.standaloneIOCs.where('folderId').equals(folderId).toArray()
    : await db.standaloneIOCs.toArray();
  return candidates.find((ioc) => !ioc.trashed && iocKey(ioc.type, ioc.value) === key);
}

export async function persistIOCIntegrationUpdate(
  options: PersistIOCIntegrationUpdateOptions,
): Promise<StandaloneIOC> {
  const now = Date.now();

  return db.transaction('rw', db.standaloneIOCs, async () => {
    const existing = await findExistingIOC(options.ioc, options.folderId);
    const updates: Partial<StandaloneIOC> = {
      ...sourceLinkPatch(existing || {}, options.source),
      updatedAt: now,
      lastSeen: now,
      tags: unique([...(existing?.tags || []), ...sourceTags(options.source), ...(options.tags || [])]),
    };

    if (options.fields.iocStatus !== undefined) updates.iocStatus = String(options.fields.iocStatus);
    if (options.fields.confidence !== undefined) {
      updates.confidence = confidence(options.fields.confidence, existing?.confidence || confidence(options.ioc.confidence));
    }

    const enrichment = mergeEnrichment(existing, options.fields.enrichment, now);
    if (enrichment) updates.enrichment = enrichment;

    if (existing) {
      await db.standaloneIOCs.update(existing.id, updates);
      return { ...existing, ...updates };
    }

    const created: StandaloneIOC = {
      id: nanoid(),
      type: iocType(options.ioc.type),
      value: options.ioc.value,
      confidence: confidence(options.fields.confidence, confidence(options.ioc.confidence)),
      analystNotes: sourceNote(options.source),
      iocStatus: updates.iocStatus,
      folderId: options.folderId,
      tags: updates.tags || sourceTags(options.source),
      ...sourceLinkPatch({}, options.source),
      enrichment,
      firstSeen: now,
      lastSeen: now,
      trashed: false,
      archived: false,
      createdBy: getCurrentUserName(),
      createdAt: now,
      updatedAt: now,
    };
    await db.standaloneIOCs.add(created);
    return created;
  });
}
