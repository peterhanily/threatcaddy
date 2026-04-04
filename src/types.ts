/** An investigation note with markdown content, tags, and optional IOC analysis. */
export interface Note {
  id: string;
  title: string;
  content: string;
  folderId?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  color?: string;
  clsLevel?: string;
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  linkedNoteIds?: string[];
  linkedTaskIds?: string[];
  linkedTimelineEventIds?: string[];
  annotations?: NoteAnnotation[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IOCTarget {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  clsLevel?: string;
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
}

export interface TaskComment {
  id: string;
  text: string;
  authorId?: string;
  authorName?: string;
  createdAt: number;
}

export interface NoteAnnotation {
  id: string;
  text: string;
  authorId?: string;
  authorName?: string;
  createdAt: number;
}

export interface EntityComment {
  id: string;
  userId?: string;
  userName?: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
}

/** Task priority level, from none (unset) to high. */
export type Priority = 'none' | 'low' | 'medium' | 'high';
/** Kanban-style task status. */
export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** An actionable task within an investigation, with status tracking and kanban support. */
export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  dueDate?: string;
  folderId?: string;
  tags: string[];
  status: TaskStatus;
  order: number;
  clsLevel?: string;
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  comments?: TaskComment[];
  checklist?: ChecklistItem[];
  linkedNoteIds?: string[];
  linkedTaskIds?: string[];
  linkedTimelineEventIds?: string[];
  trashed: boolean;
  trashedAt?: number;
  archived: boolean;
  assigneeId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type InvestigationStatus = 'active' | 'closed' | 'archived';

export type ClosureResolution = 'resolved' | 'false-positive' | 'escalated' | 'duplicate' | 'inconclusive';

export const CLOSURE_RESOLUTION_LABELS: Record<ClosureResolution, string> = {
  'resolved': 'Resolved',
  'false-positive': 'False Positive',
  'escalated': 'Escalated',
  'duplicate': 'Duplicate',
  'inconclusive': 'Inconclusive',
};

export interface PlaybookExecutionStep {
  stepIndex: number;
  completed: boolean;
  completedAt?: number;
  completedBy?: string;
  notes?: string;
}

export interface PlaybookExecution {
  templateId: string;
  templateName: string;
  startedAt: number;
  steps: PlaybookExecutionStep[];
}

/** An investigation folder that groups notes, tasks, IOCs, timelines, and whiteboards. */
export interface Folder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  order: number;
  createdAt: number;
  description?: string;
  status?: InvestigationStatus;
  clsLevel?: string;
  papLevel?: string;
  updatedAt?: number;
  tags?: string[];
  timelineId?: string;
  closureResolution?: ClosureResolution;
  closedReason?: string;
  closedAt?: number;
  createdBy?: string;
  updatedBy?: string;
  localOnly?: boolean;
  playbookExecution?: PlaybookExecution;
  /** CaddyAgent: is the agent enabled for this investigation? */
  agentEnabled?: boolean;
  /** CaddyAgent: per-investigation policy overrides */
  agentPolicy?: AgentPolicy;
  /** CaddyAgent: ID of the agent's audit trail chat thread */
  agentThreadId?: string;
  /** CaddyAgent: last time the agent ran a cycle */
  agentLastRunAt?: number;
  /** CaddyAgent: current runtime status */
  agentStatus?: AgentStatus;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdBy?: string;
  updatedBy?: string;
}

export type CloudProvider = 'oci' | 'aws-s3' | 'azure-blob' | 'gcs';

export interface BackupDestination {
  id: string;
  provider: CloudProvider;
  label: string;
  url: string;
  enabled: boolean;
}

/** Top-level view/page the user can navigate to. */
export type ViewMode = 'dashboard' | 'notes' | 'tasks' | 'timeline' | 'whiteboard' | 'activity' | 'graph' | 'ioc-stats' | 'chat' | 'caddyshack' | 'agent' | 'investigations';
export type EditorMode = 'edit' | 'preview' | 'split';
export type TaskViewMode = 'list' | 'kanban';

/** A user-configurable bookmark shown in the dashboard quick-links section. */
export interface QuickLink {
  id: string;
  title: string;
  url: string;
  description?: string;
  color?: string;
  icon?: string;
}

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { id: 'ql-1', title: 'VirusTotal',      url: 'https://www.virustotal.com',     description: 'File & URL analyzer',         color: '#3b82f6', icon: '\uD83D\uDD0D' },
  { id: 'ql-2', title: 'MITRE ATT&CK',    url: 'https://attack.mitre.org',       description: 'Adversary tactics & techniques', color: '#ef4444', icon: '\u2694\uFE0F' },
  { id: 'ql-3', title: 'Shodan',           url: 'https://www.shodan.io',          description: 'Internet-connected device search', color: '#10b981', icon: '\uD83C\uDF10' },
  { id: 'ql-4', title: 'AbuseIPDB',        url: 'https://www.abuseipdb.com',      description: 'IP address abuse reports',     color: '#f97316', icon: '\uD83D\uDEE1\uFE0F' },
  { id: 'ql-5', title: 'AlienVault OTX',   url: 'https://otx.alienvault.com',     description: 'Open threat exchange',        color: '#8b5cf6', icon: '\uD83D\uDC7E' },
  { id: 'ql-6', title: 'CVE Database',     url: 'https://www.cve.org',            description: 'Common vulnerabilities',      color: '#eab308', icon: '\uD83D\uDCCB' },
  { id: 'ql-7', title: 'URLhaus',          url: 'https://urlhaus.abuse.ch',       description: 'Malicious URL tracker',       color: '#ec4899', icon: '\uD83D\uDD17' },
  { id: 'ql-8', title: 'MalwareBazaar',    url: 'https://bazaar.abuse.ch',        description: 'Malware sample sharing',      color: '#06b6d4', icon: '\u2623\uFE0F' },
  { id: 'ql-9', title: 'Forensicate.ai',   url: 'https://forensicate.ai',         description: 'AI-powered forensic analysis', color: '#6366f1', icon: '\uD83E\uDDE0' },
  { id: 'ql-10', title: 'OpenSlaw.ai',    url: 'https://openslaw.ai',            description: 'Parody site \u2014 homage to OpenClaw by the ThreatCaddy creator', color: '#f43f5e', icon: '\uD83E\uDD9E' },
];

export interface Settings {
  theme: 'dark' | 'light';
  defaultView: ViewMode;
  editorMode: EditorMode;
  sidebarCollapsed: boolean;
  taskViewMode: TaskViewMode;
  tourCompleted?: boolean;
  ociWritePAR?: string;
  ociLabel?: string;
  attributionActors?: string[];
  tiDefaultClsLevel?: string;
  tiDefaultReportSource?: string;
  tiClsLevels?: string[];
  tiIocSubtypes?: Record<string, string[]>;
  tiRelationshipTypes?: Record<string, IOCRelationshipDef>;
  tiIocStatuses?: string[];
  backupDestinations?: BackupDestination[];
  quickLinks?: QuickLink[];
  llmAnthropicApiKey?: string;
  llmOpenAIApiKey?: string;
  llmGeminiApiKey?: string;
  llmMistralApiKey?: string;
  llmLocalEndpoint?: string;
  llmLocalApiKey?: string;
  llmLocalModelName?: string;
  llmDefaultModel?: string;
  llmDefaultProvider?: LLMProvider;
  llmSystemPrompt?: string;
  llmMaxContextMessages?: number;
  /** Token budget warning threshold per thread (e.g. 100000) */
  llmTokenBudget?: number;
  /** LLM routing mode: extension (browser ext), server (team server proxy), auto (server if connected, else extension) */
  llmRoutingMode?: 'extension' | 'server' | 'auto';
  /** Enable CaddyAgent Supervisor for cross-investigation analysis */
  agentSupervisorEnabled?: boolean;
  /** Supervisor interval in minutes (default 30) */
  agentSupervisorIntervalMinutes?: number;
  tiAutoExtractEnabled?: boolean;        // default true
  tiAutoExtractDebounceMs?: number;      // default 2000
  tiEnabledIOCTypes?: string[];          // IOC type strings; undefined = all enabled
  tiDefaultConfidence?: string;          // 'low' | 'medium' | 'high' | 'confirmed'; default 'medium'
  serverUrl?: string;
  serverDisplayName?: string;
  notificationPrefs?: {
    mention?: boolean;
    reply?: boolean;
    reaction?: boolean;
    invite?: boolean;
    bot?: boolean;
  };
  dashboardKPIs?: string[];
  iocTableColumns?: string[];
  noteListCollapsed?: boolean;
  colorScheme?: string;          // color scheme id; default 'indigo'
  bgImageEnabled?: boolean;      // whether background image is active
  bgImageOpacity?: number;       // overlay opacity 0–100; default 85
  bgImagePosX?: number;          // horizontal position 0–100; default 50
  bgImagePosY?: number;          // vertical position 0–100; default 50
  bgImageZoom?: number;          // zoom scale 50–200; default 100
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultView: 'dashboard',
  editorMode: 'split',
  sidebarCollapsed: false,
  taskViewMode: 'list',
};

export const AVAILABLE_KPI_METRICS = [
  'open-investigations',
  'closed-this-month',
  'avg-investigation-age',
  'tasks-pending',
  'tasks-completed-week',
  'iocs-under-investigation',
  'notes-created-week',
  'timeline-events-week',
  'overdue-tasks',
] as const;

export type KPIMetricId = typeof AVAILABLE_KPI_METRICS[number];

export const KPI_METRIC_LABELS: Record<KPIMetricId, string> = {
  'open-investigations': 'Open Investigations',
  'closed-this-month': 'Closed This Month',
  'avg-investigation-age': 'Avg Investigation Age',
  'tasks-pending': 'Tasks Pending',
  'tasks-completed-week': 'Tasks Completed (Week)',
  'iocs-under-investigation': 'IOCs Under Investigation',
  'notes-created-week': 'Notes Created (Week)',
  'timeline-events-week': 'Timeline Events (Week)',
  'overdue-tasks': 'Overdue Tasks',
};

export const DEFAULT_DASHBOARD_KPIS: KPIMetricId[] = [
  'open-investigations',
  'tasks-pending',
  'iocs-under-investigation',
  'notes-created-week',
];

export const DEFAULT_IOC_TABLE_COLUMNS = [
  'value', 'type', 'confidence', 'source', 'iocStatus', 'attribution', 'clsLevel', 'updatedAt',
];

export const ALL_IOC_TABLE_COLUMNS: { key: string; label: string; alwaysVisible?: boolean; hiddenByDefault?: boolean; teamOnly?: boolean }[] = [
  { key: 'value', label: 'Value', alwaysVisible: true },
  { key: 'type', label: 'Type' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'source', label: 'Source' },
  { key: 'iocStatus', label: 'Status' },
  { key: 'attribution', label: 'Attribution' },
  { key: 'clsLevel', label: 'CLS' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'analystNotes', label: 'Notes', hiddenByDefault: true },
  { key: 'tags', label: 'Tags', hiddenByDefault: true },
  { key: 'firstSeen', label: 'First Seen', hiddenByDefault: true },
  { key: 'labels', label: 'Labels', hiddenByDefault: true },
  { key: 'assignee', label: 'Assignee', hiddenByDefault: true, teamOnly: true },
];

// IOC Analysis types
/** Indicator of Compromise type, matching standard CTI taxonomy. */
export type IOCType =
  | 'ipv4' | 'ipv6' | 'domain' | 'url' | 'email'
  | 'md5' | 'sha1' | 'sha256'
  | 'cve' | 'mitre-attack' | 'yara-rule' | 'sigma-rule' | 'file-path';

/** Analyst-assigned confidence in an IOC or event, from low to confirmed. */
export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'confirmed';

export interface IOCRelationship {
  targetIOCId: string;
  relationshipType: string;
}

export interface IOCEntry {
  id: string;
  type: IOCType;
  value: string;
  confidence: ConfidenceLevel;
  analystNotes?: string;
  attribution?: string;
  firstSeen: number;
  dismissed: boolean;
  iocSubtype?: string;
  iocStatus?: string;
  clsLevel?: string;
  /**
   * @deprecated Use `relationships[]` instead. Retained for backward compatibility
   * with existing data. Legacy values are migrated at runtime in IOCItem.tsx and
   * handled as fallback in graph-data.ts and export.ts. Do NOT use in new code.
   */
  relatedId?: string;
  /**
   * @deprecated Use `relationships[]` instead. Retained for backward compatibility
   * with existing data. Legacy values are migrated at runtime in IOCItem.tsx and
   * handled as fallback in graph-data.ts and export.ts. Do NOT use in new code.
   */
  relationshipType?: string;
  relationships?: IOCRelationship[];
}

export interface IOCAnalysis {
  extractedAt: number;
  iocs: IOCEntry[];
  analysisSummary?: string;
  lastPushedAt?: number;
}

export const IOC_TYPE_LABELS: Record<IOCType, { label: string; color: string }> = {
  ipv4:          { label: 'IPv4',         color: '#3b82f6' },
  ipv6:          { label: 'IPv6',         color: '#6366f1' },
  domain:        { label: 'Domain',       color: '#06b6d4' },
  url:           { label: 'URL',          color: '#8b5cf6' },
  email:         { label: 'Email',        color: '#ec4899' },
  md5:           { label: 'MD5',          color: '#f97316' },
  sha1:          { label: 'SHA-1',        color: '#eab308' },
  sha256:        { label: 'SHA-256',      color: '#ef4444' },
  cve:           { label: 'CVE',          color: '#10b981' },
  'mitre-attack': { label: 'MITRE ATT&CK', color: '#14b8a6' },
  'yara-rule':   { label: 'YARA Rule',   color: '#a855f7' },
  'sigma-rule':  { label: 'SIGMA Rule',  color: '#0891b2' },
  'file-path':   { label: 'File Path',   color: '#64748b' },
};

export const IOC_STATUS_VALUES = ['active', 'resolved', 'false-positive', 'under-investigation'] as const;
export type IOCStatusValue = typeof IOC_STATUS_VALUES[number];

export const IOC_STATUS_LABELS: Record<IOCStatusValue, string> = {
  active: 'Active',
  resolved: 'Resolved',
  'false-positive': 'False Positive',
  'under-investigation': 'Under Investigation',
};

export const IOC_STATUS_COLORS: Record<IOCStatusValue, string> = {
  active: '#22c55e',
  resolved: '#6b7280',
  'false-positive': '#f97316',
  'under-investigation': '#3b82f6',
};

export const CONFIDENCE_LEVELS: Record<ConfidenceLevel, { label: string; color: string }> = {
  low:       { label: 'Low',       color: '#6b7280' },
  medium:    { label: 'Medium',    color: '#eab308' },
  high:      { label: 'High',      color: '#f97316' },
  confirmed: { label: 'Confirmed', color: '#ef4444' },
};

// IOC subtype defaults per IOC type
export const DEFAULT_IOC_SUBTYPES: Record<IOCType, string[]> = {
  ipv4: ['Scanning IP', 'C2 Server', 'Proxy', 'VPN Exit Node', 'Sinkhole', 'Tor Exit Node'],
  ipv6: ['Scanning IP', 'C2 Server', 'Proxy', 'VPN Exit Node', 'Sinkhole', 'Tor Exit Node'],
  domain: ['DGA Domain', 'Parked Domain', 'C2 Domain', 'Phishing Domain', 'Typosquat'],
  url: ['Phishing URL', 'Payload URL', 'C2 URL', 'Watering Hole', 'Exploit Kit Landing'],
  email: ['Phishing Sender', 'Spear-phishing Sender', 'Compromised Account', 'Distribution List'],
  md5: ['Malware Sample', 'Dropper', 'Payload', 'Tool', 'Legitimate (FP)'],
  sha1: ['Malware Sample', 'Dropper', 'Payload', 'Tool', 'Legitimate (FP)'],
  sha256: ['Malware Sample', 'Dropper', 'Payload', 'Tool', 'Legitimate (FP)'],
  cve: ['Remote Code Execution', 'Privilege Escalation', 'Information Disclosure', 'Denial of Service', 'Authentication Bypass'],
  'mitre-attack': ['Technique', 'Sub-technique', 'Tactic'],
  'yara-rule': ['Detection Rule', 'Hunting Rule', 'Classification Rule'],
  'sigma-rule': ['Detection Rule', 'Hunting Rule', 'Log Correlation Rule', 'Behavioral Rule'],
  'file-path': ['Persistence Location', 'Staging Directory', 'Exfil Path', 'Log File', 'Config File'],
};

// IOC relationship type definitions
export interface IOCRelationshipDef {
  label: string;
  sourceTypes: IOCType[];  // empty = any
  targetTypes: IOCType[];  // empty = any
}

export const DEFAULT_RELATIONSHIP_TYPES: Record<string, IOCRelationshipDef> = {
  'resolves-to':       { label: 'Resolves To',       sourceTypes: ['domain'],                                    targetTypes: ['ipv4', 'ipv6'] },
  'downloads':         { label: 'Downloads',          sourceTypes: ['url'],                                       targetTypes: ['md5', 'sha1', 'sha256'] },
  'communicates-with': { label: 'Communicates With',  sourceTypes: ['ipv4', 'ipv6', 'domain'],                    targetTypes: ['ipv4', 'ipv6', 'domain'] },
  'drops':             { label: 'Drops',              sourceTypes: ['md5', 'sha1', 'sha256'],                     targetTypes: ['md5', 'sha1', 'sha256', 'file-path'] },
  'hosts':             { label: 'Hosts',              sourceTypes: ['ipv4', 'ipv6', 'domain'],                    targetTypes: ['url'] },
  'attributed-to':     { label: 'Attributed To',      sourceTypes: [],                                            targetTypes: [] },
  'exploits':          { label: 'Exploits',           sourceTypes: ['md5', 'sha1', 'sha256', 'url'],              targetTypes: ['cve'] },
  'uses-technique':    { label: 'Uses Technique',     sourceTypes: [],                                            targetTypes: ['mitre-attack'] },
  'detected-by':       { label: 'Detected By',        sourceTypes: ['md5', 'sha1', 'sha256'],                     targetTypes: ['yara-rule', 'sigma-rule'] },
  'alerts-on':         { label: 'Alerts On',          sourceTypes: ['sigma-rule'],                                 targetTypes: ['mitre-attack'] },
  'related-to':        { label: 'Related To',         sourceTypes: [],                                            targetTypes: [] },
};

// Timeline types
/** Event category aligned with MITRE ATT&CK tactics plus IR phases. */
export type TimelineEventType =
  | 'initial-access' | 'execution' | 'persistence' | 'privilege-escalation'
  | 'defense-evasion' | 'credential-access' | 'discovery' | 'lateral-movement'
  | 'collection' | 'exfiltration' | 'command-and-control' | 'impact'
  | 'detection' | 'containment' | 'eradication' | 'recovery'
  | 'communication' | 'evidence'
  | 'other';

/** A timestamped event on an investigation timeline, with ATT&CK mappings and linked entities. */
export interface TimelineEvent {
  id: string;
  timestamp: number;
  timestampEnd?: number;
  title: string;
  description?: string;
  eventType: TimelineEventType;
  source: string;
  confidence: ConfidenceLevel;
  linkedIOCIds: string[];
  linkedNoteIds: string[];
  linkedTaskIds: string[];
  mitreAttackIds: string[];
  actor?: string;
  assets: string[];
  tags: string[];
  rawData?: string;
  starred: boolean;
  folderId?: string;
  timelineId: string;
  clsLevel?: string;
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  latitude?: number;   // WGS84 (-90 to 90)
  longitude?: number;  // WGS84 (-180 to 180)
  comments?: EntityComment[];
  trashed: boolean;
  trashedAt?: number;
  archived: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Timeline {
  id: string;
  name: string;
  description?: string;
  color?: string;
  order: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** An Excalidraw-backed whiteboard for visual analysis within an investigation. */
export interface Whiteboard {
  id: string;
  name: string;
  elements: string;     // JSON.stringify(ExcalidrawElement[])
  appState?: string;    // JSON.stringify({zoom, scrollX, scrollY, theme})
  folderId?: string;
  tags: string[];
  order: number;
  clsLevel?: string;
  trashed: boolean;
  trashedAt?: number;
  archived: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** A standalone Indicator of Compromise tracked independently in an investigation. */
export interface StandaloneIOC {
  id: string;
  type: IOCType;
  value: string;
  confidence: ConfidenceLevel;
  analystNotes?: string;
  attribution?: string;
  iocSubtype?: string;
  iocStatus?: string;
  clsLevel?: string;
  folderId?: string;
  tags: string[];
  relationships?: IOCRelationship[];
  linkedNoteIds?: string[];
  linkedTaskIds?: string[];
  linkedTimelineEventIds?: string[];
  comments?: EntityComment[];
  enrichment?: Record<string, Array<Record<string, unknown>>>;
  assigneeId?: string;
  assigneeName?: string;
  trashed: boolean;
  trashedAt?: number;
  archived: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

// LLM / Chat types
export type LLMProvider = 'anthropic' | 'openai' | 'gemini' | 'mistral' | 'local';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  toolCalls?: ToolCallRecord[];
  userId?: string;
  createdAt: number;
  /** Token usage reported by the LLM provider for this message exchange */
  tokenCount?: { input: number; output: number };
  /** Image attachments sent with this message */
  attachments?: ChatAttachment[];
}

export interface ChatAttachment {
  type: 'image';
  /** base64-encoded image data */
  data: string;
  mimeType: string;
  /** File name if available */
  name?: string;
}

/** A conversation thread with CaddyAI, stored per-investigation or globally. */
export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  provider: LLMProvider;
  folderId?: string;
  tags: string[];
  clsLevel?: string;
  /** Plan mode proposes actions without executing write tools; Act mode executes normally */
  mode?: 'plan' | 'act';
  /** Source of this thread: 'user' (default), 'agent' (CaddyAgent audit trail), 'agent-meeting', or 'caddyshack' */
  source?: 'user' | 'agent' | 'agent-meeting' | 'caddyshack';
  /** Cached summary of truncated conversation context */
  contextSummary?: string;
  trashed: boolean;
  trashedAt?: number;
  archived: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** A snapshot of entities before a write tool action, enabling undo. */
export interface Checkpoint {
  id: string;
  threadId: string;
  /** ID of the assistant message that triggered the checkpoint */
  messageId: string;
  /** Tool names that were executed */
  toolNames: string[];
  /** Snapshot of entities that were created or modified */
  snapshot: CheckpointEntity[];
  /** Whether this checkpoint has been restored */
  restored: boolean;
  createdAt: number;
}

export interface CheckpointEntity {
  table: string;
  entityId: string;
  /** null means the entity didn't exist before (was created by the tool) */
  data: Record<string, unknown> | null;
}

/** A user-defined slash command template for CaddyAI chat. */
export interface CustomSlashCommand {
  id: string;
  /** Command name without the leading / (e.g. 'mytriage') */
  name: string;
  description: string;
  /** Markdown template with optional {{input}} placeholder */
  template: string;
  createdAt: number;
  updatedAt: number;
}

export interface TimelineExportData {
  format: 'threatcaddy-timeline';
  version: 1;
  exportedAt: number;
  timeline: { name: string; description?: string; color?: string };
  events: TimelineEvent[];
}

export const TIMELINE_EVENT_TYPE_LABELS: Record<TimelineEventType, { label: string; color: string }> = {
  'initial-access':        { label: 'Initial Access',        color: '#ef4444' },
  'execution':             { label: 'Execution',             color: '#f97316' },
  'persistence':           { label: 'Persistence',           color: '#eab308' },
  'privilege-escalation':  { label: 'Privilege Escalation',  color: '#f59e0b' },
  'defense-evasion':       { label: 'Defense Evasion',       color: '#84cc16' },
  'credential-access':     { label: 'Credential Access',     color: '#22c55e' },
  'discovery':             { label: 'Discovery',             color: '#10b981' },
  'lateral-movement':      { label: 'Lateral Movement',      color: '#14b8a6' },
  'collection':            { label: 'Collection',            color: '#06b6d4' },
  'exfiltration':          { label: 'Exfiltration',          color: '#0ea5e9' },
  'command-and-control':   { label: 'C2',                    color: '#3b82f6' },
  'impact':                { label: 'Impact',                color: '#6366f1' },
  'detection':             { label: 'Detection',             color: '#8b5cf6' },
  'containment':           { label: 'Containment',           color: '#a855f7' },
  'eradication':           { label: 'Eradication',           color: '#d946ef' },
  'recovery':              { label: 'Recovery',              color: '#ec4899' },
  'communication':         { label: 'Communication',         color: '#f43f5e' },
  'evidence':              { label: 'Evidence',              color: '#64748b' },
  'other':                 { label: 'Other',                 color: '#6b7280' },
};

export type SortOption = 'updatedAt' | 'createdAt' | 'title' | 'iocCount';
export type SortDirection = 'asc' | 'desc';

export const NOTE_COLORS = [
  { name: 'None', value: '' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  none: '',
  low: '#3b82f6',
  medium: '#eab308',
  high: '#ef4444',
};

export const DEFAULT_CLS_LEVELS = ['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED'];
export const DEFAULT_PAP_LEVELS = ['PAP:WHITE', 'PAP:GREEN', 'PAP:AMBER', 'PAP:RED'];

// OCI Sync types
export interface SharedItemEnvelope {
  version: 1;
  type: 'note' | 'clip' | 'ioc-report' | 'full-backup';
  sharedBy: string;
  sharedAt: number;
  payload: Note | Note[] | Task[] | ExportData;
}

// ─── Note Templates ─────────────────────────────────────────────

export type TemplateSource = 'builtin' | 'user' | 'team';

/** A reusable template for creating pre-structured notes (e.g., triage forms, IR reports). */
export interface NoteTemplate {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  content: string;
  category: string;
  tags?: string[];
  clsLevel?: string;
  source: TemplateSource;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Investigation Playbooks ────────────────────────────────────

export type PlaybookStepEntity = 'task' | 'note';

export interface PlaybookStep {
  order: number;
  entityType: PlaybookStepEntity;
  title: string;
  content: string;
  priority?: Priority;
  status?: TaskStatus;
  tags?: string[];
  noteTemplateId?: string;
  phase?: string;
}

/** A step-by-step playbook template that scaffolds tasks and notes for a new investigation. */
export interface PlaybookTemplate {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  investigationType: string;
  defaultTags?: string[];
  defaultClsLevel?: string;
  defaultPapLevel?: string;
  steps: PlaybookStep[];
  source: TemplateSource;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExportData {
  version: 1;
  exportedAt: number;
  notes: Note[];
  tasks: Task[];
  folders: Folder[];
  tags: Tag[];
  timelineEvents?: TimelineEvent[];
  timelines?: Timeline[];
  whiteboards?: Whiteboard[];
  standaloneIOCs?: StandaloneIOC[];
  chatThreads?: ChatThread[];
  agentActions?: AgentAction[];
  agentProfiles?: AgentProfile[];
  agentDeployments?: AgentDeployment[];
  agentMeetings?: AgentMeeting[];
  quickLinks?: QuickLink[];
  noteTemplates?: NoteTemplate[];
  playbookTemplates?: PlaybookTemplate[];
}

export const TAG_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f97316', '#ef4444',
  '#ec4899', '#a855f7',
];

// Activity Log types
export type ActivityCategory =
  | 'note' | 'task' | 'timeline' | 'whiteboard'
  | 'folder' | 'tag' | 'ioc' | 'sync' | 'data' | 'chat'
  | 'agent-bridge';

export type ActivityAction =
  | 'create' | 'update' | 'delete'
  | 'trash' | 'restore' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'empty-trash'
  | 'complete' | 'reopen'
  | 'star' | 'unstar'
  | 'analyze' | 'dismiss' | 'push-iocs'
  | 'export' | 'import' | 'share' | 'backup' | 'share-ioc-report'
  | 'rename'
  | 'tool.exec' | 'tool.error';

export interface ActivityLogEntry {
  id: string;
  action: ActivityAction;
  category: ActivityCategory;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  userId?: string;
  timestamp: number;
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, { label: string; color: string }> = {
  note:       { label: 'Note',       color: '#3b82f6' },
  task:       { label: 'Task',       color: '#22c55e' },
  timeline:   { label: 'Timeline',   color: '#f97316' },
  whiteboard: { label: 'Whiteboard', color: '#a855f7' },
  folder:     { label: 'Investigation', color: '#eab308' },
  tag:        { label: 'Tag',        color: '#ec4899' },
  ioc:        { label: 'IOC',        color: '#ef4444' },
  sync:       { label: 'Sync',       color: '#06b6d4' },
  data:            { label: 'Data',         color: '#6366f1' },
  chat:            { label: 'Chat',         color: '#8b5cf6' },
  'agent-bridge':  { label: 'Agent',        color: '#14b8a6' },
};

// ─── Social / Team Types ────────────────────────────────────────

export interface PostAttachment {
  id: string;
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  filename: string;
  size?: number;
  thumbnailUrl?: string;
  alt?: string;
}

export interface Post {
  id: string;
  authorId: string;
  content: string;
  attachments: PostAttachment[];
  folderId?: string | null;
  parentId?: string | null;
  replyToId?: string | null;
  replyToAuthorName?: string;
  mentions: string[];
  clsLevel?: string | null;
  pinned: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  authorDisplayName?: string;
  authorAvatarUrl?: string | null;
  reactions?: Record<string, { count: number; userIds: string[] }>;
  replyCount?: number;
  replies?: Post[];
}

export type NotificationType = 'mention' | 'reply' | 'reaction' | 'invite' | 'entity-update';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  sourceUserId?: string;
  postId?: string;
  folderId?: string;
  message: string;
  read: boolean;
  createdAt: string;
  sourceUserDisplayName?: string;
  sourceUserAvatarUrl?: string | null;
}

export interface TeamUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: string;
}

export interface InvestigationMember {
  id: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}

/** Metadata returned by GET /api/investigations for hub cards */
export interface InvestigationSummary {
  folderId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
  folder: {
    name: string;
    status: string;
    color?: string;
    icon?: string;
    description?: string;
    clsLevel?: string;
    papLevel?: string;
    tags?: string[];
    createdAt: string;
    updatedAt: string;
  };
  entityCounts: {
    notes: number;
    tasks: number;
    iocs: number;
    events: number;
    whiteboards: number;
    chats: number;
  };
  memberCount: number;
}

/** Data residency mode for an investigation */
export type InvestigationDataMode = 'local' | 'remote' | 'synced';

export interface PresenceUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  view: string;
  entityId?: string;
}

// ─── CaddyAgent Types ─────────────────────────────────────────

/** Action class for policy decisions — maps tools to approval categories. */
export type AgentActionClass = 'read' | 'enrich' | 'fetch' | 'create' | 'modify';

/** Per-investigation agent policy controlling what requires human approval. */
export interface AgentPolicy {
  autoApproveReads: boolean;
  autoApproveEnrich: boolean;
  /** Auto-approve web fetching (fetch_url) — enables proactive OSINT research */
  autoApproveFetch: boolean;
  autoApproveCreate: boolean;
  autoApproveModify: boolean;
  intervalMinutes: number;
  model?: string;
  focusAreas?: string[];
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  autoApproveReads: true,
  autoApproveEnrich: true,
  autoApproveFetch: true,
  autoApproveCreate: false,
  autoApproveModify: false,
  intervalMinutes: 5,
};

/** Severity level for agent escalations. */
export type AgentActionSeverity = 'info' | 'warning' | 'critical';

/** Status of a proposed or executed agent action. */
export type AgentActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

/** A proposed or executed action by CaddyAgent, stored in the approval queue. */
export interface AgentAction {
  id: string;
  investigationId: string;
  threadId: string;
  agentConfigId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  rationale: string;
  status: AgentActionStatus;
  resultSummary?: string;
  severity?: AgentActionSeverity;
  createdAt: number;
  executedAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

/** Runtime status of an agent for an investigation. */
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'error';

// ─── Agent Profile System ──────────────────────────────────────────

/** Role determines what an agent profile can do: lead can delegate, observer is read-only. */
export type AgentProfileRole = 'lead' | 'specialist' | 'observer';

/** A reusable agent profile defining persona, tools, and policy. */
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  role: AgentProfileRole;
  /** Role-specific system prompt injected after base CaddyAgent instructions */
  systemPrompt: string;
  /** Subset of tool names this profile can use (undefined = all tools) */
  allowedTools?: string[];
  /** Entity types this agent cannot modify (e.g., ['task'] means read-only on tasks) */
  readOnlyEntityTypes?: string[];
  policy: AgentPolicy;
  /** LLM model override */
  model?: string;
  /** Priority in meetings — lower speaks first */
  priority?: number;
  source: TemplateSource;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** Performance metrics tracked per agent deployment. */
export interface AgentMetrics {
  cyclesRun: number;
  toolCallsExecuted: number;
  toolCallsProposed: number;
  tasksCompleted: number;
  tasksRejected: number;
  tokensUsed: { input: number; output: number };
  lastCycleAt: number;
}

/** An agent profile deployed to a specific investigation. */
export interface AgentDeployment {
  id: string;
  investigationId: string;
  profileId: string;
  /** ID of another deployment that supervises this agent */
  supervisorDeploymentId?: string;
  /** Runtime policy overrides for this deployment */
  policyOverrides?: Partial<AgentPolicy>;
  /** Per-agent audit trail ChatThread */
  threadId?: string;
  status: AgentStatus;
  lastRunAt?: number;
  /** Performance metrics */
  metrics?: AgentMetrics;
  /** Server-side bot config ID (when registered with team server) */
  serverBotConfigId?: string;
  /** Whether server-side mode is enabled for this deployment */
  serverSideEnabled?: boolean;
  /** Execution order within the investigation */
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** A collaborative meeting between deployed agents. */
export interface AgentMeeting {
  id: string;
  investigationId: string;
  /** Participating AgentDeployment IDs */
  participantDeploymentIds: string[];
  /** ChatThread with source='agent-meeting' */
  threadId: string;
  /** Note ID with meeting minutes (produced at conclusion) */
  minutesNoteId?: string;
  agenda: string;
  status: 'in-progress' | 'completed' | 'failed';
  roundsCompleted: number;
  maxRounds: number;
  createdAt: number;
  completedAt?: number;
}
