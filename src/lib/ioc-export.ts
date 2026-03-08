import type { IOCEntry, ConfidenceLevel } from '../types';

export interface IOCExportEntry {
  clipTitle: string;
  sourceUrl?: string;
  iocs: IOCEntry[];
  tags?: string[];
  entityClsLevel?: string;
}

export interface ThreatIntelExportConfig {
  defaultClsLevel?: string;
  defaultReportSource?: string;
}

/** Optional filters applied before exporting/pushing IOCs. */
export interface IOCExportFilter {
  /** Include only IOCs whose iocStatus is in this set (empty = no filter). */
  statuses?: string[];
  /** Include only IOCs whose confidence is in this set (empty = no filter). */
  confidences?: ConfidenceLevel[];
  /** Include only IOCs created/updated after this timestamp (epoch ms). */
  afterDate?: number;
}

/** Apply export filters to a list of IOC entries. */
export function applyExportFilter(entries: IOCExportEntry[], filter?: IOCExportFilter): IOCExportEntry[] {
  if (!filter) return entries;
  const { statuses, confidences, afterDate } = filter;
  const hasStatuses = statuses && statuses.length > 0;
  const hasConfidences = confidences && confidences.length > 0;

  return entries.map((e) => ({
    ...e,
    iocs: e.iocs.filter((ioc) => {
      if (hasStatuses && !statuses.includes(ioc.iocStatus || '')) return false;
      if (hasConfidences && !confidences.includes(ioc.confidence)) return false;
      if (afterDate && ioc.firstSeen < afterDate) return false;
      return true;
    }),
  }));
}

interface ExportedIOC {
  type: string;
  value: string;
  confidence: string;
  analystNotes?: string;
  attribution?: string;
  firstSeen: number;
  dismissed: boolean;
  clsLevel?: string;
}

function toExportedIOC(ioc: IOCEntry, entityClsLevel?: string): ExportedIOC {
  const level = ioc.clsLevel || entityClsLevel || undefined;
  return {
    type: ioc.type,
    value: ioc.value,
    confidence: ioc.confidence,
    analystNotes: ioc.analystNotes,
    attribution: ioc.attribution,
    firstSeen: ioc.firstSeen,
    dismissed: ioc.dismissed,
    clsLevel: level,
  };
}

function filterActive(entries: IOCExportEntry[]): IOCExportEntry[] {
  return entries.map((e) => ({
    ...e,
    iocs: e.iocs.filter((ioc) => !ioc.dismissed),
  }));
}

export function formatIOCsJSON(entries: IOCExportEntry[], _config?: ThreatIntelExportConfig, filter?: IOCExportFilter): string {
  const active = filterActive(applyExportFilter(entries, filter));
  const totalIOCs = active.reduce((sum, e) => sum + e.iocs.length, 0);

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalIOCs,
      clips: active.map((e) => ({
        clipTitle: e.clipTitle,
        sourceUrl: e.sourceUrl,
        iocs: e.iocs.map((ioc) => toExportedIOC(ioc, e.entityClsLevel)),
      })),
    },
    null,
    2,
  );
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

const CSV_HEADERS = ['type', 'value', 'confidence', 'analystNotes', 'attribution', 'firstSeen', 'dismissed', 'clsLevel', 'clipTitle', 'sourceUrl'];

export function formatIOCsCSV(entries: IOCExportEntry[], _config?: ThreatIntelExportConfig, filter?: IOCExportFilter): string {
  const active = filterActive(applyExportFilter(entries, filter));
  const rows: string[] = [CSV_HEADERS.join(',')];

  for (const entry of active) {
    for (const ioc of entry.iocs) {
      const row = [
        escapeCSVField(ioc.type),
        escapeCSVField(ioc.value),
        escapeCSVField(ioc.confidence),
        escapeCSVField(ioc.analystNotes || ''),
        escapeCSVField(ioc.attribution || ''),
        escapeCSVField(new Date(ioc.firstSeen).toISOString()),
        escapeCSVField(String(ioc.dismissed)),
        escapeCSVField(ioc.clsLevel || entry.entityClsLevel || ''),
        escapeCSVField(entry.clipTitle),
        escapeCSVField(entry.sourceUrl || ''),
      ];
      rows.push(row.join(','));
    }
  }

  return rows.join('\n');
}

const CONFIDENCE_TO_NUMBER: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  confirmed: 5,
};

interface FlatIOC {
  id: number;
  actor_name: string;
  ioc_value: string;
  report_date: string;
  report_title: string;
  report_source: string;
  cls_level: string;
  confidence: number;
  first_seen: string;
  ioc_type: string;
  ioc_subtype: string;
  notes: string;
  related_id: string;
  relationship_type: string;
  ioc_status: string;
  tags: string;
}

function buildFlatIOCs(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}, filter?: IOCExportFilter): FlatIOC[] {
  const active = filterActive(applyExportFilter(entries, filter));
  const reportDate = new Date().toISOString();
  const result: FlatIOC[] = [];
  let seq = 1;

  for (const entry of active) {
    const tagsStr = (entry.tags ?? []).join(':');
    for (const ioc of entry.iocs) {
      result.push({
        id: seq++,
        actor_name: ioc.attribution || '',
        ioc_value: ioc.value,
        report_date: reportDate,
        report_title: entry.clipTitle,
        report_source: entry.sourceUrl || config.defaultReportSource || '',
        cls_level: ioc.clsLevel || entry.entityClsLevel || config.defaultClsLevel || '',
        confidence: CONFIDENCE_TO_NUMBER[ioc.confidence] ?? 1,
        first_seen: new Date(ioc.firstSeen).toISOString(),
        ioc_type: ioc.type,
        ioc_subtype: ioc.iocSubtype || '',
        notes: ioc.analystNotes || '',
        related_id: ioc.relatedId || '',             // deprecated field, kept for CSV export compat
        relationship_type: ioc.relationshipType || '', // deprecated field, kept for CSV export compat
        ioc_status: ioc.iocStatus || '',
        tags: tagsStr,
      });
    }
  }

  return result;
}

export function formatIOCsFlatJSON(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}, filter?: IOCExportFilter): string {
  const iocs = buildFlatIOCs(entries, config, filter);
  return JSON.stringify({ iocs }, null, 2);
}

const FLAT_CSV_HEADERS: (keyof FlatIOC)[] = [
  'id', 'actor_name', 'ioc_value', 'report_date', 'report_title', 'report_source',
  'cls_level', 'confidence', 'first_seen', 'ioc_type', 'ioc_subtype', 'notes',
  'related_id', 'relationship_type', 'ioc_status', 'tags',
];

export function formatIOCsFlatCSV(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}, filter?: IOCExportFilter): string {
  const iocs = buildFlatIOCs(entries, config, filter);
  const rows: string[] = [FLAT_CSV_HEADERS.join(',')];

  for (const ioc of iocs) {
    const row = FLAT_CSV_HEADERS.map((h) => escapeCSVField(String(ioc[h])));
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
