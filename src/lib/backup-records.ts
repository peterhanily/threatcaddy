/** Non-mutating validation for portable records. Never truncate a successful backup. */
import { BACKUP_TABLES, type BackupTable } from './backup-tables';
import { validateBackupMedia, validateBackupURL } from './backup-media-validation';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ITEMS = 100_000;
export type PortableRow = Record<string, unknown> & { id: string };
type Check = (value: unknown, path: string) => void;
type Shape = Record<string, Check>;
const invalid = (path: string): never => { throw new Error(`Invalid backup field ${path}; nothing was imported.`); };
const text: Check = (value, path) => { if (typeof value !== 'string') invalid(path); };
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path); };
const boolean: Check = (value, path) => { if (typeof value !== 'boolean') invalid(path); };
const date: Check = (value, path) => { number(value, path); if (Math.abs(value as number) > 8_640_000_000_000_000) invalid(path); };
const oneOf = (...values: (string | number)[]): Check => (value, path) => { if (!values.includes(value as string)) invalid(path); };
export function isBackupObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const array = (check: Check): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_ITEMS) invalid(path);
  (value as unknown[]).forEach((entry, index) => check(entry, `${path}[${index}]`));
};
const strings = array(text);
const dictionary = (check: Check): Check => (value, path) => {
  if (!isBackupObject(value)) invalid(path);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) check(entry, `${path}.${key}`);
};
const object = (shape: Shape, required = ''): Check => (value, path) => {
  if (!isBackupObject(value)) invalid(path);
  const row = value as Record<string, unknown>;
  for (const key of required.split(' ').filter(Boolean)) if (row[key] === undefined) invalid(`${path}.${key}`);
  for (const [key, entry] of Object.entries(row)) {
    if (entry === undefined) continue;
    if (!Object.hasOwn(shape, key)) invalid(`${path}.${key} (unsupported)`);
    shape[key](entry, `${path}.${key}`);
  }
};
function fields(s = '', n = '', b = '', a = '', d = ''): Shape {
  return Object.fromEntries([[s, text], [n, number], [b, boolean], [a, strings], [d, date]]
    .flatMap(([names, check]) => (names as string).split(' ').filter(Boolean).map(name => [name, check as Check])));
}

/** Also bounds nested opaque JSON carried as data, not code or a table selector. */
export function validateBackupJSON(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    if (++count > 2_000_000 || next.depth > 64) throw new Error('Backup exceeds supported structure limits.');
    const item = next.value;
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') { number(item, 'number'); continue; }
    if (!Array.isArray(item) && !isBackupObject(item)) invalid('JSON');
    for (const [key, child] of Object.entries(item as object)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('reserved property');
      pending.push({ value: child, depth: next.depth + 1 });
    }
  }
}
const json: Check = value => validateBackupJSON(value);
const jsonObject: Check = (value, path) => { if (!isBackupObject(value)) invalid(path); validateBackupJSON(value); };
const confidence = oneOf('low', 'medium', 'high', 'confirmed');
const priority = oneOf('none', 'low', 'medium', 'high');
const taskStatus = oneOf('todo', 'in-progress', 'done');
const agentStatus = oneOf('idle', 'running', 'waiting', 'paused', 'error');
const source = oneOf('builtin', 'user', 'team');
const iocType = oneOf('ipv4', 'ipv6', 'domain', 'url', 'email', 'md5', 'sha1', 'sha256', 'file-path', 'cve', 'mitre-attack', 'yara-rule', 'sigma-rule');
const relationship = object(fields('targetIOCId relationshipType'), 'targetIOCId relationshipType');
const comment = object(fields('id text authorId authorName', '', '', '', 'createdAt'), 'id text createdAt');
const entityComment = object(fields('id userId userName content', '', '', '', 'createdAt updatedAt'), 'id content createdAt');
const ioc = object({ ...fields('id value analystNotes attribution iocSubtype iocStatus clsLevel relatedId relationshipType', '', 'dismissed', '', 'firstSeen'),
  type: iocType, confidence, relationships: array(relationship), enrichment: dictionary(array(jsonObject)) }, 'id type value confidence firstSeen dismissed');
const analysis = object({ ...fields('analysisSummary', '', '', '', 'extractedAt lastPushedAt'), iocs: array(ioc) }, 'extractedAt iocs');
const common = fields('id folderId clsLevel createdBy updatedBy', '', 'archived trashed', 'tags', 'createdAt updatedAt trashedAt');
const links = fields('', '', '', 'linkedNoteIds linkedTaskIds linkedTimelineEventIds');
const analyzed = { iocAnalysis: analysis, iocTypes: array(iocType) };
const tokenCounts = object(fields('', 'input output'), 'input output');
const policyFields = fields('model', 'intervalMinutes creativity seriousness verbosity riskTolerance maxMeetingsPerDay maxPendingQuestions',
  'autoApproveReads autoApproveEnrich autoApproveFetch autoApproveCreate autoApproveModify', 'focusAreas');
const policy = object(policyFields, 'autoApproveReads autoApproveEnrich autoApproveFetch autoApproveCreate autoApproveModify intervalMinutes');
const cycleSummary = object({ ...fields('whyThisCycle error provider model', 'durationMs costUSD turns tasksEscalated', '', 'whatIDid', 'startedAt'),
  entitiesTouched: array(object({ ...fields('id label'), type: oneOf('note', 'task', 'ioc', 'timeline', 'folder', 'other') }, 'type')),
  tokens: tokenCounts, toolCalls: object(fields('', 'executed proposed'), 'executed proposed'), toolHistogram: dictionary(number), errorHistogram: dictionary(number),
  outcome: oneOf('success', 'timeout', 'error', 'policyDenied') }, 'startedAt durationMs whyThisCycle whatIDid entitiesTouched tokens costUSD toolCalls toolHistogram errorHistogram turns outcome provider model');
const attachment = object({ ...fields('data mimeType name'), type: oneOf('image') }, 'type data mimeType');
const message = object({ ...fields('id content model userId', '', '', '', 'createdAt'), role: oneOf('user', 'assistant'),
  tokenCount: tokenCounts, attachments: array(attachment), agentCycleSummary: cycleSummary,
  toolCalls: array(object({ ...fields('id name result', '', 'isError'), input: jsonObject }, 'id name input result isError')) }, 'id role content createdAt');
const doc = object({ ...fields('name path sha256 role notes'), type: oneOf('docx', 'pdf', 'markdown', 'json', 'other') }, 'name');
const asset = object({ ...fields('name mimeType data path notes'), role: oneOf('docx-template', 'preview', 'image', 'context', 'other') }, 'name');
const baseline = object({ ...fields('importedFrom', '', '', 'layoutNotes sourceNoteRules requiredFields', 'importedAt'), schemaVersion: oneOf(1),
  kind: oneOf('markdown', 'docx-template'), renderer: oneOf('markdown', 'docx-template'),
  productType: oneOf('analysis-report', 'intel-note', 'executive-brief', 'custom'), visualFidelity: oneOf('placeholder', 'structural', 'word-template'),
  sourceDocuments: array(doc), testFixtures: array(doc), assets: array(asset) }, 'schemaVersion kind productType importedAt renderer visualFidelity');
const metrics = object({ ...fields('', 'cyclesRun toolCallsExecuted toolCallsProposed tasksCompleted tasksRejected costUSD tasksEscalated', '', '', 'lastCycleAt'),
  tokensUsed: tokenCounts, toolCallHistogram: dictionary(number), errorHistogram: dictionary(number), cyclesByOutcome: dictionary(number) },
  'cyclesRun toolCallsExecuted toolCallsProposed tasksCompleted tasksRejected tokensUsed lastCycleAt');
const soul = object({ ...fields('identity', '', '', 'lessons strengths weaknesses', 'updatedAt'),
  lifetimeMetrics: object(fields('', 'investigationsWorked totalCycles totalToolCalls tasksCompleted tasksRejected meetingsAttended performanceScore'),
    'investigationsWorked totalCycles totalToolCalls tasksCompleted tasksRejected meetingsAttended performanceScore') },
  'identity lessons strengths weaknesses lifetimeMetrics updatedAt');

const stepBase = fields('id type label condition', '', 'continueOnError');
const transformOp: Check = (value, path) => {
  if (!isBackupObject(value)) invalid(path);
  const op = (value as Record<string, unknown>).op;
  const commonOp = fields('op path as');
  const variants: Record<string, Shape> = {
    extract: commonOp, map: { ...commonOp, template: dictionary(text) }, filter: { ...commonOp, condition: text },
    flatten: commonOp, join: { ...commonOp, separator: text }, template: { ...fields('op template as') },
    lookup: { ...commonOp, map: dictionary(text), default: text },
  };
  if (typeof op !== 'string' || !Object.hasOwn(variants, op)) invalid(path);
  const required: Record<string, string> = { extract: 'path', map: 'path template', filter: 'path condition', flatten: 'path', join: 'path separator', template: 'template', lookup: 'path map' };
  object(variants[op as string], `op as ${required[op as string]}`)(value, path);
};
const integrationStep: Check = (value, path) => {
  if (!isBackupObject(value)) invalid(path);
  const type = (value as Record<string, unknown>).type;
  const variants: Record<string, Shape> = {
    http: { ...fields('url', 'timeout'), method: oneOf('GET', 'POST', 'PUT', 'PATCH', 'DELETE'), headers: dictionary(text), queryParams: dictionary(text),
      body: json, contentType: oneOf('json', 'form', 'text'), responseType: oneOf('json', 'text'),
      retry: object({ ...fields('', 'maxRetries backoffMs'), retryOn: array(number) }, 'maxRetries retryOn backoffMs'),
      pagination: object({ ...fields('nextExpression resultsPath', 'maxPages'), type: oneOf('offset', 'cursor', 'link-header') }, 'type nextExpression maxPages resultsPath') },
    transform: { input: text, operations: array(transformOp) },
    condition: { expression: text, thenSteps: strings, elseSteps: strings },
    loop: { ...fields('items itemVariable indexVariable', 'maxIterations delayMs', '', 'bodySteps') },
    'create-entity': { entityType: oneOf('ioc', 'note', 'task', 'timeline-event'), fields: jsonObject },
    'update-entity': { entityId: text, entityType: oneOf('ioc', 'note', 'task', 'timeline-event'), fields: jsonObject },
    delay: { ms: number }, 'set-variable': { variables: dictionary(text) },
  };
  if (typeof type !== 'string' || !Object.hasOwn(variants, type)) invalid(path);
  const required: Record<string, string> = {
    http: 'method url', transform: 'input operations', condition: 'expression thenSteps', loop: 'items itemVariable bodySteps',
    'create-entity': 'entityType fields', 'update-entity': 'entityId entityType fields', delay: 'ms', 'set-variable': 'variables',
  };
  object({ ...stepBase, ...variants[type as string] }, `id type label ${required[type as string]}`)(value, path);
};
const serialized = (arrayShape: boolean, byteLimit = MAX_BACKUP_BYTES): Check => (value, path) => {
  text(value, path);
  if (new TextEncoder().encode(value as string).byteLength > byteLimit) invalid(path);
  let decoded: unknown;
  try { decoded = JSON.parse(value as string); } catch { invalid(path); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) !== arrayShape) invalid(path);
  validateBackupJSON(decoded);
};

const RECORDS: Record<BackupTable, Shape> = {
  notes: { ...common, ...links, ...analyzed, ...fields('title content sourceUrl sourceTitle color parentNoteId', '', 'pinned isFolder reviewRequired'), annotations: array(comment) },
  tasks: { ...common, ...links, ...analyzed, ...fields('title description dueDate assigneeId', 'order rejectionCount', 'completed escalated', '', 'completedAt'),
    priority, status: taskStatus, comments: array(comment), checklist: array(object(fields('id text', '', 'done'), 'id text done')),
    rejectionHistory: array(object({ ...fields('byAgentId reason requestedDelta', '', '', '', 'at'), quality: oneOf('needs-redo', 'serious-failure') }, 'at quality reason requestedDelta')) },
  folders: { ...fields('id name icon color description clsLevel papLevel timelineId closedReason agentThreadId createdBy updatedBy', 'order', 'localOnly agentEnabled',
    'tags noteTemplateIds', 'createdAt updatedAt closedAt agentLastRunAt'), status: oneOf('active', 'closed', 'archived'),
    closureResolution: oneOf('resolved', 'false-positive', 'escalated', 'duplicate', 'inconclusive'), agentStatus, agentPolicy: policy,
    playbookExecution: object({ ...fields('templateId templateName', '', '', '', 'startedAt'),
      steps: array(object(fields('completedBy notes', 'stepIndex', 'completed', '', 'completedAt'), 'stepIndex completed')) }, 'templateId templateName startedAt steps') },
  tags: fields('id name color createdBy updatedBy'),
  timelines: fields('id name description color createdBy updatedBy', 'order', '', '', 'createdAt updatedAt'),
  timelineEvents: { ...common, ...links, ...analyzed, ...fields('title description source actor rawData timelineId', 'latitude longitude', 'starred',
    'linkedIOCIds mitreAttackIds assets', 'timestamp timestampEnd'), confidence, comments: array(entityComment),
    eventType: oneOf('initial-access', 'execution', 'persistence', 'privilege-escalation', 'defense-evasion', 'credential-access', 'discovery', 'lateral-movement',
      'collection', 'exfiltration', 'command-and-control', 'impact', 'detection', 'containment', 'eradication', 'recovery', 'communication', 'evidence', 'other') },
  whiteboards: { ...common, ...fields('name', 'order'), elements: serialized(true), appState: serialized(false), files: serialized(false, 8 * 1024 * 1024) },
  standaloneIOCs: { ...common, ...links, ...fields('value analystNotes attribution iocSubtype iocStatus assigneeId assigneeName', '', '', 'linkedEvidenceIds', 'firstSeen lastSeen'),
    type: iocType, confidence, relationships: array(relationship), comments: array(entityComment), enrichment: dictionary(array(jsonObject)) },
  evidenceItems: { ...common, ...fields('title fileName mimeType imageAspectRatio imageData imageDataMimeType imageAnalysis imageOcrText content extractionWarning',
    'size imageWidth imageHeight imagePixelCount chunkIndex chunkCount', '', 'linkedIOCIds', 'lastModified importedAt'),
    fileType: oneOf('pdf', 'docx', 'doc', 'rtf', 'xlsx', 'xls', 'image', 'text', 'spreadsheet', 'unknown'), extractionStatus: oneOf('extracted', 'partial', 'metadata-only') },
  chatThreads: { ...common, ...fields('title model contextSummary parentThreadId', '', 'isFolder'), messages: array(message),
    provider: oneOf('anthropic', 'openai', 'gemini', 'mistral', 'local'), mode: oneOf('plan', 'act'), source: oneOf('user', 'agent', 'agent-meeting', 'caddyshack') },
  noteTemplates: { ...fields('id name description icon content category clsLevel createdBy updatedBy', '', '', 'tags', 'createdAt updatedAt'), source, productBaseline: baseline },
  playbookTemplates: { ...fields('id name description icon investigationType defaultClsLevel defaultPapLevel createdBy updatedBy', '', '', 'defaultTags', 'createdAt updatedAt'), source,
    steps: array(object({ ...fields('title content noteTemplateId phase', 'order', '', 'tags'), entityType: oneOf('note', 'task'), priority, status: taskStatus }, 'order entityType title content')) },
  agentActions: { ...fields('id investigationId threadId agentConfigId toolName toolBinding rationale resultSummary idempotencyKey reviewedBy', '', '', '', 'createdAt executedAt reviewedAt'),
    toolInput: jsonObject, status: oneOf('pending', 'approved', 'rejected', 'executed', 'failed'), severity: oneOf('info', 'warning', 'critical') },
  agentProfiles: { ...fields('id name description icon systemPrompt model source createdBy updatedBy', 'priority', '', 'allowedTools readOnlyEntityTypes', 'createdAt updatedAt'),
    role: oneOf('executive', 'lead', 'specialist', 'observer'), policy, soul },
  agentDeployments: { ...fields('id investigationId profileId supervisorDeploymentId threadId serverBotConfigId', 'order', 'serverSideEnabled', '',
    'lastRunAt lastReconciledAt shiftStartedAt createdAt updatedAt'), status: agentStatus, policyOverrides: object(policyFields), metrics,
    handoffState: oneOf('client', 'handoff-pending', 'server', 'reclaim-pending'), competitiveness: oneOf('cooperative', 'competitive', 'independent'), shift: oneOf('active', 'resting'),
    lastHandoffReconciliation: object({ ...fields('', 'serverActionCount', 'acknowledged', 'serverActionIds', 'at'), toolHistogram: dictionary(number) }, 'at serverActionCount serverActionIds toolHistogram acknowledged') },
  agentMeetings: { ...fields('id investigationId threadId minutesNoteId agenda', 'roundsCompleted maxRounds', '', 'participantDeploymentIds', 'createdAt completedAt'),
    status: oneOf('in-progress', 'completed', 'failed'), purpose: oneOf('redTeamReview', 'dissentSynthesis', 'signOff', 'freeform'),
    participantConfidence: dictionary(number), structuredOutput: jsonObject },
  integrationTemplates: { ...fields('id version name description author license icon color minVersion sourceUrl', '', '', 'tags requiredDomains', 'createdAt updatedAt'),
    schemaVersion: oneOf('1.0'), category: oneOf('enrichment', 'threat-feed', 'siem-soar', 'notification', 'export', 'pipeline', 'utility'), source: oneOf('builtin', 'user', 'team', 'community'),
    triggers: array(object({ ...fields('schedule', '', '', 'entityTables'), type: oneOf('manual', 'on-entity-create', 'on-entity-update', 'scheduled', 'webhook'), iocTypes: array(iocType) }, 'type')),
    configSchema: array(object({ ...fields('key label description placeholder', '', 'required secret'), type: oneOf('string', 'password', 'number', 'boolean', 'select', 'multi-select'),
      default: (value, path) => { if (!['string', 'number', 'boolean'].includes(typeof value)) invalid(path); }, options: array(object(fields('label value'), 'label value')) }, 'key label type required')),
    steps: array(integrationStep), outputs: array(object({ condition: text, template: jsonObject,
      type: oneOf('create-ioc', 'update-ioc', 'create-note', 'create-task', 'create-timeline-event', 'notify', 'post-to-feed', 'display') }, 'type template')),
    rateLimit: object(fields('', 'maxPerHour maxPerDay'), 'maxPerHour maxPerDay') },
  installedIntegrations: { ...fields('id templateId name lastError', 'runCount errorCount', 'enabled', 'scopeFolderIds', 'lastRunAt createdAt updatedAt'),
    scopeType: oneOf('all', 'investigation'), config: jsonObject },
  customSlashCommands: fields('id name description template', '', '', '', 'createdAt updatedAt'),
};

const REQUIRED: Record<BackupTable, string> = {
  notes: 'id title content tags pinned archived trashed createdAt updatedAt',
  tasks: 'id title completed priority tags status order trashed archived createdAt updatedAt',
  folders: 'id name order createdAt', tags: 'id name color',
  timelines: 'id name order createdAt updatedAt',
  timelineEvents: 'id timestamp title eventType source confidence linkedIOCIds linkedNoteIds linkedTaskIds mitreAttackIds assets tags starred timelineId trashed archived createdAt updatedAt',
  whiteboards: 'id name elements tags trashed archived order createdAt updatedAt',
  standaloneIOCs: 'id type value confidence tags trashed archived createdAt updatedAt',
  evidenceItems: 'id title fileName fileType size content extractionStatus importedAt chunkIndex chunkCount tags trashed archived createdAt updatedAt',
  chatThreads: 'id title messages model provider tags trashed archived createdAt updatedAt',
  noteTemplates: 'id name content category source createdAt updatedAt',
  playbookTemplates: 'id name investigationType steps source createdAt updatedAt',
  agentActions: 'id investigationId threadId toolName toolInput rationale status createdAt',
  agentProfiles: 'id name role systemPrompt policy source createdAt updatedAt',
  agentDeployments: 'id investigationId profileId status order createdAt updatedAt',
  agentMeetings: 'id investigationId participantDeploymentIds threadId agenda status roundsCompleted maxRounds createdAt',
  integrationTemplates: 'id schemaVersion version name description author icon color category tags triggers configSchema steps outputs requiredDomains source createdAt updatedAt',
  installedIntegrations: 'id templateId name enabled config scopeType scopeFolderIds runCount errorCount createdAt updatedAt',
  customSlashCommands: 'id name description template createdAt updatedAt',
};

export function validatePortableRow(name: BackupTable, row: unknown, allowLegacyDefaults = false): asserts row is PortableRow {
  const legacyRequired: Partial<Record<BackupTable, string>> = {
    agentProfiles: 'id name', agentDeployments: 'id investigationId profileId', agentMeetings: 'id investigationId',
    integrationTemplates: REQUIRED.integrationTemplates, installedIntegrations: REQUIRED.installedIntegrations,
    customSlashCommands: REQUIRED.customSlashCommands,
  };
  object(RECORDS[name], allowLegacyDefaults ? legacyRequired[name] ?? 'id' : REQUIRED[name])(row, name);
  if (typeof (row as PortableRow).id !== 'string' || !(row as PortableRow).id.trim()) invalid(`${name}.id`);
  if (name === 'tags' && (!(row as PortableRow).name || typeof (row as PortableRow).name !== 'string')) invalid('tags.name');
  validateBackupMedia(name, row as PortableRow);
}

export function validatePortableTables(value: unknown, options: { allowLegacyDefaults?: boolean } = {}): asserts value is Partial<Record<BackupTable, PortableRow[]>> {
  if (!isBackupObject(value)) invalid('data');
  validateBackupJSON(value);
  for (const [name, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name)) invalid(`${name} (unsupported table)`);
    if (!Array.isArray(rows)) invalid(name);
    if ((rows as unknown[]).length > MAX_BACKUP_ITEMS) throw new Error(`Too many items in ${name} (max ${MAX_BACKUP_ITEMS.toLocaleString()} per type)`);
    const ids = new Set<string>();
    for (const row of rows as unknown[]) {
      validatePortableRow(name as BackupTable, row, options.allowLegacyDefaults);
      if (ids.has(row.id)) throw new Error(`Duplicate record ID in ${name}; nothing was imported.`);
      ids.add(row.id);
    }
  }
}

export function assertBackupSize(json: string): void {
  if (json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('Backup file too large (maximum 50 MiB). Keep the original data and split the backup.');
  }
}

export function validateBackupQuickLinks(value: unknown): void {
  array(object(fields('id title url description color icon'), 'id title url'))(value, 'quickLinks');
  const ids = new Set<string>();
  for (const link of value as { id: string; url: string }[]) {
    if (!link.id.trim() || ids.has(link.id)) invalid('quickLinks.id (empty or duplicate)');
    ids.add(link.id);
    validateBackupURL(link.url);
  }
}
