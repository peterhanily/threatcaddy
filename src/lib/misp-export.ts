import type { IOCType, ConfidenceLevel } from '../types';
import type { IOCExportEntry, ThreatIntelExportConfig, IOCExportFilter } from './ioc-export';
import { applyExportFilter } from './ioc-export';

// --- IOC type -> MISP attribute type mapping (reverse of misp-import) ---

const TC_TO_MISP_TYPE: Record<IOCType, string> = {
  ipv4: 'ip-dst',
  ipv6: 'ip-dst',
  domain: 'domain',
  url: 'url',
  email: 'email-src',
  md5: 'md5',
  sha1: 'sha1',
  sha256: 'sha256',
  cve: 'vulnerability',
  'mitre-attack': 'text',
  'yara-rule': 'yara',
  'sigma-rule': 'sigma',
  'file-path': 'filename',
};

// --- TLP -> MISP tag mapping ---

const TLP_TAG_MAP: Record<string, string> = {
  'TLP:CLEAR': 'tlp:clear',
  'TLP:GREEN': 'tlp:green',
  'TLP:AMBER': 'tlp:amber',
  'TLP:AMBER+STRICT': 'tlp:amber+strict',
  'TLP:RED': 'tlp:red',
};

// --- Confidence mapping ---

const CONFIDENCE_TO_IDS_SCORE: Record<ConfidenceLevel, number> = {
  low: 25,
  medium: 50,
  high: 75,
  confirmed: 100,
};

// --- MISP Event types ---

interface MISPAttribute {
  type: string;
  category: string;
  value: string;
  comment: string;
  to_ids: boolean;
  timestamp: string;
}

interface MISPTag {
  name: string;
}

interface MISPEvent {
  info: string;
  date: string;
  threat_level_id: string; // 1=high, 2=medium, 3=low, 4=undefined
  analysis: string; // 0=initial, 1=ongoing, 2=completed
  distribution: string; // 0=org only, 1=community, 2=connected, 3=all
  Attribute: MISPAttribute[];
  Tag: MISPTag[];
}

// --- Category mapping ---

function getMISPCategory(type: IOCType): string {
  switch (type) {
    case 'ipv4':
    case 'ipv6':
    case 'domain':
    case 'url':
      return 'Network activity';
    case 'email':
      return 'Payload delivery';
    case 'md5':
    case 'sha1':
    case 'sha256':
    case 'file-path':
      return 'Payload delivery';
    case 'cve':
      return 'External analysis';
    case 'mitre-attack':
      return 'External analysis';
    case 'yara-rule':
    case 'sigma-rule':
      return 'Artifacts dropped';
    default:
      return 'Other';
  }
}

export interface MISPExportConfig extends ThreatIntelExportConfig {
  eventInfo?: string;
  orgName?: string;
  attributionActors?: string[];
}

/**
 * Build a MISP Event JSON from IOC export entries.
 * Returns a JSON string in MISP event format.
 */
export function formatIOCsMISP(
  entries: IOCExportEntry[],
  config: MISPExportConfig = {},
  filter?: IOCExportFilter,
): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timestamp = Math.floor(now.getTime() / 1000).toString();

  // Filter and remove dismissed IOCs
  const activeEntries = applyExportFilter(entries, filter).map((e) => ({
    ...e,
    iocs: e.iocs.filter((ioc) => !ioc.dismissed),
  }));

  const tags: MISPTag[] = [];

  // Add TLP tag from default classification
  if (config.defaultClsLevel) {
    const tlpTag = TLP_TAG_MAP[config.defaultClsLevel.toUpperCase()];
    if (tlpTag) tags.push({ name: tlpTag });
  }

  // Add attribution actor tags
  const actors = new Set<string>();
  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      if (ioc.attribution) actors.add(ioc.attribution);
    }
  }
  if (config.attributionActors) {
    for (const actor of config.attributionActors) actors.add(actor);
  }
  for (const actor of actors) {
    tags.push({ name: `misp-galaxy:threat-actor="${actor}"` });
  }

  // Build attributes
  const attributes: MISPAttribute[] = [];
  const seenValues = new Set<string>();

  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      const key = `${ioc.type}::${ioc.value}`;
      if (seenValues.has(key)) continue;
      seenValues.add(key);

      const mispType = TC_TO_MISP_TYPE[ioc.type];
      if (!mispType) continue;

      // Per-IOC TLP tag (if different from default)
      if (ioc.clsLevel) {
        const iocTlpTag = TLP_TAG_MAP[ioc.clsLevel.toUpperCase()];
        if (iocTlpTag && !tags.some((t) => t.name === iocTlpTag)) {
          tags.push({ name: iocTlpTag });
        }
      }

      attributes.push({
        type: mispType,
        category: getMISPCategory(ioc.type),
        value: ioc.value,
        comment: ioc.analystNotes || '',
        to_ids: CONFIDENCE_TO_IDS_SCORE[ioc.confidence] >= 50,
        timestamp,
      });
    }
  }

  const eventInfo = config.eventInfo
    || activeEntries.map((e) => e.clipTitle).filter(Boolean).join(', ')
    || 'ThreatCaddy IOC Export';

  const event: MISPEvent = {
    info: eventInfo,
    date: dateStr,
    threat_level_id: '2', // medium
    analysis: '1', // ongoing
    distribution: '0', // org only
    Attribute: attributes,
    Tag: tags,
  };

  return JSON.stringify({ Event: event }, null, 2);
}
