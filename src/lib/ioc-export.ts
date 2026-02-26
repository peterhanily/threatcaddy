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

export function formatIOCsJSON(entries: IOCExportEntry[]): string {
  const active = filterActive(entries);
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

export function formatIOCsCSV(entries: IOCExportEntry[]): string {
  const active = filterActive(entries);
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

function buildFlatIOCs(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}): FlatIOC[] {
  const active = filterActive(entries);
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
        related_id: ioc.relatedId || '',
        relationship_type: ioc.relationshipType || '',
        ioc_status: ioc.iocStatus || '',
        tags: tagsStr,
      });
    }
  }

  return result;
}

export function formatIOCsFlatJSON(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}): string {
  const iocs = buildFlatIOCs(entries, config);
  return JSON.stringify({ iocs }, null, 2);
}

const FLAT_CSV_HEADERS: (keyof FlatIOC)[] = [
  'id', 'actor_name', 'ioc_value', 'report_date', 'report_title', 'report_source',
  'cls_level', 'confidence', 'first_seen', 'ioc_type', 'ioc_subtype', 'notes',
  'related_id', 'relationship_type', 'ioc_status', 'tags',
];

export function formatIOCsFlatCSV(entries: IOCExportEntry[], config: ThreatIntelExportConfig = {}): string {
  const iocs = buildFlatIOCs(entries, config);
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
