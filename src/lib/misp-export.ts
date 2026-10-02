import type { IOCType, ConfidenceLevel } from '../types';
import type { IOCExportEntry, ThreatIntelExportConfig, IOCExportFilter } from './ioc-export';
import { applyExportFilter } from './ioc-export';
import { conservativeClsLevel, resolveIOCClsLevel } from './classification';

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
  Tag: MISPTag[];
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

  // Handling labels belong to attributes; a default is inherited, not event-wide.

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
  const seenValues = new Map<string, MISPAttribute>();

  for (const entry of activeEntries) {
    for (const ioc of entry.iocs) {
      const key = `${ioc.type}::${ioc.value}`;

      const mispType = TC_TO_MISP_TYPE[ioc.type];
      if (!mispType) continue;

      const level = resolveIOCClsLevel(ioc.clsLevel, entry.entityClsLevel, config.defaultClsLevel);
      const attributeTags: MISPTag[] = [{ name: `threatcaddy:confidence="${ioc.confidence}"` }];
      if (level) attributeTags.push({ name: TLP_TAG_MAP[level.toUpperCase()] ?? `threatcaddy:classification=${JSON.stringify(level)}` });
      for (const provenance of ioc.enrichment?.misp ?? []) {
        try {
          const original = JSON.parse(String(provenance.attribute));
          const originalTags = [...(Array.isArray(original.Tag) ? original.Tag : []), ...JSON.parse(String(provenance.eventTags))];
          for (const tag of originalTags) if (typeof tag?.name === 'string' && !tag.name.startsWith('threatcaddy:confidence=')) attributeTags.push({ name: tag.name });
        } catch { throw new Error('Cannot export damaged MISP handling provenance. Restore the original source first.'); }
      }
      const prior = seenValues.get(key);
      if (prior) {
        prior.Tag = [...new Map([...prior.Tag, ...attributeTags].map(tag => [tag.name, tag])).values()];
        // Keep every restriction; consumers selecting a single TLP also see the most restrictive first.
        const strictest = conservativeClsLevel(prior.Tag.filter(tag => tag.name.startsWith('tlp:')).map(tag => tag.name.toUpperCase()));
        if (strictest) prior.Tag.sort((a, b) => Number(b.name === strictest.toLowerCase()) - Number(a.name === strictest.toLowerCase()));
        continue;
      }
      const attribute: MISPAttribute = {
        type: mispType,
        category: getMISPCategory(ioc.type),
        value: ioc.value,
        comment: ioc.analystNotes || '',
        to_ids: CONFIDENCE_TO_IDS_SCORE[ioc.confidence] >= 50,
        timestamp,
        Tag: [...new Map(attributeTags.map(tag => [tag.name, tag])).values()],
      };
      attributes.push(attribute);
      seenValues.set(key, attribute);
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
