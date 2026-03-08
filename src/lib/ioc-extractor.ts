import { nanoid } from 'nanoid';
import type { IOCType, IOCEntry, IOCAnalysis } from '../types';

// Defang patterns — normalize obfuscated indicators back to standard form
export function defang(text: string): string {
  return text
    .replace(/hxxps?/gi, (m) => m.replace(/xx/i, 'tt'))
    .replace(/\[\.\]/g, '.')
    .replace(/\[:\]/g, ':')
    .replace(/\[@\]/g, '@')
    .replace(/\[\/\]/g, '/')
    .replace(/\(dot\)/gi, '.');
}

// Convert a refanged IOC value back to defanged form for safe display
export function refangToDefanged(text: string): string {
  return text
    .replace(/https/gi, 'hxxps')
    .replace(/http/gi, 'hxxp')
    .replace(/:\/\//g, '[://]')
    .replace(/@/g, '[@]')
    .replace(/\./g, '[.]');
}

// Check if a hex string is all the same character (false positive)
function isUniformHex(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.split('').every((c) => c === lower[0]);
}

// Regex patterns for each IOC type, ordered for correct disambiguation
const IOC_PATTERNS: { type: IOCType; pattern: RegExp; validate?: (match: string) => boolean }[] = [
  // Hashes: longest first to disambiguate
  {
    type: 'sha256',
    pattern: /\b[a-fA-F0-9]{64}\b/g,
    validate: (m) => !isUniformHex(m),
  },
  {
    type: 'sha1',
    pattern: /\b[a-fA-F0-9]{40}\b/g,
    validate: (m) => !isUniformHex(m),
  },
  {
    type: 'md5',
    pattern: /\b[a-fA-F0-9]{32}\b/g,
    validate: (m) => !isUniformHex(m),
  },
  // CVE
  {
    type: 'cve',
    pattern: /CVE-\d{4}-\d{4,}/gi,
  },
  // MITRE ATT&CK technique IDs
  {
    type: 'mitre-attack',
    pattern: /(?:^|[\s,;([\]])([TS]\d{4}(?:\.\d{3})?)(?=[\s,;)\].]|$)/gm,
  },
  // URLs (including defanged)
  {
    type: 'url',
    pattern: /https?:\/\/[^\s"'<>)\]]+/gi,
  },
  // Emails
  {
    type: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  // IPv6 (simplified — common compressed/full forms)
  {
    type: 'ipv6',
    pattern: /(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|::(?:[fF]{4}:)?(?:\d{1,3}\.){3}\d{1,3}|fe80:(?::[0-9a-fA-F]{1,4}){0,4}%[0-9a-zA-Z]+|::1)\b/g,
  },
  // IPv4
  {
    type: 'ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    validate: (m) => {
      // Reject common non-IOC IPs like 0.0.0.0, 127.0.0.1, 255.255.255.255
      const ignore = ['0.0.0.0', '127.0.0.1', '255.255.255.255'];
      return !ignore.includes(m);
    },
  },
  // Domain names (after URLs/emails so we can dedup)
  {
    type: 'domain',
    pattern: /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|gov|edu|mil|info|biz|co|us|uk|de|ru|cn|br|in|au|xyz|online|site|top|onion|tk|pw)\b/gi,
  },
  // File paths (Unix, Windows with backslash or forward slash, UNC)
  {
    type: 'file-path',
    pattern: /(?:(?:\/(?:usr|etc|var|tmp|opt|home|root|bin|sbin|dev|proc|sys|mnt|media|srv|run|lib|Library|Users|Applications|Volumes|private)(?:\/[\w.@~:+-]+)+)|(?:[a-zA-Z]:[/\\](?:[\w.@~+-]+[/\\])*[\w.@~+-]+(?:\.\w+)?)|(?:\\\\[\w.-]+\\[\w.$-]+(?:\\[\w.@~+-]+)*))/g,
    validate: (m) => {
      // Must have at least one path separator beyond the root
      const separators = (m.match(/[/\\]/g) || []).length;
      return separators >= 2;
    },
  },
];

/**
 * Extract full YARA rule bodies using brace-depth counting.
 * Handles quoted strings so braces inside strings don't confuse the parser.
 */
export function extractYaraRules(text: string): string[] {
  const results: string[] = [];
  const ruleStart = /\brule\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(:[\s\S]*?)?\{/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = ruleStart.exec(text)) !== null) {
    const begin = startMatch.index;
    // Start counting after the opening brace
    let depth = 1;
    let i = startMatch.index + startMatch[0].length;
    let valid = true;

    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '"') {
        // Skip quoted string (handle escaped quotes)
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i++; // skip escaped char
          i++;
        }
        // i now points at closing quote (or end of text)
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      i++;
    }

    if (depth !== 0) {
      valid = false; // Unbalanced braces — skip
    }

    if (valid) {
      results.push(text.slice(begin, i).trim());
    }
  }

  return results;
}

/**
 * Extract full SIGMA rule YAML blocks.
 * Finds lines starting with `title:`, collects continuation lines until blank line / `---` / EOF,
 * and validates the block contains `detection:` AND (`logsource:` or `condition:`).
 */
export function extractSigmaRules(text: string): string[] {
  const results: string[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*title\s*:/i.test(lines[i])) continue;

    const blockLines: string[] = [lines[i]];
    let j = i + 1;

    // Collect continuation lines
    while (j < lines.length) {
      const line = lines[j];
      // Stop on blank line or YAML document separator
      if (/^\s*$/.test(line) || /^---\s*$/.test(line)) break;
      blockLines.push(line);
      j++;
    }

    const block = blockLines.join('\n');
    const hasDetection = /^\s*detection\s*:/m.test(block);
    const hasLogsourceOrCondition = /^\s*(?:logsource|condition)\s*:/m.test(block);

    if (hasDetection && hasLogsourceOrCondition) {
      results.push(block.trim());
    }
  }

  return results;
}

const MAX_IOC_INPUT_LEN = 5_000_000; // 5 MB max content to scan
const MAX_IOCS_PER_TYPE = 500;
const MAX_TOTAL_IOCS = 5_000;

export interface ExtractIOCsOptions {
  enabledTypes?: string[];           // undefined = all
  defaultConfidence?: string;        // default 'medium'
}

// Simple LRU-ish cache for extraction results keyed by content + options
const EXTRACTION_CACHE_MAX = 8;
const extractionCache: { key: string; result: IOCEntry[] }[] = [];

function makeExtractCacheKey(content: string, options?: ExtractIOCsOptions): string {
  // Use content length + first/last 200 chars + a hash-like fingerprint to keep keys cheap
  const prefix = content.slice(0, 200);
  const suffix = content.slice(-200);
  const optKey = options ? `${options.enabledTypes?.join(',') ?? ''}|${options.defaultConfidence ?? ''}` : '';
  return `${content.length}:${prefix}:${suffix}:${optKey}`;
}

export function extractIOCs(content: string, options?: ExtractIOCsOptions): IOCEntry[] {
  const cacheKey = makeExtractCacheKey(content, options);
  const cached = extractionCache.find((e) => e.key === cacheKey);
  if (cached) return cached.result;
  const result = extractIOCsUncached(content, options);
  extractionCache.push({ key: cacheKey, result });
  if (extractionCache.length > EXTRACTION_CACHE_MAX) extractionCache.shift();
  return result;
}

function extractIOCsUncached(content: string, options?: ExtractIOCsOptions): IOCEntry[] {
  // Truncate very large content to prevent excessive processing
  const normalized = defang(content.length > MAX_IOC_INPUT_LEN ? content.slice(0, MAX_IOC_INPUT_LEN) : content);
  const entries: IOCEntry[] = [];
  const seen = new Set<string>();
  // Track domains/paths found inside URLs and emails for dedup
  const urlDomains = new Set<string>();
  const urlPaths = new Set<string>();
  const emailDomains = new Set<string>();
  const enabledTypesSet = options?.enabledTypes ? new Set(options.enabledTypes) : undefined;
  const confidence = (options?.defaultConfidence ?? 'medium') as IOCEntry['confidence'];

  for (const { type, pattern, validate } of IOC_PATTERNS) {
    // Skip types not in the enabled set
    if (enabledTypesSet && !enabledTypesSet.has(type)) continue;
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let typeCount = 0;

    while ((match = pattern.exec(normalized)) !== null) {
      if (typeCount >= MAX_IOCS_PER_TYPE || entries.length >= MAX_TOTAL_IOCS) break;
      // For MITRE ATT&CK, use capture group 1
      let value = type === 'mitre-attack'
        ? (match[1] || match[0]).trim()
        : match[0].trim();

      // Clean trailing punctuation from URLs
      if (type === 'url') {
        value = value.replace(/[.,;:!?)]+$/, '');
      }

      if (validate && !validate(value)) continue;

      const key = `${type}:${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Track domains and paths from URLs for later dedup
      if (type === 'url') {
        try {
          const parsed = new URL(value);
          urlDomains.add(parsed.hostname.toLowerCase());
          // Track the path portion so file-path extraction doesn't duplicate it
          if (parsed.pathname && parsed.pathname !== '/') {
            urlPaths.add(parsed.pathname.toLowerCase());
          }
        } catch { /* ignore invalid URLs */ }
      }
      if (type === 'email') {
        const domain = value.split('@')[1]?.toLowerCase();
        if (domain) emailDomains.add(domain);
      }

      // Avoid hash substring overlap: sha256 contains sha1-length prefix, sha1 contains md5-length prefix
      if (type === 'md5') {
        if ([...seen].some((k) => (k.startsWith('sha1:') || k.startsWith('sha256:')) && k.includes(value.toLowerCase()))) continue;
      }
      if (type === 'sha1') {
        if ([...seen].some((k) => k.startsWith('sha256:') && k.includes(value.toLowerCase()))) continue;
      }

      entries.push({
        id: nanoid(),
        type,
        value,
        confidence,
        firstSeen: Date.now(),
        dismissed: false,
      });
      typeCount++;
    }
  }

  // Extract full YARA rule bodies
  if (!enabledTypesSet || enabledTypesSet.has('yara-rule')) {
    const yaraRules = extractYaraRules(normalized);
    for (const body of yaraRules) {
      if (entries.length >= MAX_TOTAL_IOCS) break;
      const key = `yara-rule:${body.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: nanoid(),
        type: 'yara-rule',
        value: body,
        confidence,
        firstSeen: Date.now(),
        dismissed: false,
      });
    }
  }

  // Extract full SIGMA rule YAML blocks
  if (!enabledTypesSet || enabledTypesSet.has('sigma-rule')) {
    const sigmaRules = extractSigmaRules(normalized);
    for (const block of sigmaRules) {
      if (entries.length >= MAX_TOTAL_IOCS) break;
      const key = `sigma-rule:${block.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: nanoid(),
        type: 'sigma-rule',
        value: block,
        confidence,
        firstSeen: Date.now(),
        dismissed: false,
      });
    }
  }

  // Dedup: remove domains/file-paths that are already part of extracted URLs or emails
  return entries.filter((entry) => {
    if (entry.type === 'domain') {
      const lower = entry.value.toLowerCase();
      if (urlDomains.has(lower) || emailDomains.has(lower)) return false;
    }
    // Remove file paths that are just the path component of an extracted URL
    if (entry.type === 'file-path') {
      const lower = entry.value.toLowerCase();
      if (urlPaths.has(lower)) return false;
    }
    return true;
  });
}

export function mergeIOCAnalysis(existing: IOCAnalysis | undefined, fresh: IOCEntry[]): IOCAnalysis {
  const now = Date.now();
  if (!existing) {
    return { extractedAt: now, iocs: fresh };
  }

  // Build a map of existing IOCs by type:value for annotation preservation
  const existingMap = new Map<string, IOCEntry>();
  for (const ioc of existing.iocs) {
    existingMap.set(`${ioc.type}:${ioc.value.toLowerCase()}`, ioc);
  }

  const merged: IOCEntry[] = fresh.map((freshIOC) => {
    const key = `${freshIOC.type}:${freshIOC.value.toLowerCase()}`;
    const prev = existingMap.get(key);
    if (prev) {
      // Preserve analyst annotations from existing entry, but reset dismissed
      // so re-analysis restores previously dismissed IOCs
      return {
        ...freshIOC,
        id: prev.id,
        confidence: prev.confidence,
        analystNotes: prev.analystNotes,
        attribution: prev.attribution,
        firstSeen: prev.firstSeen,
        dismissed: false,
      };
    }
    return freshIOC;
  });

  return {
    extractedAt: now,
    iocs: merged,
    analysisSummary: existing.analysisSummary,
    lastPushedAt: existing.lastPushedAt,
  };
}
