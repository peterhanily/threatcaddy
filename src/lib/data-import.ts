import Papa from 'papaparse';
import { nanoid } from 'nanoid';
import { extractIOCs, mergeIOCAnalysis } from './ioc-extractor';
import { createLabelProxy } from './i18n-labels';
import type {
  TimelineEvent,
  TimelineEventType,
  StandaloneIOC,
  Note,
  IOCType,
  ConfidenceLevel,
} from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectedFormat = 'csv' | 'tsv' | 'json-array' | 'ndjson' | 'unknown';

export type ColumnMapping =
  | 'timestamp'
  | 'ioc-ipv4' | 'ioc-domain' | 'ioc-url' | 'ioc-email'
  | 'ioc-md5' | 'ioc-sha1' | 'ioc-sha256' | 'ioc-cve' | 'ioc-file-path'
  | 'event-title' | 'event-description' | 'event-type'
  | 'source' | 'mitre-technique' | 'confidence' | 'actor' | 'asset'
  | 'ignore';

export interface ParseResult {
  format: DetectedFormat;
  headers: string[];
  rows: Record<string, string>[];
  truncated: boolean;
  totalRowCount: number;
  error?: string;
}

export interface ColumnDetection {
  column: string;
  mapping: ColumnMapping;
  confidence: number;
}

export interface ImportActions {
  createTimelineEvents: boolean;
  extractIOCs: boolean;
  createSummaryNote: boolean;
}

export interface ImportResult {
  timelineEventsCreated: number;
  iocsExtracted: number;
  summaryNoteCreated: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 10_000;
export const MAX_INPUT_SIZE = 10_000_000; // 10 MB

// Mapping from ColumnMapping IOC types to IOCType
const COLUMN_TO_IOC_TYPE: Partial<Record<ColumnMapping, IOCType>> = {
  'ioc-ipv4': 'ipv4',
  'ioc-domain': 'domain',
  'ioc-url': 'url',
  'ioc-email': 'email',
  'ioc-md5': 'md5',
  'ioc-sha1': 'sha1',
  'ioc-sha256': 'sha256',
  'ioc-cve': 'cve',
  'ioc-file-path': 'file-path',
};

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';

  // Try JSON array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return 'json-array';
    } catch { /* not valid JSON array */ }
  }

  // Try JSON object (single object — wrap in array for processing)
  if (trimmed.startsWith('{')) {
    // Check for NDJSON: multiple lines, majority starting with {
    const lines = trimmed.split('\n').filter((l) => l.trim());
    if (lines.length > 1) {
      const jsonLineCount = lines.filter((l) => l.trim().startsWith('{')).length;
      if (jsonLineCount / lines.length >= 0.5) {
        // Verify at least first JSON line parses
        try {
          const firstJsonLine = lines.find((l) => l.trim().startsWith('{')) ?? '';
          JSON.parse(firstJsonLine);
          return 'ndjson';
        } catch { /* not NDJSON */ }
      }
    }
    // Single JSON object
    try {
      JSON.parse(trimmed);
      return 'json-array'; // treat single object as array of 1
    } catch { /* not valid JSON */ }
  }

  // Count tabs vs commas in first few lines to distinguish TSV from CSV
  const sampleLines = trimmed.split('\n').slice(0, 5);
  let tabCount = 0;
  let commaCount = 0;
  for (const line of sampleLines) {
    tabCount += (line.match(/\t/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }

  if (tabCount > 0 && tabCount >= commaCount) return 'tsv';
  if (commaCount > 0) return 'csv';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// flattenObject
// ---------------------------------------------------------------------------

export function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[fullKey] = '';
    } else if (Array.isArray(value)) {
      result[fullKey] = value.map((v) => String(v)).join(', ');
    } else if (typeof value === 'object') {
      const nested = flattenObject(value as Record<string, unknown>, fullKey);
      Object.assign(result, nested);
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// parseInput
// ---------------------------------------------------------------------------

export function parseInput(text: string): ParseResult {
  if (text.length > MAX_INPUT_SIZE) {
    return {
      format: 'unknown',
      headers: [],
      rows: [],
      truncated: false,
      totalRowCount: 0,
      error: `Input exceeds maximum size of ${MAX_INPUT_SIZE / 1_000_000} MB`,
    };
  }

  const format = detectFormat(text);

  if (format === 'unknown') {
    return {
      format,
      headers: [],
      rows: [],
      truncated: false,
      totalRowCount: 0,
      error: 'Could not detect data format. Supported: CSV, TSV, JSON array, NDJSON.',
    };
  }

  if (format === 'json-array') {
    return parseJSON(text);
  }

  if (format === 'ndjson') {
    return parseNDJSON(text);
  }

  // CSV or TSV
  return parseDelimited(text, format);
}

function parseJSON(text: string): ParseResult {
  try {
    let parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) {
      parsed = [parsed]; // wrap single object
    }
    if (parsed.length === 0) {
      return { format: 'json-array', headers: [], rows: [], truncated: false, totalRowCount: 0, error: 'JSON array is empty' };
    }

    const totalRowCount = parsed.length;
    const items = parsed.slice(0, MAX_IMPORT_ROWS);
    const rows: Record<string, string>[] = items.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        return flattenObject(item as Record<string, unknown>);
      }
      return { value: String(item) };
    });

    // Collect all unique headers
    const headerSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) headerSet.add(key);
    }
    const headers = Array.from(headerSet);

    return {
      format: 'json-array',
      headers,
      rows,
      truncated: totalRowCount > MAX_IMPORT_ROWS,
      totalRowCount,
    };
  } catch (e) {
    return { format: 'json-array', headers: [], rows: [], truncated: false, totalRowCount: 0, error: `JSON parse error: ${(e as Error).message}` };
  }
}

function parseNDJSON(text: string): ParseResult {
  const lines = text.trim().split('\n').filter((l) => l.trim());
  const totalRowCount = lines.length;
  const errors: string[] = [];
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < Math.min(lines.length, MAX_IMPORT_ROWS); i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj === 'object' && obj !== null) {
        rows.push(flattenObject(obj as Record<string, unknown>));
      } else {
        rows.push({ value: String(obj) });
      }
    } catch {
      errors.push(`Line ${i + 1}: invalid JSON`);
    }
  }

  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);

  return {
    format: 'ndjson',
    headers,
    rows,
    truncated: totalRowCount > MAX_IMPORT_ROWS,
    totalRowCount,
    error: errors.length > 0 ? `${errors.length} ${errors.length === 1 ? 'line' : 'lines'} failed to parse` : undefined,
  };
}

function parseDelimited(text: string, format: 'csv' | 'tsv'): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    delimiter: format === 'tsv' ? '\t' : ',',
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const totalRowCount = result.data.length;
  const rows = result.data.slice(0, MAX_IMPORT_ROWS);
  const headers = result.meta.fields || [];

  return {
    format,
    headers,
    rows,
    truncated: totalRowCount > MAX_IMPORT_ROWS,
    totalRowCount,
    error: result.errors.length > 0 ? `${result.errors.length} parse warnings` : undefined,
  };
}

// ---------------------------------------------------------------------------
// detectSchema — auto-detect column mappings
// ---------------------------------------------------------------------------

const TIMESTAMP_PATTERNS = [
  /^_?time(stamp)?$/i,
  /^@timestamp$/i,
  /^event_?time$/i,
  /^date_?time$/i,
  /^created(_?at)?$/i,
  /^updated(_?at)?$/i,
  /^(start|end)_?time$/i,
  /^when$/i,
  /^ts$/i,
  /^utc_?time$/i,
  /^log_?time$/i,
  /^occurred$/i,
  /^generated$/i,
  /^ingested$/i,
  /^first_?seen$/i,
  /^last_?seen$/i,
  /^detection_?time$/i,
];

const IP_PATTERNS = [
  /^(src|dst|source|dest|destination|remote|local|client|server|attacker|victim)_?(ip|addr|address)$/i,
  /^ip_?(addr|address)?$/i,
  /^(src|dst)$/i,
  /^(SrcAddr|DstAddr|ClientIP|ServerIP|RemoteIP|SourceAddress|DestAddress)$/i,
];

const DOMAIN_PATTERNS = [
  /^(domain|hostname|host|fqdn|dns_?name|query_?name|qname)$/i,
  /^(src|dst|source|dest)_?(domain|hostname|host)$/i,
  /^(ComputerName|DeviceName|MachineName)$/i,
];

const URL_PATTERNS = [
  /^(url|uri|link|request_?url|cs_?uri|http_?url|web_?url|full_?url)$/i,
];

const EMAIL_PATTERNS = [
  /^(email|e_?mail|sender|recipient|from|to)_?(address)?$/i,
  /^(mail_?from|mail_?to|envelope_?from|envelope_?to)$/i,
];

const HASH_MD5_PATTERNS = [/^(md5|hash_?md5|file_?md5|MD5)$/i];
const HASH_SHA1_PATTERNS = [/^(sha1|hash_?sha1|file_?sha1|SHA1)$/i];
const HASH_SHA256_PATTERNS = [/^(sha256|hash_?sha256|file_?sha256|SHA256|filehash)$/i];

const CVE_PATTERNS = [/^(cve|cve_?id|vulnerability|vuln_?id)$/i];

const FILE_PATH_PATTERNS = [
  /^(file_?path|file_?name|image_?path|process_?path|target_?path|parent_?path|executable|binary_?path|ImageFileName|TargetFilename)$/i,
];

const EVENT_TITLE_PATTERNS = [
  /^(title|name|event_?name|alert_?name|rule_?name|signature|detection_?name|message|subject|summary)$/i,
  /^(EventName|RuleName|AlertTitle|SignatureName)$/i,
];

const EVENT_DESCRIPTION_PATTERNS = [
  /^(description|detail|details|body|content|text|comment|notes|reason|explanation|full_?message)$/i,
];

const EVENT_TYPE_PATTERNS = [
  /^(event_?type|type|category|action|activity|event_?category)$/i,
  /^(EventCategory|ActionType)$/i,
];

const SOURCE_PATTERNS = [
  /^(source|log_?source|data_?source|origin|feed|sensor|device_?vendor|product|provider)$/i,
  /^(LogSource|DeviceVendor|DeviceProduct)$/i,
];

const MITRE_PATTERNS = [
  /^(mitre|mitre_?(attack|technique|id)|mitre_?technique_?id|technique_?(id|name)|tactic|attack_?id)$/i,
  /^(MitreTechniqueId|AttackTechnique)$/i,
];

const CONFIDENCE_PATTERNS = [
  /^(confidence|severity|priority|risk|threat_?level|risk_?level|urgency|impact)$/i,
  /^(SeverityLevel|ThreatLevel|RiskScore)$/i,
];

const ACTOR_PATTERNS = [
  /^(actor|threat_?actor|adversary|group|attribution|campaign|apt|user_?name|account|subject)$/i,
];

const ASSET_PATTERNS = [
  /^(asset|device|host_?name|machine|endpoint|target|workstation|computer)$/i,
  /^(DeviceName|Hostname|Endpoint)$/i,
];

interface PatternDef {
  patterns: RegExp[];
  mapping: ColumnMapping;
  confidence: number;
}

const SCHEMA_RULES: PatternDef[] = [
  { patterns: TIMESTAMP_PATTERNS, mapping: 'timestamp', confidence: 0.9 },
  { patterns: IP_PATTERNS, mapping: 'ioc-ipv4', confidence: 0.85 },
  { patterns: DOMAIN_PATTERNS, mapping: 'ioc-domain', confidence: 0.8 },
  { patterns: URL_PATTERNS, mapping: 'ioc-url', confidence: 0.9 },
  { patterns: EMAIL_PATTERNS, mapping: 'ioc-email', confidence: 0.85 },
  { patterns: HASH_MD5_PATTERNS, mapping: 'ioc-md5', confidence: 0.9 },
  { patterns: HASH_SHA1_PATTERNS, mapping: 'ioc-sha1', confidence: 0.9 },
  { patterns: HASH_SHA256_PATTERNS, mapping: 'ioc-sha256', confidence: 0.9 },
  { patterns: CVE_PATTERNS, mapping: 'ioc-cve', confidence: 0.85 },
  { patterns: FILE_PATH_PATTERNS, mapping: 'ioc-file-path', confidence: 0.8 },
  { patterns: EVENT_TITLE_PATTERNS, mapping: 'event-title', confidence: 0.85 },
  { patterns: EVENT_DESCRIPTION_PATTERNS, mapping: 'event-description', confidence: 0.8 },
  { patterns: EVENT_TYPE_PATTERNS, mapping: 'event-type', confidence: 0.75 },
  { patterns: SOURCE_PATTERNS, mapping: 'source', confidence: 0.8 },
  { patterns: MITRE_PATTERNS, mapping: 'mitre-technique', confidence: 0.9 },
  { patterns: CONFIDENCE_PATTERNS, mapping: 'confidence', confidence: 0.8 },
  { patterns: ACTOR_PATTERNS, mapping: 'actor', confidence: 0.75 },
  { patterns: ASSET_PATTERNS, mapping: 'asset', confidence: 0.7 },
];

export function detectSchema(headers: string[]): ColumnDetection[] {
  const detections: ColumnDetection[] = [];
  const usedMappings = new Set<ColumnMapping>();

  for (const header of headers) {
    let bestMatch: { mapping: ColumnMapping; confidence: number } | null = null;

    for (const rule of SCHEMA_RULES) {
      // Skip if this mapping is already taken (except for IOC columns and 'ignore')
      if (usedMappings.has(rule.mapping) && !rule.mapping.startsWith('ioc-')) continue;

      for (const pattern of rule.patterns) {
        if (pattern.test(header)) {
          if (!bestMatch || rule.confidence > bestMatch.confidence) {
            bestMatch = { mapping: rule.mapping, confidence: rule.confidence };
          }
          break;
        }
      }
    }

    if (bestMatch) {
      detections.push({ column: header, mapping: bestMatch.mapping, confidence: bestMatch.confidence });
      usedMappings.add(bestMatch.mapping);
    } else {
      detections.push({ column: header, mapping: 'ignore', confidence: 0 });
    }
  }

  return detections;
}

// ---------------------------------------------------------------------------
// parseTimestamp
// ---------------------------------------------------------------------------

export function parseTimestamp(value: string): number | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  // Try ISO 8601
  const iso = Date.parse(trimmed);
  if (!isNaN(iso)) return iso;

  // Try numeric (unix seconds or ms)
  const num = Number(trimmed);
  if (!isNaN(num) && isFinite(num)) {
    // If it's a reasonable unix timestamp in seconds (after 2000, before 2100)
    if (num > 946684800 && num < 4102444800) return num * 1000;
    // If it's already milliseconds
    if (num > 946684800000 && num < 4102444800000) return num;
  }

  // Common date formats: MM/DD/YYYY HH:MM:SS, DD-Mon-YYYY, etc.
  // Try a few manual patterns
  const mmddyyyy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*(\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (mmddyyyy) {
    const [, m, d, y, time] = mmddyyyy;
    const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}${time ? `T${time}` : 'T00:00:00'}`;
    const ts = Date.parse(dateStr);
    if (!isNaN(ts)) return ts;
  }

  return null;
}

// ---------------------------------------------------------------------------
// mapConfidence
// ---------------------------------------------------------------------------

export function mapConfidence(value: string): ConfidenceLevel {
  const lower = value.toLowerCase().trim();
  if (['critical', 'confirmed', '5', 'very high'].includes(lower)) return 'confirmed';
  if (['high', '4', '3'].includes(lower)) return 'high';
  if (['medium', 'moderate', '2', 'med'].includes(lower)) return 'medium';
  if (['low', '1', 'info', 'informational', '0', 'none'].includes(lower)) return 'low';
  return 'medium';
}

// ---------------------------------------------------------------------------
// mapEventType
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP: Record<string, TimelineEventType> = {
  'initial access': 'initial-access',
  'initial-access': 'initial-access',
  'execution': 'execution',
  'persistence': 'persistence',
  'privilege escalation': 'privilege-escalation',
  'privilege-escalation': 'privilege-escalation',
  'defense evasion': 'defense-evasion',
  'defense-evasion': 'defense-evasion',
  'credential access': 'credential-access',
  'credential-access': 'credential-access',
  'discovery': 'discovery',
  'lateral movement': 'lateral-movement',
  'lateral-movement': 'lateral-movement',
  'collection': 'collection',
  'exfiltration': 'exfiltration',
  'command and control': 'command-and-control',
  'command-and-control': 'command-and-control',
  'c2': 'command-and-control',
  'impact': 'impact',
  'detection': 'detection',
  'containment': 'containment',
  'eradication': 'eradication',
  'recovery': 'recovery',
  'communication': 'communication',
  'evidence': 'evidence',
};

const EVENT_TYPE_SUBSTRINGS: [string, TimelineEventType][] = [
  ['initial', 'initial-access'],
  ['exec', 'execution'],
  ['persist', 'persistence'],
  ['priv', 'privilege-escalation'],
  ['evas', 'defense-evasion'],
  ['cred', 'credential-access'],
  ['discov', 'discovery'],
  ['lateral', 'lateral-movement'],
  ['collect', 'collection'],
  ['exfil', 'exfiltration'],
  ['c2', 'command-and-control'],
  ['c&c', 'command-and-control'],
  ['command', 'command-and-control'],
  ['impact', 'impact'],
  ['detect', 'detection'],
  ['contain', 'containment'],
  ['eradic', 'eradication'],
  ['recov', 'recovery'],
  ['comm', 'communication'],
  ['evid', 'evidence'],
];

export function mapEventType(value: string): TimelineEventType {
  const lower = value.toLowerCase().trim();

  // Exact match
  const exact = EVENT_TYPE_MAP[lower];
  if (exact) return exact;

  // Substring match
  for (const [sub, type] of EVENT_TYPE_SUBSTRINGS) {
    if (lower.includes(sub)) return type;
  }

  return 'other';
}

// ---------------------------------------------------------------------------
// buildTimelineEvents
// ---------------------------------------------------------------------------

export function buildTimelineEvents(
  rows: Record<string, string>[],
  mappings: Map<string, ColumnMapping>,
  timelineId: string,
  folderId?: string,
): { events: TimelineEvent[]; errors: string[] } {
  const events: TimelineEvent[] = [];
  const errors: string[] = [];
  const now = Date.now();

  // Find mapped columns
  const timestampCol = findColumn(mappings, 'timestamp');
  const titleCol = findColumn(mappings, 'event-title');
  const descCol = findColumn(mappings, 'event-description');
  const typeCol = findColumn(mappings, 'event-type');
  const sourceCol = findColumn(mappings, 'source');
  const confidenceCol = findColumn(mappings, 'confidence');
  const mitreCol = findColumn(mappings, 'mitre-technique');
  const actorCol = findColumn(mappings, 'actor');
  const assetCol = findColumn(mappings, 'asset');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Timestamp is required for timeline events
    const tsVal = timestampCol ? row[timestampCol] : '';
    const timestamp = parseTimestamp(tsVal);
    if (timestamp === null) {
      errors.push(`Row ${i + 1}: could not parse timestamp "${tsVal}"`);
      continue;
    }

    const title = titleCol ? row[titleCol] || `Event ${i + 1}` : `Event ${i + 1}`;
    const description = descCol ? row[descCol] || '' : '';
    const eventType = typeCol ? mapEventType(row[typeCol] || '') : 'other';
    const source = sourceCol ? row[sourceCol] || 'data-import' : 'data-import';
    const confidence = confidenceCol ? mapConfidence(row[confidenceCol] || '') : 'medium';
    const mitreIds: string[] = [];
    if (mitreCol && row[mitreCol]) {
      const ids = row[mitreCol].split(/[,;]\s*/).filter(Boolean);
      mitreIds.push(...ids);
    }
    const actor = actorCol ? row[actorCol] || undefined : undefined;
    const assets: string[] = [];
    if (assetCol && row[assetCol]) {
      assets.push(...row[assetCol].split(/[,;]\s*/).filter(Boolean));
    }

    // Build rawData from all row values
    const rawData = JSON.stringify(row);

    // Run IOC extraction on description
    const allText = [description, title].filter(Boolean).join(' ');
    const extractedIOCs = extractIOCs(allText);
    const iocAnalysis = extractedIOCs.length > 0 ? mergeIOCAnalysis(undefined, extractedIOCs) : undefined;
    const iocTypes = iocAnalysis ? [...new Set(iocAnalysis.iocs.map((i) => i.type))] as IOCType[] : undefined;

    const event: TimelineEvent = {
      id: nanoid(),
      timestamp,
      title,
      description,
      eventType,
      source,
      confidence,
      linkedIOCIds: [],
      linkedNoteIds: [],
      linkedTaskIds: [],
      mitreAttackIds: mitreIds,
      actor,
      assets,
      tags: ['data-import'],
      rawData,
      starred: false,
      folderId,
      timelineId,
      iocAnalysis,
      iocTypes,
      trashed: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    events.push(event);
  }

  return { events, errors };
}

// ---------------------------------------------------------------------------
// buildStandaloneIOCs
// ---------------------------------------------------------------------------

export function buildStandaloneIOCs(
  rows: Record<string, string>[],
  mappings: Map<string, ColumnMapping>,
  folderId?: string,
): { iocs: StandaloneIOC[]; errors: string[] } {
  const seen = new Set<string>();
  const iocs: StandaloneIOC[] = [];
  const errors: string[] = [];
  const now = Date.now();

  // Find all IOC-mapped columns
  const iocColumns: { column: string; iocType: IOCType }[] = [];
  for (const [col, mapping] of mappings) {
    const iocType = COLUMN_TO_IOC_TYPE[mapping];
    if (iocType) {
      iocColumns.push({ column: col, iocType });
    }
  }

  const confidenceCol = findColumn(mappings, 'confidence');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const { column, iocType } of iocColumns) {
      const value = row[column]?.trim();
      if (!value) continue;

      const dedupeKey = `${iocType}:${value.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const confidence = confidenceCol ? mapConfidence(row[confidenceCol] || '') : 'medium';

      const ioc: StandaloneIOC = {
        id: nanoid(),
        type: iocType,
        value,
        confidence,
        tags: ['data-import'],
        folderId,
        trashed: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };

      iocs.push(ioc);
    }
  }

  return { iocs, errors };
}

// ---------------------------------------------------------------------------
// buildSummaryNote
// ---------------------------------------------------------------------------

export function buildSummaryNote(
  parseResult: ParseResult,
  mappings: Map<string, ColumnMapping>,
  result: ImportResult,
  folderId?: string,
): Note {
  const now = Date.now();
  const dateStr = new Date(now).toISOString().slice(0, 19).replace('T', ' ');

  // Column mapping table
  const mappingRows = Array.from(mappings.entries())
    .filter(([, m]) => m !== 'ignore')
    .map(([col, m]) => `| ${col} | ${m} |`)
    .join('\n');

  // Sample rows (first 10)
  const sampleRows = parseResult.rows.slice(0, 10);
  const sampleHeaders = parseResult.headers.slice(0, 8); // cap columns for readability
  const headerRow = sampleHeaders.map((h) => h).join(' | ');
  const separatorRow = sampleHeaders.map(() => '---').join(' | ');
  const dataRows = sampleRows
    .map((row) => sampleHeaders.map((h) => (row[h] || '').slice(0, 50)).join(' | '))
    .join('\n');

  const content = `# Data Import Summary

**Imported at:** ${dateStr}
**Format:** ${parseResult.format}
**Total rows:** ${parseResult.totalRowCount}${parseResult.truncated ? ` (truncated to ${MAX_IMPORT_ROWS})` : ''}

## Results

- Timeline events created: **${result.timelineEventsCreated}**
- IOCs extracted: **${result.iocsExtracted}**
- Errors: ${result.errors.length > 0 ? result.errors.length : 'none'}

## Column Mappings

| Column | Mapping |
|--------|---------|
${mappingRows}

## Sample Data (first ${sampleRows.length} rows)

| ${headerRow} |
| ${separatorRow} |
${dataRows ? `| ${dataRows.split('\n').join(' |\n| ')} |` : '*(no data)*'}
${result.errors.length > 0 ? `\n## Errors\n\n${result.errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}${result.errors.length > 20 ? `\n- ... and ${result.errors.length - 20} more` : ''}` : ''}`;

  return {
    id: nanoid(),
    title: `Data Import — ${dateStr}`,
    content,
    folderId,
    tags: ['data-import'],
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findColumn(mappings: Map<string, ColumnMapping>, target: ColumnMapping): string | undefined {
  for (const [col, mapping] of mappings) {
    if (mapping === target) return col;
  }
  return undefined;
}

/** Color for each mapping type, used in the UI badges */
export const MAPPING_COLORS: Record<ColumnMapping, string> = {
  'timestamp': '#f97316',       // orange
  'event-title': '#3b82f6',     // blue
  'event-description': '#3b82f6',
  'event-type': '#3b82f6',
  'source': '#22c55e',          // green
  'mitre-technique': '#14b8a6', // teal
  'confidence': '#22c55e',
  'actor': '#a855f7',           // purple
  'asset': '#a855f7',
  'ioc-ipv4': '#3b82f6',
  'ioc-domain': '#06b6d4',
  'ioc-url': '#8b5cf6',
  'ioc-email': '#ec4899',
  'ioc-md5': '#f97316',
  'ioc-sha1': '#eab308',
  'ioc-sha256': '#ef4444',
  'ioc-cve': '#10b981',
  'ioc-file-path': '#64748b',
  'ignore': '#6b7280',         // gray
};

/** All possible column mapping values for dropdown */
export const ALL_MAPPINGS: ColumnMapping[] = [
  'timestamp',
  'event-title', 'event-description', 'event-type',
  'source', 'mitre-technique', 'confidence', 'actor', 'asset',
  'ioc-ipv4', 'ioc-domain', 'ioc-url', 'ioc-email',
  'ioc-md5', 'ioc-sha1', 'ioc-sha256', 'ioc-cve', 'ioc-file-path',
  'ignore',
];

/** Human-readable labels for column mappings */
export const MAPPING_LABELS: Record<ColumnMapping, string> = createLabelProxy(
  'mapping',
  ALL_MAPPINGS,
);
