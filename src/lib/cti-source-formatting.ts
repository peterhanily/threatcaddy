import type {
  CtiEvidence,
  CtiEvidenceStatus,
  CtiEvidenceValue,
  CtiHostParsedResult,
  CtiSkippedSource,
  CtiSlashCommand,
  CtiSlashSource,
  CtiSourceId,
  CtiSourcePlanItem,
  CtiSourceRunResult,
  CtiSourceTemplate,
  CtiTemplateField,
} from '../types';

export const CTI_VIRUSTOTAL_TOOL = 'host:cti:virustotal_ioc_report';
export const CTI_VIRUSTOTAL_RELATIONSHIP_TOOL = 'host:cti:virustotal_relationship';
export const CTI_VIRUSTOTAL_SEARCH_TOOL = 'host:cti:virustotal_search';
export const CTI_VIRUSTOTAL_BUNDLE_TOOL = 'host:cti:virustotal_ioc_bundle';
export const CTI_VIRUSTOTAL_RELATIONSHIP_BUNDLE_TOOL = 'host:cti:virustotal_relationship_bundle';
export const CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL = 'host:cti:virustotal_search_collection';
export const CTI_VIRUSTOTAL_ANALYST_PACKET_TOOL = 'host:cti:virustotal_analyst_packet';
export const CTI_CENSYS_TOOL = 'host:cti:censys_host';
export const CTI_FLASHPOINT_COMMUNITIES_TOOL = 'host:cti:flashpoint_communities_search';

export const CTI_ACTIVE_SOURCE_IDS = ['virustotal', 'censys', 'flashpoint'] as const;
export const CTI_SOURCE_IDS = ['virustotal', 'censys', 'flashpoint'] as const;
export const CTI_SLASH_COMMANDS = ['/virustotal', '/vt', '/vt-hunt', '/vt-search', '/censys', '/flashpoint', '/cti', '/cti-enrichment', '/all'] as const;

const SOURCE_LABELS: Record<CtiSourceId, string> = {
  virustotal: 'VirusTotal',
  censys: 'Censys',
  flashpoint: 'Flashpoint',
};

const ALLOWLISTED_HOST_TOOLS: Record<CtiSourceId, string> = {
  virustotal: CTI_VIRUSTOTAL_TOOL,
  censys: CTI_CENSYS_TOOL,
  flashpoint: CTI_FLASHPOINT_COMMUNITIES_TOOL,
};

export const DEFAULT_CTI_SOURCE_TEMPLATES: Record<CtiSourceId, CtiSourceTemplate> = {
  virustotal: {
    id: 'cti-template-virustotal-compact-v1',
    source: 'virustotal',
    label: SOURCE_LABELS.virustotal,
    active: true,
    description: 'Compact VirusTotal IOC reputation and classification report.',
    hostTool: CTI_VIRUSTOTAL_TOOL,
    sections: [
      {
        title: 'Evidence',
        fields: [
          { key: 'objectId', label: 'Object', format: 'code', required: true },
          { key: 'objectType', label: 'Type', required: true },
          { key: 'hashes', label: 'Hashes', format: 'list' },
          { key: 'fileProfile', label: 'File profile' },
          { key: 'analysisStats', label: 'Analysis', required: true },
          { key: 'detectionRatio', label: 'Detection ratio' },
          { key: 'packageMode', label: 'Package mode' },
          { key: 'verdictSummary', label: 'Verdict summary' },
          { key: 'itemSummaries', label: 'Result summaries', format: 'list' },
          { key: 'relationshipSummary', label: 'Relationship pivots', format: 'list' },
          { key: 'analystPacket', label: 'Analyst packet', format: 'list' },
          { key: 'submissionTimeline', label: 'Submission timeline' },
          { key: 'reputation', label: 'Reputation' },
          { key: 'ownerContext', label: 'Ownership/context' },
          { key: 'threatLabel', label: 'Threat label' },
          { key: 'threatCategory', label: 'Threat category' },
          { key: 'tags', label: 'Tags', format: 'list' },
          { key: 'threatClassification', label: 'Threat classification', format: 'multiline' },
          { key: 'peExports', label: 'PE exports', format: 'list' },
          { key: 'ipAddresses', label: 'DNS IPs', format: 'list' },
          { key: 'matchingVendorResults', label: 'Matching vendors', format: 'list' },
          { key: 'vendorResults', label: 'Vendor detections', format: 'list' },
        ],
      },
    ],
    caveats: [
      'VirusTotal results are third-party enrichment and should be corroborated with case evidence before creating final findings.',
    ],
  },
  censys: {
    id: 'cti-template-censys-host-v1',
    source: 'censys',
    label: SOURCE_LABELS.censys,
    active: true,
    description: 'Compact Censys host exposure and service context.',
    hostTool: CTI_CENSYS_TOOL,
    sections: [
      {
        title: 'Evidence',
        fields: [
          { key: 'host', label: 'Host', format: 'code', required: true },
          { key: 'apiMode', label: 'API mode' },
          { key: 'servicesCount', label: 'Services observed' },
          { key: 'asContext', label: 'AS context' },
          { key: 'reverseDns', label: 'Reverse DNS', format: 'list' },
          { key: 'serviceSample', label: 'Service sample', format: 'list' },
        ],
      },
    ],
    caveats: [
      'Censys exposure data is observational and may not reflect current reachability or ownership without fresh validation.',
    ],
  },
  flashpoint: {
    id: 'cti-template-flashpoint-communities-v1',
    source: 'flashpoint',
    label: SOURCE_LABELS.flashpoint,
    active: true,
    description: 'Flashpoint Ignite communities search for Telegram/forum source observations.',
    hostTool: CTI_FLASHPOINT_COMMUNITIES_TOOL,
    sections: [
      {
        title: 'Evidence',
        fields: [
          { key: 'queryWindow', label: 'Window', required: true },
          { key: 'returned', label: 'Rows returned', required: true },
          { key: 'sourceContext', label: 'Source context' },
          { key: 'substantivePosts', label: 'Substantive posts', format: 'list' },
          { key: 'emptyRows', label: 'Empty/media rows' },
          { key: 'notableTerms', label: 'Notable terms', format: 'list' },
          { key: 'latestPost', label: 'Latest post', format: 'multiline' },
        ],
      },
    ],
    caveats: [
      'Flashpoint communities results are raw-source observations. Treat actor claims, victim claims, and attribution as unverified until corroborated.',
    ],
  },
};

export function isCtiSourceId(value: unknown): value is CtiSourceId {
  return typeof value === 'string' && (CTI_SOURCE_IDS as readonly string[]).includes(value);
}

export function isActiveCtiSource(value: CtiSourceId): value is (typeof CTI_ACTIVE_SOURCE_IDS)[number] {
  return (CTI_ACTIVE_SOURCE_IDS as readonly string[]).includes(value);
}

export function getCtiSourceLabel(source: CtiSlashSource): string {
  return source === 'all' ? 'All CTI Sources' : SOURCE_LABELS[source];
}

export function isAllowlistedCtiHostTool(toolName: string): boolean {
  return [
    CTI_VIRUSTOTAL_TOOL,
    CTI_VIRUSTOTAL_RELATIONSHIP_TOOL,
    CTI_VIRUSTOTAL_SEARCH_TOOL,
    CTI_VIRUSTOTAL_BUNDLE_TOOL,
    CTI_VIRUSTOTAL_RELATIONSHIP_BUNDLE_TOOL,
    CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL,
    CTI_VIRUSTOTAL_ANALYST_PACKET_TOOL,
    CTI_CENSYS_TOOL,
    CTI_FLASHPOINT_COMMUNITIES_TOOL,
  ].includes(toolName);
}

export function validateCtiTemplate(template: CtiSourceTemplate): string[] {
  const issues: string[] = [];
  if (!template || typeof template !== 'object') return ['Template must be an object.'];
  if (!template.id?.trim()) issues.push('Template id is required.');
  if (!isCtiSourceId(template.source)) issues.push('Template source is not supported.');
  if (!template.label?.trim()) issues.push('Template label is required.');
  if (template.id && template.id.length > 120) issues.push('Template id is too long.');
  if (template.label && template.label.length > 80) issues.push('Template label is too long.');
  if (template.description && template.description.length > 500) issues.push('Template description is too long.');
  if (template.hostTool && !isAllowlistedCtiHostTool(template.hostTool)) {
    issues.push(`Template host tool is not allowlisted: ${template.hostTool}`);
  }
  if (!Array.isArray(template.sections) || template.sections.length === 0) issues.push('At least one template section is required.');
  if (Array.isArray(template.sections) && template.sections.length > 8) issues.push('Template has too many sections.');
  for (const section of Array.isArray(template.sections) ? template.sections : []) {
    if (!section.title?.trim()) issues.push(`Template ${template.id} has a section without a title.`);
    if (section.title && section.title.length > 80) issues.push(`Template section "${section.title}" title is too long.`);
    if (!Array.isArray(section.fields) || section.fields.length === 0) issues.push(`Template section "${section.title}" has no fields.`);
    if (Array.isArray(section.fields) && section.fields.length > 30) issues.push(`Template section "${section.title}" has too many fields.`);
    for (const field of section.fields) {
      if (!field.key?.trim()) issues.push(`Template section "${section.title}" has a field without a key.`);
      if (!field.label?.trim()) issues.push(`Template field "${field.key}" has no label.`);
      if (field.key && !/^[A-Za-z0-9_.-]{1,80}$/.test(field.key)) issues.push(`Template field key is invalid: ${field.key}`);
      if (field.label && field.label.length > 80) issues.push(`Template field "${field.key}" label is too long.`);
      if (field.format && !['text', 'code', 'list', 'multiline'].includes(field.format)) issues.push(`Template field "${field.key}" has an unsupported format.`);
    }
  }
  return issues;
}

export function getCtiTemplate(
  source: CtiSourceId,
  overrides?: Partial<Record<CtiSourceId, CtiSourceTemplate>>,
): CtiSourceTemplate {
  const candidate = overrides?.[source];
  if (candidate && validateCtiTemplate(candidate).length === 0) return candidate;
  return DEFAULT_CTI_SOURCE_TEMPLATES[source];
}

export function parseCtiTemplateJson(value: string): { template?: CtiSourceTemplate; issues: string[] } {
  try {
    const parsed = JSON.parse(value);
    const issues = validateCtiTemplate(parsed as CtiSourceTemplate);
    return issues.length > 0 ? { issues } : { template: parsed as CtiSourceTemplate, issues: [] };
  } catch (err) {
    return { issues: [`Template JSON is invalid: ${(err as Error).message}`] };
  }
}

export function parseCtiTemplatePatchJson(
  value: string,
  currentTemplate: CtiSourceTemplate,
  source: CtiSourceId = currentTemplate.source,
): { template?: CtiSourceTemplate; issues: string[] } {
  let patch: unknown;
  try {
    patch = JSON.parse(value);
  } catch (err) {
    return { issues: [`Template patch JSON is invalid: ${(err as Error).message}`] };
  }

  const record = asRecord(patch);
  if (!record) return { issues: ['Template patch must be a JSON object.'] };

  const allowedKeys = new Set(['label', 'description', 'sections', 'hiddenSections', 'showRawJson', 'caveatMode', 'pivotMode']);
  const forbiddenEvidenceKeys = new Set([
    'id',
    'templateId',
    'version',
    'source',
    'sourceKey',
    'sourceName',
    'active',
    'hostTool',
    'host',
    'tool',
    'toolName',
    'input',
    'observable',
    'status',
    'verdict',
    'fields',
    'sectionsData',
    'highlights',
    'raw',
    'rawJson',
    'caveats',
    'warnings',
    'error',
    'recommendedPivots',
  ]);
  const issues: string[] = [];
  const keys = Object.keys(record);
  if (keys.length === 0) issues.push('Template patch must change at least one display property.');
  for (const key of keys) {
    if (forbiddenEvidenceKeys.has(key)) {
      issues.push(`Template patch cannot change evidence or control field: ${key}`);
    } else if (!allowedKeys.has(key)) {
      issues.push(`Template patch field is not allowed: ${key}`);
    }
  }
  if (record.sections !== undefined) {
    const currentFieldKeys = new Set(currentTemplate.sections.flatMap(section => section.fields.map(field => field.key)));
    const nextSections = asArray(record.sections);
    if (nextSections.length === 0) {
      issues.push('Template patch sections must be a non-empty array when provided.');
    }
    for (const section of nextSections) {
      const sectionRecord = asRecord(section);
      if (!sectionRecord) {
        issues.push('Template patch sections must contain objects.');
        continue;
      }
      for (const field of asArray(sectionRecord.fields)) {
        const fieldRecord = asRecord(field);
        const fieldKey = typeof fieldRecord?.key === 'string' ? fieldRecord.key : '';
        if (fieldKey && !currentFieldKeys.has(fieldKey)) {
          issues.push(`Template patch cannot introduce unnormalized evidence field: ${fieldKey}`);
        }
      }
    }
  }
  if (issues.length > 0) return { issues };

  const nextTemplate: CtiSourceTemplate = {
    ...currentTemplate,
    label: typeof record.label === 'string' ? record.label : currentTemplate.label,
    description: typeof record.description === 'string' ? record.description : currentTemplate.description,
    sections: record.sections !== undefined ? record.sections as CtiSourceTemplate['sections'] : currentTemplate.sections,
    hiddenSections: record.hiddenSections !== undefined ? record.hiddenSections as string[] : currentTemplate.hiddenSections,
    showRawJson: typeof record.showRawJson === 'boolean' ? record.showRawJson : currentTemplate.showRawJson,
    caveatMode: typeof record.caveatMode === 'string' ? record.caveatMode as CtiSourceTemplate['caveatMode'] : currentTemplate.caveatMode,
    pivotMode: typeof record.pivotMode === 'string' ? record.pivotMode as CtiSourceTemplate['pivotMode'] : currentTemplate.pivotMode,
    source,
    active: currentTemplate.active,
  };
  const validation = validateCtiTemplate(nextTemplate);
  return validation.length > 0 ? { issues: validation } : { template: nextTemplate, issues: [] };
}

export function validateCtiTarget(target: string, source: CtiSlashSource): string[] {
  const trimmed = target.trim();
  const issues: string[] = [];
  if (!trimmed) issues.push('A CTI target is required.');
  if (trimmed.length > 2048) issues.push('CTI target is too long.');
  if (source === 'censys' && trimmed && !isIpAddressLike(trimmed)) {
    issues.push('Censys host enrichment currently requires an IP address.');
  }
  return issues;
}

export function flashpointCommunitiesInput(target: string): Record<string, unknown> {
  const parsed = parseFlashpointTarget(target);
  return {
    query: parsed.query,
    author: parsed.author,
    site: parsed.site,
    size: parsed.size,
    page: parsed.page,
    start: parsed.start,
    end: parsed.end,
    dedupe: parsed.dedupe,
  };
}

export function parseCtiSlashCommand(text: string): CtiSlashCommand | null {
  const slashMatch = text.trim().match(/^(\/[a-z0-9_-]+)\s*([\s\S]*)$/i);
  if (!slashMatch) return null;

  const command = slashMatch[1].toLowerCase();
  const rawTarget = slashMatch[2].trim();
  if (!(CTI_SLASH_COMMANDS as readonly string[]).includes(command)) return null;

  if (command === '/virustotal' || command === '/vt' || command === '/vt-hunt' || command === '/vt-search') return { source: 'virustotal', target: rawTarget, command };
  if (command === '/censys') return { source: 'censys', target: rawTarget, command };
  if (command === '/flashpoint') return { source: 'flashpoint', target: rawTarget, command };

  const sourcePrefixed = rawTarget.match(/^(virustotal|vt|censys|flashpoint|all)\s+([\s\S]+)$/i);
  if (sourcePrefixed) {
    const sourceToken = sourcePrefixed[1].toLowerCase();
    const target = sourcePrefixed[2].trim();
    if (sourceToken === 'virustotal' || sourceToken === 'vt') return { source: 'virustotal', target, command };
    if (sourceToken === 'censys') return { source: 'censys', target, command };
    if (sourceToken === 'flashpoint') return { source: 'flashpoint', target, command };
    return { source: 'all', target, command };
  }

  return { source: 'all', target: rawTarget, command };
}

export function isIpAddressLike(value: string): boolean {
  const trimmed = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    return trimmed.split('.').every(part => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return /^[0-9a-f:]+$/i.test(trimmed) && trimmed.includes(':') && trimmed.length >= 3;
}

export function planCtiSourceRequests(
  command: CtiSlashCommand,
  availableToolNames: readonly string[],
): { planned: CtiSourcePlanItem[]; skipped: CtiSkippedSource[]; validationErrors: string[] } {
  const validationErrors = validateCtiTarget(command.target, command.source);
  const available = new Set(availableToolNames.filter(isAllowlistedCtiHostTool));
  const requestedSources = expandRequestedSources(command.source);
  const planned: CtiSourcePlanItem[] = [];
  const skipped: CtiSkippedSource[] = [];

  for (const source of requestedSources) {
    const template = DEFAULT_CTI_SOURCE_TEMPLATES[source];
    if (source === 'flashpoint' && command.source === 'all') {
      skipped.push({
        source,
        sourceLabel: template.label,
        reason: 'Flashpoint: skipped in `/all` because communities search is actor/query-oriented. Use `/flashpoint <actor or query>`.',
      });
      continue;
    }
    if (!template.active) {
      skipped.push({
        source,
        sourceLabel: template.label,
        reason: `${template.label}: deterministic CTI formatting is inactive until the endpoint mapping is verified.`,
        inactive: true,
      });
      continue;
    }

    if (source === 'censys' && !isIpAddressLike(command.target)) {
      skipped.push({
        source,
        sourceLabel: template.label,
        reason: command.source === 'all'
          ? 'Censys: skipped because deterministic Censys host enrichment currently requires an IP address. Use VT resolutions first, then `/censys <ip>`.'
          : 'Censys: deterministic slash commands currently require an IP address for `censys_host`.',
      });
      continue;
    }

    if (source === 'virustotal') {
      const vtPlan = planVirusTotalRequest(command, available, template);
      if (vtPlan.planned.length > 0) planned.push(...vtPlan.planned);
      if (vtPlan.skipped.length > 0) skipped.push(...vtPlan.skipped);
      continue;
    }

    const tool = ALLOWLISTED_HOST_TOOLS[source];
    if (!available.has(tool)) {
      skipped.push({
        source,
        sourceLabel: template.label,
        reason: `${template.label}: \`${tool}\` was not available from the enabled CTI Agent Host.`,
      });
      continue;
    }

    planned.push({
      source,
      sourceLabel: template.label,
      tool,
      input: source === 'censys'
          ? { ip: command.target }
          : flashpointCommunitiesInput(command.target),
      templateId: template.id,
    });
  }

  return { planned, skipped, validationErrors };
}

function planVirusTotalRequest(
  command: CtiSlashCommand,
  available: Set<string>,
  template: CtiSourceTemplate,
): { planned: CtiSourcePlanItem[]; skipped: CtiSkippedSource[] } {
  const planned: CtiSourcePlanItem[] = [];
  const skipped: CtiSkippedSource[] = [];
  const { target, options } = extractKnownCtiOptions(command.target);
  const limit = clampInt(Number(options.limit ?? 10), 1, 100, 10);

  if (command.command === '/vt-search') {
    const tool = available.has(CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL)
      ? CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL
      : available.has(CTI_VIRUSTOTAL_SEARCH_TOOL)
        ? CTI_VIRUSTOTAL_SEARCH_TOOL
        : '';
    if (!tool) {
      skipped.push({
        source: 'virustotal',
        sourceLabel: template.label,
        reason: `${template.label}: neither \`${CTI_VIRUSTOTAL_SEARCH_COLLECTION_TOOL}\` nor \`${CTI_VIRUSTOTAL_SEARCH_TOOL}\` was available from the enabled CTI Agent Host.`,
      });
      return { planned, skipped };
    }
    planned.push({
      source: 'virustotal',
      sourceLabel: template.label,
      tool,
      input: { query: target || command.target, limit, cursor: options.cursor },
      templateId: template.id,
    });
    return { planned, skipped };
  }

  const wantsHunt = command.command === '/vt-hunt' || (options.mode || '').toLowerCase() === 'hunt';
  if (wantsHunt) {
    if (available.has(CTI_VIRUSTOTAL_BUNDLE_TOOL)) {
      planned.push({
        source: 'virustotal',
        sourceLabel: template.label,
        tool: CTI_VIRUSTOTAL_BUNDLE_TOOL,
        input: { ioc: target, relationships: options.relationships, limit },
        templateId: template.id,
      });
      return { planned, skipped };
    }
    skipped.push({
      source: 'virustotal',
      sourceLabel: template.label,
      reason: `${template.label}: \`${CTI_VIRUSTOTAL_BUNDLE_TOOL}\` was unavailable, so relationship pivots were skipped.`,
    });
  }

  if (!available.has(CTI_VIRUSTOTAL_TOOL)) {
    skipped.push({
      source: 'virustotal',
      sourceLabel: template.label,
      reason: `${template.label}: \`${CTI_VIRUSTOTAL_TOOL}\` was not available from the enabled CTI Agent Host.`,
    });
    return { planned, skipped };
  }

  planned.push({
    source: 'virustotal',
    sourceLabel: template.label,
    tool: CTI_VIRUSTOTAL_TOOL,
    input: { ioc: target || command.target },
    templateId: template.id,
  });
  return { planned, skipped };
}

function extractKnownCtiOptions(value: string): { target: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  let target = value;
  const pattern = /(?:^|\s)(mode|relationships|limit|cursor):(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
  for (const match of value.matchAll(pattern)) {
    options[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    target = target.replace(match[0], ' ');
  }
  return { target: target.replace(/\s+/g, ' ').trim(), options };
}

export function parseHostSkillResult(result: string | unknown): CtiHostParsedResult {
  const rawText = typeof result === 'string' ? result : undefined;
  const value = typeof result === 'string' ? parseJsonResult(result) : result;

  if (value === undefined) {
    const trimmed = rawText?.trim() || '';
    return trimmed
      ? { status: 'partial', ok: true, data: trimmed, warnings: ['Agent Host returned non-JSON text.'], rawText }
      : { status: 'error', ok: false, error: 'Agent Host returned an empty response.', warnings: [], rawText };
  }

  const record = asRecord(value);
  if (!record) return { status: 'ok', ok: true, data: value, warnings: [], rawText };

  const error = stringifyError(record.error ?? record.message);
  const status = typeof record.status === 'string' ? record.status.toLowerCase() : undefined;
  const warnings = collectWarnings(record);
  const data = record.data ?? value;
  const hasUsableData = record.result !== undefined || record.data !== undefined || record.results !== undefined || record.items !== undefined;
  const isPartial = record.partial === true || status === 'partial' || warnings.length > 0;
  const isErrorStatus = status === 'error' || status === 'failed' || record.success === false;

  if ((error || isErrorStatus) && !hasUsableData) {
    return { status: 'error', ok: false, data: value, error: error || 'Agent Host reported an error.', warnings, rawText };
  }

  if (error || isErrorStatus || isPartial) {
    return {
      status: 'partial',
      ok: true,
      data,
      error,
      warnings: error ? [...warnings, error] : warnings,
      rawText,
    };
  }

  return { status: 'ok', ok: true, data: value, warnings, rawText };
}

export function normalizeVirusTotalCompactResult(data: unknown, parsedStatus: CtiEvidenceStatus = 'ok'): CtiEvidence {
  const packageRoot = findVirusTotalPackageRoot(data);
  if (packageRoot) return normalizeVirusTotalPackageResult(packageRoot, data, parsedStatus);

  const collection = findVirusTotalCollectionResult(data);
  if (collection) return normalizeVirusTotalCollectionResult(collection.root, collection.result, collection.items, data, parsedStatus);

  return normalizeVirusTotalSingleCompactResult(data, parsedStatus);
}

function normalizeVirusTotalSingleCompactResult(data: unknown, parsedStatus: CtiEvidenceStatus = 'ok'): CtiEvidence {
  const root = asRecord(data);
  const nestedData = asRecord(root?.data);
  const result = asRecord(root?.result ?? nestedData?.result);
  const attributes = asRecord(result?.attributes);
  const warnings: string[] = [];

  if (!root || !result || !attributes) {
    return makeEvidence('virustotal', 'partial', {
      summary: 'VirusTotal returned data, but it was not in the compact report shape.',
    }, data, ['Unexpected VirusTotal response shape.']);
  }

  const analysisStats = formatAnalysisStats(attributes.last_analysis_stats);
  const totalScans = scalarValue(attributes.total_scans);
  const maliciousDetections = scalarValue(attributes.malicious_detections);
  const detectionRatio = scalarValue(attributes.detection_ratio);
  const ownerContext = firstPresent(attributes.as_owner, attributes.registrar, attributes.country);
  const threatClassification = formatThreatClassification(attributes.popular_threat_classification);
  const caveat = stringValue(root.caveat);
  if (!analysisStats) warnings.push('VirusTotal analysis stats were not present.');

  return makeEvidence('virustotal', deriveEvidenceStatus(parsedStatus, warnings), {
    objectId: scalarValue(result.id),
    objectType: scalarValue(result.type),
    hashes: stringArrayValue([attributes.sha256, attributes.sha1, attributes.md5].filter(Boolean)),
    fileProfile: formatFileProfile(attributes.type_description, attributes.size),
    analysisStats: analysisStats || undefined,
    detectionRatio: formatDetectionRatio(maliciousDetections, totalScans, detectionRatio),
    submissionTimeline: formatSubmissionTimeline(attributes.first_submission_iso ?? attributes.first_submission_date, attributes.last_analysis_iso ?? attributes.last_analysis_date),
    reputation: scalarValue(attributes.reputation),
    ownerContext: scalarValue(ownerContext),
    threatLabel: scalarValue(attributes.threat_label),
    threatCategory: scalarValue(attributes.threat_category),
    tags: stringArrayValue(attributes.tags),
    threatClassification,
    peExports: stringArrayValue(attributes.pe_exports),
    ipAddresses: stringArrayValue(attributes.ip_addresses),
    matchingVendorResults: stringArrayValue(attributes.matching_vendor_results),
    vendorResults: formatVendorResults(attributes.vendor_results),
  }, data, warnings, caveat ? [caveat] : []);
}

function normalizeVirusTotalPackageResult(root: Record<string, unknown>, raw: unknown, parsedStatus: CtiEvidenceStatus): CtiEvidence {
  const results = asArray(root.results).map(asRecord).filter((row): row is Record<string, unknown> => !!row);
  const first = results[0];
  const details = asRecord(first?.details);
  const hashes = asRecord(details?.hashes);
  const score = asRecord(first?.score);
  const threat = asRecord(first?.threat);
  const timestamps = asRecord(first?.timestamps);
  const counts = asRecord(root.counts);
  const errors = asArray(root.errors).map(formatVirusTotalError).filter(Boolean);
  const warnings: string[] = [...errors];
  if (results.length === 0) warnings.push('VirusTotal returned no compact results for this request.');

  const caveat = stringValue(root.caveat);
  const mode = stringValue(root.mode) || 'collection';
  const evidence = makeEvidence('virustotal', deriveEvidenceStatus(parsedStatus, warnings), {
    objectId: scalarValue(firstPresent(first?.vt_id, first?.normalized_ioc, first?.ioc, formatVirusTotalQuery(root.query))),
    objectType: scalarValue(firstPresent(first?.vt_type, 'collection')),
    hashes: stringArrayValue([hashes?.sha256, hashes?.sha1, hashes?.md5].filter(Boolean)),
    fileProfile: formatFileProfile(details?.type_description, details?.size),
    analysisStats: formatAnalysisStats(score?.stats),
    detectionRatio: formatDetectionRatio(scalarValue(score?.malicious), scalarValue(score?.total), scalarValue(score?.ratio_pct)),
    packageMode: formatVirusTotalPackageMode(mode, results.length, counts),
    verdictSummary: formatVirusTotalVerdictSummary(counts, results),
    itemSummaries: formatVirusTotalPackageItems(results),
    relationshipSummary: formatVirusTotalRelationshipSummaries(results),
    analystPacket: formatVirusTotalAnalystPacket(root),
    submissionTimeline: formatSubmissionTimeline(timestamps?.first_submission, timestamps?.last_analysis),
    reputation: scalarValue(details?.reputation),
    ownerContext: scalarValue(firstPresent(details?.as_owner, details?.registrar, details?.country)),
    threatLabel: scalarValue(threat?.label),
    threatCategory: scalarValue(asArray(threat?.categories)[0]),
    tags: stringArrayValue(threat?.tags),
    threatClassification: formatThreatClassification(threat?.classification),
    peExports: stringArrayValue(details?.pe_exports),
    ipAddresses: stringArrayValue(details?.dns_ips),
    matchingVendorResults: stringArrayValue(details?.matching_vendor_results),
    vendorResults: formatVendorResults(details?.vendor_results),
  }, raw, warnings, caveat ? [caveat] : []);

  evidence.verdict = formatVirusTotalVerdictSummary(counts, results) || evidence.verdict;
  evidence.recommendedPivots = formatVirusTotalRecommendedPivots(root, results);
  return evidence;
}

function normalizeVirusTotalCollectionResult(
  root: Record<string, unknown>,
  result: Record<string, unknown>,
  items: Record<string, unknown>[],
  raw: unknown,
  parsedStatus: CtiEvidenceStatus,
): CtiEvidence {
  const caveat = stringValue(root.caveat);
  const source = stringValue(root.source) || 'VirusTotal collection';
  const countReturned = scalarValue(result.count_returned ?? items.length);
  const warnings = items.length === 0 ? ['VirusTotal returned an empty collection.'] : [];
  const first = items[0];
  const attrs = asRecord(first?.attributes);

  const evidence = makeEvidence('virustotal', deriveEvidenceStatus(parsedStatus, warnings), {
    objectId: scalarValue(firstPresent(first?.id, source)),
    objectType: scalarValue(firstPresent(first?.type, 'collection')),
    hashes: stringArrayValue([attrs?.sha256, attrs?.sha1, attrs?.md5].filter(Boolean)),
    fileProfile: formatFileProfile(attrs?.type_description, attrs?.size),
    analysisStats: formatAnalysisStats(attrs?.last_analysis_stats),
    detectionRatio: formatDetectionRatio(scalarValue(attrs?.malicious_detections), scalarValue(attrs?.total_scans), scalarValue(attrs?.detection_ratio)),
    packageMode: `${source} (${countReturned ?? items.length} returned)`,
    verdictSummary: formatVirusTotalCollectionVerdicts(items),
    itemSummaries: items.slice(0, 12).map(formatVirusTotalCompactObjectSummary),
    analystPacket: formatVirusTotalPrimitivePagination(root, result),
    submissionTimeline: formatSubmissionTimeline(attrs?.first_submission_iso ?? attrs?.first_submission_date, attrs?.last_analysis_iso ?? attrs?.last_analysis_date),
    reputation: scalarValue(attrs?.reputation),
    ownerContext: scalarValue(firstPresent(attrs?.as_owner, attrs?.registrar, attrs?.country)),
    threatLabel: scalarValue(attrs?.threat_label),
    threatCategory: scalarValue(attrs?.threat_category),
    tags: stringArrayValue(attrs?.tags),
    threatClassification: formatThreatClassification(attrs?.popular_threat_classification),
    peExports: stringArrayValue(attrs?.pe_exports),
    ipAddresses: stringArrayValue(attrs?.ip_addresses),
    matchingVendorResults: stringArrayValue(attrs?.matching_vendor_results),
    vendorResults: formatVendorResults(attrs?.vendor_results),
  }, raw, warnings, caveat ? [caveat] : []);

  evidence.recommendedPivots = [
    'Treat collection rows as candidate pivots; promote only those that match the case timeline, victimology, or infrastructure pattern.',
    'Use Censys to validate exposed services for IP/domain pivots and Flashpoint to corroborate source, actor, victim, or leak claims.',
  ];
  return evidence;
}

function findVirusTotalPackageRoot(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) return null;
  if (root.schema_version === 'vt.compact.v1') return root;
  const nestedData = asRecord(root.data);
  if (nestedData?.schema_version === 'vt.compact.v1') return nestedData;
  const nestedResult = asRecord(root.result);
  if (nestedResult?.schema_version === 'vt.compact.v1') return nestedResult;
  return null;
}

function findVirusTotalCollectionResult(data: unknown): {
  root: Record<string, unknown>;
  result: Record<string, unknown>;
  items: Record<string, unknown>[];
} | null {
  const root = asRecord(data);
  if (!root) return null;
  const nestedData = asRecord(root.data);
  const result = asRecord(root.result ?? nestedData?.result ?? nestedData);
  if (!result) return null;
  const items = asArray(result.items ?? result.results ?? root.items ?? nestedData?.items)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => !!item);
  const looksLikeCollection = result.count_returned !== undefined || result.total !== undefined || items.length > 0;
  if (!looksLikeCollection) return null;
  return { root, result, items };
}

function formatVirusTotalPackageMode(mode: string, resultCount: number, counts: Record<string, unknown> | null): string {
  const errors = Number(counts?.errors ?? 0);
  const suffix = errors > 0 ? `, ${errors} error${errors === 1 ? '' : 's'}` : '';
  return `${mode} (${resultCount} result${resultCount === 1 ? '' : 's'}${suffix})`;
}

function formatVirusTotalVerdictSummary(counts: Record<string, unknown> | null, results: Record<string, unknown>[]): string | undefined {
  const malicious = Number(counts?.malicious ?? results.filter(row => row.verdict === 'malicious').length);
  const suspicious = Number(counts?.suspicious ?? results.filter(row => row.verdict === 'suspicious').length);
  const clean = Number(counts?.clean ?? results.filter(row => row.verdict === 'clean').length);
  const unknown = Number(counts?.unknown ?? results.filter(row => row.verdict === 'unknown').length);
  const errors = Number(counts?.errors ?? 0);
  const parts = [
    `${malicious} malicious`,
    `${suspicious} suspicious`,
    `${clean} clean`,
    `${unknown} unknown`,
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function formatVirusTotalPackageItems(results: Record<string, unknown>[]): string[] | undefined {
  const summaries = results.slice(0, 12).map(formatVirusTotalPackageItemSummary).filter(Boolean);
  return summaries.length > 0 ? summaries : undefined;
}

function formatVirusTotalPackageItemSummary(entry: Record<string, unknown>): string {
  const score = asRecord(entry.score);
  const details = asRecord(entry.details);
  const threat = asRecord(entry.threat);
  const subject = formatPlainValue(firstPresent(entry.normalized_ioc, entry.ioc, entry.vt_id));
  const vtType = stringValue(entry.vt_type) || 'unknown';
  const verdict = stringValue(entry.verdict) || 'unknown';
  const scoreText = formatVirusTotalScore(score);
  const label = stringValue(threat?.label);
  const owner = stringValue(firstPresent(details?.as_owner, details?.registrar, details?.country, details?.meaningful_name));
  return [
    `${subject} [${vtType}]`,
    `verdict=${verdict}`,
    scoreText,
    label ? `label=${label}` : undefined,
    owner ? `context=${owner}` : undefined,
  ].filter(Boolean).join('; ');
}

function formatVirusTotalCompactObjectSummary(item: Record<string, unknown>): string {
  const attrs = asRecord(item.attributes);
  const score = {
    malicious: attrs?.malicious_detections,
    suspicious: asRecord(attrs?.last_analysis_stats)?.suspicious,
    total: attrs?.total_scans,
    ratio_pct: attrs?.detection_ratio,
  };
  const subject = formatPlainValue(item.id);
  const type = stringValue(item.type) || 'unknown';
  const label = stringValue(attrs?.threat_label);
  const owner = stringValue(firstPresent(attrs?.as_owner, attrs?.registrar, attrs?.country, attrs?.meaningful_name));
  return [
    `${subject} [${type}]`,
    formatVirusTotalScore(score),
    label ? `label=${label}` : undefined,
    owner ? `context=${owner}` : undefined,
  ].filter(Boolean).join('; ');
}

function formatVirusTotalCollectionVerdicts(items: Record<string, unknown>[]): string | undefined {
  if (items.length === 0) return undefined;
  let malicious = 0;
  let suspicious = 0;
  let clean = 0;
  let unknown = 0;
  for (const item of items) {
    const attrs = asRecord(item.attributes);
    const stats = asRecord(attrs?.last_analysis_stats);
    const score = {
      malicious: attrs?.malicious_detections ?? stats?.malicious,
      suspicious: stats?.suspicious,
      total: attrs?.total_scans,
    };
    const verdict = deriveVirusTotalVerdict(score);
    if (verdict === 'malicious') malicious++;
    else if (verdict === 'suspicious') suspicious++;
    else if (verdict === 'clean') clean++;
    else unknown++;
  }
  return `${malicious} malicious, ${suspicious} suspicious, ${clean} clean, ${unknown} unknown`;
}

function formatVirusTotalScore(score: Record<string, unknown> | null): string | undefined {
  if (!score) return undefined;
  const malicious = scalarValue(score.malicious);
  const suspicious = scalarValue(score.suspicious);
  const total = scalarValue(score.total);
  const ratio = scalarValue(score.ratio_pct);
  if (malicious === undefined && suspicious === undefined && total === undefined) return undefined;
  const maliciousText = malicious === undefined ? 'n/a' : String(malicious);
  const suspiciousText = suspicious === undefined ? 'n/a' : String(suspicious);
  const totalText = total === undefined ? 'n/a' : String(total);
  const ratioText = ratio === undefined || ratio === null ? 'n/a' : `${ratio}%`;
  return `score=${maliciousText} malicious, ${suspiciousText} suspicious / ${totalText} total (${ratioText})`;
}

function deriveVirusTotalVerdict(score: Record<string, unknown>): 'malicious' | 'suspicious' | 'clean' | 'unknown' {
  const malicious = Number(score.malicious ?? 0);
  const suspicious = Number(score.suspicious ?? 0);
  const total = Number(score.total ?? 0);
  if (malicious >= 5) return 'malicious';
  if (malicious > 0 || suspicious > 0) return 'suspicious';
  if (total > 0) return 'clean';
  return 'unknown';
}

function formatVirusTotalRelationshipSummaries(results: Record<string, unknown>[]): string[] | undefined {
  const lines: string[] = [];
  for (const entry of results.slice(0, 6)) {
    const subject = formatPlainValue(firstPresent(entry.normalized_ioc, entry.ioc, entry.vt_id));
    for (const relationship of asArray(entry.relationships).map(asRecord).filter((row): row is Record<string, unknown> => !!row)) {
      const name = stringValue(relationship.relationship) || 'relationship';
      const items = asArray(relationship.items).map(asRecord).filter((item): item is Record<string, unknown> => !!item);
      const count = scalarValue(relationship.count_returned ?? items.length);
      const sample = items.slice(0, 5).map(formatVirusTotalCompactObjectReference).filter(Boolean);
      lines.push(`${subject} -> ${name}: ${count ?? items.length} returned${sample.length > 0 ? ` (${sample.join(', ')})` : ''}`);
    }
  }
  return lines.length > 0 ? lines.slice(0, 18) : undefined;
}

function formatVirusTotalCompactObjectReference(item: Record<string, unknown>): string {
  const attrs = asRecord(item.attributes);
  const subject = truncateText(formatPlainValue(item.id), 80);
  const type = stringValue(item.type);
  const label = stringValue(attrs?.threat_label);
  return [subject, type ? `[${type}]` : undefined, label ? `label=${label}` : undefined].filter(Boolean).join(' ');
}

function formatVirusTotalAnalystPacket(root: Record<string, unknown>): string[] | undefined {
  const lines: string[] = [];
  const triage = asRecord(root.triage_summary);
  const packet = asRecord(root.analyst_packet);
  const guidance = asArray(triage?.guidance).map(formatPlainValue).filter(Boolean);
  const reviewOrder = asArray(packet?.review_order).map(formatPlainValue).filter(Boolean);
  const required = asArray(packet?.required_assessment_fields).map(formatPlainValue).filter(Boolean);
  const errors = asArray(root.errors).map(formatVirusTotalError).filter(Boolean);
  const pagination = formatVirusTotalPrimitivePagination(root, asRecord(root.pagination) || {});
  if (guidance.length > 0) lines.push(...guidance.slice(0, 4).map(item => `Guidance: ${item}`));
  if (reviewOrder.length > 0) lines.push(`Review order: ${reviewOrder.slice(0, 5).join(' -> ')}`);
  if (required.length > 0) lines.push(`Assessment fields: ${required.slice(0, 10).join(', ')}`);
  if (pagination) lines.push(...pagination);
  if (errors.length > 0) lines.push(...errors.slice(0, 5).map(error => `Error: ${error}`));
  return lines.length > 0 ? lines : undefined;
}

function formatVirusTotalPrimitivePagination(root: Record<string, unknown>, result: Record<string, unknown>): string[] | undefined {
  const lines: string[] = [];
  const meta = asRecord(root.meta ?? result.meta);
  const links = asRecord(root.links ?? result.links);
  const pagination = asRecord(root.pagination);
  const cursor = stringValue(pagination?.cursor ?? meta?.cursor);
  const next = stringValue(pagination?.next ?? links?.next);
  if (cursor) lines.push(`Cursor: ${cursor}`);
  if (next) lines.push(`Next page: ${next}`);
  const total = scalarValue(result.total);
  if (total !== undefined) lines.push(`Total: ${total}`);
  return lines.length > 0 ? lines : undefined;
}

function formatVirusTotalRecommendedPivots(root: Record<string, unknown>, results: Record<string, unknown>[]): string[] {
  const pivots = new Set<string>();
  for (const entry of results) {
    const pivotRecord = asRecord(entry.pivots);
    for (const key of ['promote', 'hold', 'discard']) {
      for (const item of asArray(pivotRecord?.[key]).map(formatPlainValue).filter(Boolean)) {
        pivots.add(`${key}: ${item}`);
      }
    }
    for (const relationship of asArray(entry.relationships).map(asRecord).filter((row): row is Record<string, unknown> => !!row)) {
      const name = stringValue(relationship.relationship);
      const count = scalarValue(relationship.count_returned);
      if (name) pivots.add(`review ${name}${count !== undefined ? ` (${count} returned)` : ''}`);
    }
  }
  const triage = asRecord(root.triage_summary);
  for (const item of asArray(triage?.guidance).map(formatPlainValue).filter(Boolean)) {
    pivots.add(item);
  }
  pivots.add('Use Flashpoint for source/report corroboration and Censys for infrastructure exposure validation.');
  return Array.from(pivots).slice(0, 10);
}

function formatVirusTotalQuery(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return stringValue(value);
  return stringValue(firstPresent(record.ioc, record.query, asArray(record.iocs).join(', ')));
}

function formatVirusTotalError(value: unknown): string {
  const record = asRecord(value);
  if (!record) return formatPlainValue(value);
  const subject = stringValue(firstPresent(record.ioc, record.relationship, record.query));
  const error = stringValue(record.error) || formatPlainValue(record);
  return subject ? `${subject}: ${error}` : error;
}

export function normalizeCensysHostCompactResult(data: unknown, parsedStatus: CtiEvidenceStatus = 'ok'): CtiEvidence {
  const root = asRecord(data);
  const nestedData = asRecord(root?.data);
  const result = asRecord(root?.result ?? nestedData?.result);
  const warnings: string[] = [];

  if (!root || !result) {
    return makeEvidence('censys', 'partial', {
      summary: 'Censys returned data, but it was not in the compact host shape.',
    }, data, ['Unexpected Censys response shape.']);
  }

  const services = asArray(result.services).map(asRecord).filter((v): v is Record<string, unknown> => !!v);
  const autonomousSystem = asRecord(result.autonomous_system);
  const asContext = autonomousSystem
    ? firstPresent(autonomousSystem.name, autonomousSystem.asn, autonomousSystem.description)
    : undefined;
  const serviceSample = services.slice(0, 8).map(service => {
    const port = formatPlainValue(service.port);
    const transport = formatPlainValue(service.transport);
    const serviceName = formatPlainValue(service.service ?? service.extended_service_name);
    const title = formatPlainValue(service.http_title);
    return title
      ? `${port}/${transport} ${serviceName} - ${title}`
      : `${port}/${transport} ${serviceName}`;
  });
  const caveat = stringValue(root.caveat);
  if (services.length === 0) warnings.push('No Censys service sample was present.');

  return makeEvidence('censys', deriveEvidenceStatus(parsedStatus, warnings), {
    host: scalarValue(result.ip),
    apiMode: scalarValue(root.api_mode),
    servicesCount: scalarValue(result.services_count ?? services.length),
    asContext: scalarValue(asContext),
    reverseDns: stringArrayValue(result.reverse_dns),
    serviceSample,
  }, data, warnings, caveat ? [caveat] : []);
}

export function normalizeFlashpointCommunitiesResult(data: unknown, parsedStatus: CtiEvidenceStatus = 'ok'): CtiEvidence {
  const root = asRecord(data);
  const nestedData = asRecord(root?.data);
  const result = asRecord(root?.result ?? nestedData?.result);
  const warnings: string[] = [];

  if (!root || !result) {
    return makeEvidence('flashpoint', 'partial', {
      summary: 'Flashpoint returned data, but it was not in the communities search shape.',
    }, data, ['Unexpected Flashpoint communities response shape.']);
  }

  const items = asArray(result.items).map(asRecord).filter((row): row is Record<string, unknown> => !!row);
  const substantiveItems = items.filter(row => !!stringValue(row.message)?.trim());
  const emptyRows = items.length - substantiveItems.length;
  const latest = [...substantiveItems].sort((a, b) => {
    const aTime = Date.parse(stringValue(a.date) || '');
    const bTime = Date.parse(stringValue(b.date) || '');
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0];
  const total = asRecord(result.total);
  const caveat = stringValue(root.caveat);

  if (items.length === 0) warnings.push('Flashpoint returned zero community rows for this search window.');
  if (items.length > 0 && substantiveItems.length === 0) warnings.push('Flashpoint returned rows, but none included post message text.');

  const sourceContexts = uniqueStrings(items.map(row => {
    const site = stringValue(row.site);
    const author = stringValue(row.author ?? row.title);
    const authorId = stringValue(row.author_id ?? row.title_id);
    const uri = stringValue(row.container_external_uri);
    return [site, authorId ? `${author || 'unknown'} (${authorId})` : author, uri].filter(Boolean).join(' | ');
  }).filter(Boolean));

  const postSummaries = substantiveItems.slice(0, 5).map(formatFlashpointPostSummary);
  const notableTerms = extractFlashpointNotableTerms(substantiveItems);
  const countReturned = scalarValue(result.count_returned ?? items.length);
  const totalText = total ? formatTotal(total) : undefined;

  return makeEvidence('flashpoint', deriveEvidenceStatus(parsedStatus, warnings), {
    queryWindow: formatFlashpointQueryWindow(root),
    returned: totalText ? `${countReturned ?? items.length} returned (${totalText} total)` : `${countReturned ?? items.length}`,
    sourceContext: sourceContexts.slice(0, 3).join('\n') || undefined,
    substantivePosts: postSummaries.length > 0 ? postSummaries : undefined,
    emptyRows: emptyRows > 0 ? emptyRows : undefined,
    notableTerms: notableTerms.length > 0 ? notableTerms : undefined,
    latestPost: latest ? formatFlashpointPostSummary(latest, 700) : undefined,
  }, data, warnings, caveat ? [caveat] : []);
}

export function normalizeGenericCtiResult(source: CtiSourceId, data: unknown, parsedStatus: CtiEvidenceStatus = 'partial'): CtiEvidence {
  const root = asRecord(data);
  const result = root?.result ?? root?.data ?? data;
  const resultRecord = asRecord(result);
  const items = asArray(resultRecord?.items ?? root?.items);
  const caveat = stringValue(root?.caveat);
  return makeEvidence(source, parsedStatus, {
    status: scalarValue(root?.status),
    returned: scalarValue(resultRecord?.count_returned ?? (items.length || undefined)),
    summary: items.length > 0 ? items.slice(0, 5).map(formatPlainValue) : scalarValue(result),
  }, data, [], caveat ? [caveat] : []);
}

export function normalizeCtiSourceRunResult(plan: CtiSourcePlanItem, hostResult: string | unknown): CtiSourceRunResult {
  const parsed = parseHostSkillResult(hostResult);
  let evidence: CtiEvidence;
  if (!parsed.ok) {
    evidence = makeEvidence(plan.source, 'error', {}, parsed.data, parsed.warnings, [], parsed.error || 'Unknown CTI source error.');
  } else if (plan.source === 'virustotal') {
    evidence = normalizeVirusTotalCompactResult(parsed.data, parsed.status);
  } else if (plan.source === 'censys') {
    evidence = normalizeCensysHostCompactResult(parsed.data, parsed.status);
  } else if (plan.source === 'flashpoint') {
    evidence = normalizeFlashpointCommunitiesResult(parsed.data, parsed.status);
  } else {
    evidence = normalizeGenericCtiResult(plan.source, parsed.data, parsed.status);
  }
  if (parsed.error && evidence.status !== 'error') evidence.warnings = [...evidence.warnings, parsed.error];
  evidence.toolName = plan.tool;
  evidence.input = plan.input;
  evidence.observable = evidence.observable || String(firstPresent(plan.input.ioc, plan.input.ip, plan.input.query, plan.input.author) ?? '');
  if (plan.source === 'flashpoint') {
    const queryWindow = formatFlashpointQueryWindow(plan.input);
    evidence.fields.queryWindow = queryWindow;
    evidence.sections.queryWindow = queryWindow;
  }

  return {
    source: plan.source,
    sourceLabel: plan.sourceLabel,
    tool: plan.tool,
    input: plan.input,
    parsed,
    evidence,
  };
}

export function renderCtiEvidenceMarkdown(
  evidence: CtiEvidence,
  template: CtiSourceTemplate = DEFAULT_CTI_SOURCE_TEMPLATES[evidence.source],
): string {
  const lines: string[] = [];

  if (evidence.status === 'error') {
    lines.push(`- Error: ${formatMarkdownValue(evidence.error || 'Unknown error', { format: 'text' })}`);
    return lines.join('\n');
  }

  const hiddenSections = new Set(template.hiddenSections || []);
  for (const section of template.sections) {
    if (hiddenSections.has(section.title)) continue;
    if (template.sections.length > 1) lines.push(`#### ${escapeMarkdownText(section.title)}`);
    for (const field of section.fields) {
      const value = evidence.fields[field.key];
      if (isEmptyEvidenceValue(value)) {
        if (field.required) {
          lines.push(`- ${escapeMarkdownText(field.label)}: ${formatMarkdownValue(field.fallback || 'not returned', field)}`);
        }
        continue;
      }
      lines.push(`- ${escapeMarkdownText(field.label)}: ${formatMarkdownValue(value as CtiEvidenceValue, field)}`);
    }
  }

  const caveats = template.caveatMode === 'hidden' ? [] : [...template.caveats, ...evidence.caveats];
  for (const warning of uniqueStrings(evidence.warnings)) {
    lines.push(`- Warning: ${formatMarkdownValue(warning, { format: 'text' })}`);
  }
  for (const caveat of uniqueStrings(caveats)) {
    lines.push(`- Caveat: ${formatMarkdownValue(caveat, { format: 'text' })}`);
  }
  if (template.pivotMode !== 'hidden' && evidence.recommendedPivots.length > 0) {
    const pivots = template.pivotMode === 'compact'
      ? evidence.recommendedPivots.slice(0, 3)
      : evidence.recommendedPivots;
    lines.push(`- Recommended pivots: ${formatMarkdownValue(pivots, { format: 'list' })}`);
  }
  if (template.showRawJson) {
    lines.push('- Raw compact JSON:');
    lines.push('```json');
    lines.push(JSON.stringify(evidence.raw ?? null, null, 2).slice(0, 12000));
    lines.push('```');
  }

  return lines.join('\n');
}

export function renderCtiRunMarkdown(
  target: string,
  results: readonly CtiSourceRunResult[],
  skipped: readonly CtiSkippedSource[] = [],
  templates?: Partial<Record<CtiSourceId, CtiSourceTemplate>>,
): string {
  const successful = results.filter(r => r.evidence.status === 'ok' || r.evidence.status === 'partial');
  const failed = results.filter(r => r.evidence.status === 'error');
  const lines = [
    `## CTI enrichment: ${formatMarkdownValue(target, { format: 'code' })}`,
    '',
    `Ran ${results.length} allowlisted Agent Host tool${results.length === 1 ? '' : 's'} directly. No LLM interpretation was used for this slash-command result.`,
    '',
  ];

  for (const result of results) {
    lines.push(`### ${escapeMarkdownText(result.sourceLabel)}`);
    lines.push(`Tool: ${formatMarkdownValue(result.tool, { format: 'code' })}`);
    if (result.evidence.status === 'partial') {
      lines.push('Status: partial result');
    }
    lines.push(renderCtiEvidenceMarkdown(result.evidence, getCtiTemplate(result.evidence.source, templates)));
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push('### Skipped');
    for (const item of skipped) lines.push(`- ${escapeMarkdownText(item.reason)}`);
    lines.push('');
  }

  lines.push('### Assessment');
  if (successful.length > 0 && failed.length === 0) {
    lines.push('- The Agent Host returned usable structured data from every requested active source.');
  } else if (successful.length > 0) {
    lines.push('- At least one source returned usable structured data, but one or more sources failed or were unavailable.');
  } else {
    lines.push('- No requested active source returned usable structured data.');
  }
  lines.push('- Confidence should be treated as source-limited until corroborated with case telemetry, passive DNS, sandbox results, or case evidence.');
  lines.push('- Recommended next pivots: check related domains/IPs, compare service exposure against case timelines, and create IOCs only after validating relevance to the investigation.');

  return lines.join('\n');
}

export function escapeMarkdownText(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([*_#[\]()>])/g, '\\$1')
    .replace(/\|/g, '\\|');
}

function expandRequestedSources(source: CtiSlashSource): CtiSourceId[] {
  return source === 'all' ? ['virustotal', 'censys', 'flashpoint'] : [source];
}

function parseJsonResult(result: string): unknown {
  const trimmed = result.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringifyError(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return JSON.stringify(value);
}

function collectWarnings(record: Record<string, unknown>): string[] {
  const rawWarnings = asArray(record.warnings ?? record.warning);
  const warnings = rawWarnings.map(stringValue).filter((v): v is string => !!v);
  const caveats = asArray(record.partial_reasons ?? record.partialReasons).map(stringValue).filter((v): v is string => !!v);
  return [...warnings, ...caveats];
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function scalarValue(value: unknown): CtiEvidenceValue | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function stringArrayValue(value: unknown): string[] | undefined {
  const array = asArray(value);
  if (array.length === 0) return undefined;
  return array.map(formatPlainValue).filter(Boolean);
}

function formatPlainValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'n/a';
  if (Array.isArray(value)) return value.map(formatPlainValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatAnalysisStats(stats: unknown): string | undefined {
  const record = asRecord(stats);
  if (!record) return undefined;
  const malicious = Number(record.malicious || 0);
  const suspicious = Number(record.suspicious || 0);
  const harmless = Number(record.harmless || 0);
  const undetected = Number(record.undetected || 0);
  return `${malicious} malicious, ${suspicious} suspicious, ${harmless} harmless, ${undetected} undetected`;
}

function formatDetectionRatio(malicious: CtiEvidenceValue | undefined, total: CtiEvidenceValue | undefined, ratio: CtiEvidenceValue | undefined): string | undefined {
  if (malicious === undefined && total === undefined && ratio === undefined) return undefined;
  const ratioText = ratio === undefined || ratio === null ? 'n/a' : `${ratio}%`;
  const maliciousText = malicious === undefined || malicious === null ? 'n/a' : String(malicious);
  const totalText = total === undefined || total === null ? 'n/a' : String(total);
  return `${maliciousText}/${totalText} malicious (${ratioText})`;
}

function formatFileProfile(typeDescription: unknown, size: unknown): string | undefined {
  const typeText = stringValue(typeDescription);
  const sizeText = typeof size === 'number' ? `${size} bytes` : stringValue(size);
  const parts = [typeText, sizeText].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function formatSubmissionTimeline(firstSubmission: unknown, lastAnalysis: unknown): string | undefined {
  const first = formatDateLike(firstSubmission);
  const last = formatDateLike(lastAnalysis);
  if (!first && !last) return undefined;
  return [`first submission: ${first || 'n/a'}`, `last analysis: ${last || 'n/a'}`].join('; ');
}

function formatDateLike(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return String(value);
}

function formatVendorResults(value: unknown): string[] | undefined {
  const rows = asArray(value).map(asRecord).filter((row): row is Record<string, unknown> => !!row);
  if (rows.length === 0) return undefined;
  return rows.map(row => {
    const vendor = formatPlainValue(row.vendor ?? row.engine_name);
    const category = formatPlainValue(row.category);
    const verdict = formatPlainValue(row.result);
    return verdict === 'n/a' ? `${vendor}: ${category}` : `${vendor}: ${category} (${verdict})`;
  });
}

function formatThreatClassification(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return scalarValue(value) as string | undefined;
  const suggested = record.suggested_threat_label ?? record.suggestedThreatLabel;
  const popular = asArray(record.popular_threat_category ?? record.popularThreatCategory)
    .map(item => {
      const itemRecord = asRecord(item);
      return itemRecord ? firstPresent(itemRecord.value, itemRecord.label) : item;
    })
    .map(formatPlainValue)
    .filter(Boolean);
  const parts = [stringValue(suggested), popular.length > 0 ? `Categories: ${popular.join(', ')}` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : JSON.stringify(record);
}

function parseFlashpointTarget(target: string): {
  query: string;
  author: string;
  site: string;
  size: number;
  page: number;
  start: string;
  end: string;
  dedupe: boolean;
} {
  const options = extractKeyValueOptions(target);
  const rawRemainder = options.__remainder?.trim() || target.trim();
  const explicitQuery = options.query ?? options.q;
  const explicitAuthor = options.author;
  const mode = (options.mode || options.search || '').toLowerCase();
  const query = explicitQuery ?? (mode === 'query' ? rawRemainder : '');
  const author = explicitAuthor ?? (query ? '' : rawRemainder);
  const size = clampInt(Number(options.size ?? options.limit ?? 25), 1, 100, 25);
  const page = clampInt(Number(options.page ?? 0), 0, 1000, 0);
  return {
    query,
    author,
    site: options.site || 'Telegram',
    size,
    page,
    start: options.since || options.start || 'now-48h',
    end: options.until || options.end || 'now',
    dedupe: parseBooleanOption(options.dedupe, false),
  };
}

function extractKeyValueOptions(target: string): Record<string, string> {
  const options: Record<string, string> = {};
  let remainder = target;
  const pattern = /\b([a-zA-Z][a-zA-Z0-9_-]{1,24}):(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of target.matchAll(pattern)) {
    options[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    remainder = remainder.replace(match[0], ' ');
  }
  options.__remainder = remainder.replace(/\s+/g, ' ').trim();
  return options;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseBooleanOption(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
}

function formatFlashpointQueryWindow(root: Record<string, unknown>): string {
  const params = asRecord(root.parameters ?? root.input ?? root.request) ?? root;
  const start = stringValue(params?.start) || stringValue(params?.include_start) || 'not returned';
  const end = stringValue(params?.end) || stringValue(params?.include_end) || 'not returned';
  const author = stringValue(params?.author);
  const query = stringValue(params?.query);
  const site = stringValue(params?.site);
  const filter = author ? `author=${author}` : query ? `query=${query}` : 'query not returned';
  return [filter, site ? `site=${site}` : undefined, `${start} to ${end}`].filter(Boolean).join('; ');
}

function formatTotal(total: Record<string, unknown>): string {
  const value = scalarValue(total.value);
  const relation = stringValue(total.relation);
  return relation && value !== undefined ? `${relation}${value}` : formatPlainValue(total);
}

function formatFlashpointPostSummary(row: Record<string, unknown>, maxMessageLength = 360): string {
  const date = stringValue(row.date) || 'no date';
  const author = stringValue(row.author ?? row.title) || 'unknown author';
  const authorId = stringValue(row.author_id ?? row.title_id);
  const id = stringValue(row.id);
  const uri = stringValue(row.container_external_uri);
  const message = truncateText(stringValue(row.message) || '', maxMessageLength);
  const identity = authorId ? `${author} (${authorId})` : author;
  return [
    `${date} - ${identity}`,
    id ? `id=${id}` : undefined,
    uri,
    message,
  ].filter(Boolean).join('\n');
}

function extractFlashpointNotableTerms(rows: Record<string, unknown>[]): string[] {
  const text = rows.map(row => stringValue(row.message) || '').join('\n');
  const terms = new Set<string>();
  const keywordMatches = text.match(/\b(?:cloud|database|platform|software|documents?|leak(?:ed)?|breach(?:ed)?|customer(?:s)?)\b/gi) || [];
  for (const match of keywordMatches) terms.add(match);
  const counts = text.match(/\b\d{1,3}(?:,\d{3})+\b/g) || [];
  for (const match of counts) terms.add(match);
  const handles = text.match(/@[A-Za-z0-9_]{3,}/g) || [];
  for (const match of handles) terms.add(match);
  const urls = text.match(/\bhttps?:\/\/[^\s<>"']+/gi) || [];
  for (const match of urls) terms.add(match);
  return uniqueStrings(Array.from(terms)).slice(0, 12);
}

function truncateText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function deriveEvidenceStatus(parsedStatus: CtiEvidenceStatus, warnings: string[]): CtiEvidenceStatus {
  if (parsedStatus === 'error') return 'error';
  if (parsedStatus === 'partial' || warnings.length > 0) return 'partial';
  return 'ok';
}

function makeEvidence(
  source: CtiSourceId,
  status: CtiEvidenceStatus,
  fields: Record<string, CtiEvidenceValue | undefined>,
  raw?: unknown,
  warnings: string[] = [],
  caveats: string[] = [],
  error?: string,
): CtiEvidence {
  const observable = scalarValue(fields.objectId ?? fields.host ?? fields.summary);
  const highlights = Object.entries(fields)
    .filter(([, value]) => !isEmptyEvidenceValue(value))
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${formatPlainValue(value)}`);
  return {
    source,
    sourceLabel: SOURCE_LABELS[source],
    sourceKey: source,
    sourceName: SOURCE_LABELS[source],
    observable: typeof observable === 'string' ? observable : observable === undefined ? undefined : String(observable),
    status,
    verdict: status === 'ok' ? 'usable' : status,
    highlights,
    sections: fields,
    fields,
    caveats,
    recommendedPivots: defaultRecommendedPivots(source),
    warnings,
    raw,
    error,
  };
}

function defaultRecommendedPivots(source: CtiSourceId): string[] {
  if (source === 'virustotal') {
    return ['Review related resolutions, communicating files, and passive DNS before linking this IOC to an investigation.'];
  }
  if (source === 'censys') {
    return ['Validate current service exposure, certificate reuse, and AS ownership before treating this host as related infrastructure.'];
  }
  return ['Corroborate actor and victim claims, then pivot on author IDs, Telegram handles, mentioned brands, URLs, files, and document counts.'];
}

function isEmptyEvidenceValue(value: CtiEvidenceValue | undefined): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function formatMarkdownValue(value: CtiEvidenceValue | string, field: Pick<CtiTemplateField, 'format'>): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    if (field.format === 'list') {
      return value.map(item => `\n  - ${formatMarkdownValue(item, { format: 'text' })}`).join('');
    }
    return value.map(item => formatMarkdownValue(item, { format: field.format })).join(', ');
  }
  const text = String(value ?? 'n/a');
  if (field.format === 'code') {
    // Backslashes do not escape backticks inside a CommonMark code span.
    // A longer delimiter keeps vendor text (including links/HTML) literal.
    let longestRun = 0;
    for (const match of text.matchAll(/`+/g)) longestRun = Math.max(longestRun, match[0].length);
    const delimiter = '`'.repeat(longestRun + 1);
    const padding = text.startsWith('`') || text.endsWith('`') || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
    return `${delimiter}${padding}${text}${padding}${delimiter}`;
  }
  if (field.format === 'multiline') {
    return text.split(/\r?\n/).map(part => escapeMarkdownText(part)).join('<br>');
  }
  return escapeMarkdownText(text);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
