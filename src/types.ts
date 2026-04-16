import { createLabelProxy, createLabelColorProxy, noteColorLabel, iocTableColumnLabel } from './lib/i18n-labels';

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
  /** Parent note ID for sub-folder nesting (null = top-level) */
  parentNoteId?: string;
  /** If true, this note acts as a folder/container for child notes */
  isFolder?: boolean;
  /** Set true when an observer-role agent created this note — analyst should review before it's trusted as investigation output. */
  reviewRequired?: boolean;
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

/** A recorded rejection when a lead agent sends a task back for redo. */
export interface TaskRejection {
  at: number;
  /** Lead agent profile ID that rejected the work */
  byAgentId?: string;
  /** Quality verdict that caused the rejection */
  quality: 'needs-redo' | 'serious-failure';
  /** Free-form reasoning the reviewer gave (displayed in the after-action note) */
  reason: string;
  /** Structured concrete change the specialist must make — required to reject. */
  requestedDelta: string;
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
  /** Lead-agent rejection count — incremented each time review_completed_task sends it back. */
  rejectionCount?: number;
  /** Full history of rejections (bounded; newest appended). */
  rejectionHistory?: TaskRejection[];
  /** Auto-escalated to a human after too many rejections — agents can no longer re-claim. */
  escalated?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type InvestigationStatus = 'active' | 'closed' | 'archived';

export type ClosureResolution = 'resolved' | 'false-positive' | 'escalated' | 'duplicate' | 'inconclusive';

export const CLOSURE_RESOLUTION_LABELS: Record<ClosureResolution, string> = createLabelProxy(
  'closureResolution',
  ['resolved', 'false-positive', 'escalated', 'duplicate', 'inconclusive'] as const,
);

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
  /** User's display name for entity attribution (standalone mode) */
  displayName?: string;
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
  /** Configured external agent hosts for skill execution */
  agentHosts?: AgentHost[];
  /** Skills discovered from the local LLM endpoint (GET /skills) */
  llmLocalSkills?: AgentHostSkill[];
  /** Timestamp of last local skill discovery */
  llmLocalSkillsFetchedAt?: number;
  /** UI language code (e.g. 'en', 'de', 'zh-CN'). Defaults to 'en'. */
  language?: string;
}

// ── Agent Host Types ─────────────────────────────────────────────────

export interface AgentHostSkill {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Hint for agent policy auto-approval. Default: 'fetch' */
  actionClass?: AgentActionClass;
}

export interface AgentHost {
  id: string;
  /** Short slug used in tool names (e.g. "soc1") — alphanumeric + hyphens, max 20 chars */
  name: string;
  /** Human-readable label (e.g. "SOC Workstation") */
  displayName: string;
  /** Base URL (e.g. "http://192.168.1.50:8080") */
  url: string;
  /** Optional bearer token for authentication */
  apiKey?: string;
  enabled: boolean;
  /** Cached skills from last GET /skills discovery */
  skills: AgentHostSkill[];
  /** Timestamp of last skill discovery */
  skillsFetchedAt?: number;
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

export const KPI_METRIC_LABELS: Record<KPIMetricId, string> = createLabelProxy(
  'kpiMetric',
  AVAILABLE_KPI_METRICS,
);

export const DEFAULT_DASHBOARD_KPIS: KPIMetricId[] = [
  'open-investigations',
  'tasks-pending',
  'iocs-under-investigation',
  'notes-created-week',
];

export const DEFAULT_IOC_TABLE_COLUMNS = [
  'value', 'type', 'confidence', 'source', 'iocStatus', 'attribution', 'clsLevel', 'updatedAt',
];

const IOC_TABLE_COLUMN_DEFS: { key: string; alwaysVisible?: boolean; hiddenByDefault?: boolean; teamOnly?: boolean }[] = [
  { key: 'value', alwaysVisible: true },
  { key: 'type' },
  { key: 'confidence' },
  { key: 'source' },
  { key: 'iocStatus' },
  { key: 'attribution' },
  { key: 'clsLevel' },
  { key: 'updatedAt' },
  { key: 'analystNotes', hiddenByDefault: true },
  { key: 'tags', hiddenByDefault: true },
  { key: 'firstSeen', hiddenByDefault: true },
  { key: 'labels', hiddenByDefault: true },
  { key: 'assignee', hiddenByDefault: true, teamOnly: true },
];
export const ALL_IOC_TABLE_COLUMNS: { key: string; label: string; alwaysVisible?: boolean; hiddenByDefault?: boolean; teamOnly?: boolean }[] =
  IOC_TABLE_COLUMN_DEFS.map((col) => ({
    ...col,
    get label() { return iocTableColumnLabel(col.key); },
  }));

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

const IOC_TYPE_COLORS: Record<IOCType, string> = {
  ipv4: '#3b82f6', ipv6: '#6366f1', domain: '#06b6d4', url: '#8b5cf6',
  email: '#ec4899', md5: '#f97316', sha1: '#eab308', sha256: '#ef4444',
  cve: '#10b981', 'mitre-attack': '#14b8a6', 'yara-rule': '#a855f7',
  'sigma-rule': '#0891b2', 'file-path': '#64748b',
};
export const IOC_TYPE_LABELS: Record<IOCType, { label: string; color: string }> = createLabelColorProxy(
  'iocType', IOC_TYPE_COLORS,
);

export const IOC_STATUS_VALUES = ['active', 'resolved', 'false-positive', 'under-investigation'] as const;
export type IOCStatusValue = typeof IOC_STATUS_VALUES[number];

export const IOC_STATUS_LABELS: Record<IOCStatusValue, string> = createLabelProxy(
  'iocStatus', IOC_STATUS_VALUES,
);

export const IOC_STATUS_COLORS: Record<IOCStatusValue, string> = {
  active: '#22c55e',
  resolved: '#6b7280',
  'false-positive': '#f97316',
  'under-investigation': '#3b82f6',
};

const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  low: '#6b7280', medium: '#eab308', high: '#f97316', confirmed: '#ef4444',
};
export const CONFIDENCE_LEVELS: Record<ConfidenceLevel, { label: string; color: string }> = createLabelColorProxy(
  'confidence', CONFIDENCE_COLORS,
);

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
  /** Structured agent cycle summary — set on the final audit message of a cycle. */
  agentCycleSummary?: AgentCycleSummary;
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
  /** Parent thread ID for folder grouping (thread with isFolder=true) */
  parentThreadId?: string;
  /** Marks this thread as a folder container for organizing chats */
  isFolder?: boolean;
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

const TIMELINE_EVENT_TYPE_COLORS: Record<TimelineEventType, string> = {
  'initial-access': '#ef4444', 'execution': '#f97316', 'persistence': '#eab308',
  'privilege-escalation': '#f59e0b', 'defense-evasion': '#84cc16', 'credential-access': '#22c55e',
  'discovery': '#10b981', 'lateral-movement': '#14b8a6', 'collection': '#06b6d4',
  'exfiltration': '#0ea5e9', 'command-and-control': '#3b82f6', 'impact': '#6366f1',
  'detection': '#8b5cf6', 'containment': '#a855f7', 'eradication': '#d946ef',
  'recovery': '#ec4899', 'communication': '#f43f5e', 'evidence': '#64748b', 'other': '#6b7280',
};
export const TIMELINE_EVENT_TYPE_LABELS: Record<TimelineEventType, { label: string; color: string }> = createLabelColorProxy(
  'timelineEventType', TIMELINE_EVENT_TYPE_COLORS,
);

export type SortOption = 'updatedAt' | 'createdAt' | 'title' | 'iocCount';
export type SortDirection = 'asc' | 'desc';

const NOTE_COLOR_VALUES = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
export const NOTE_COLORS = NOTE_COLOR_VALUES.map((value, i) => ({
  get name() { return noteColorLabel(i); },
  value,
}));

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

const ACTIVITY_CATEGORY_COLORS: Record<ActivityCategory, string> = {
  note: '#3b82f6', task: '#22c55e', timeline: '#f97316', whiteboard: '#a855f7',
  folder: '#eab308', tag: '#ec4899', ioc: '#ef4444', sync: '#06b6d4',
  data: '#6366f1', chat: '#8b5cf6', 'agent-bridge': '#14b8a6',
};
export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, { label: string; color: string }> = createLabelColorProxy(
  'activityCategory', ACTIVITY_CATEGORY_COLORS,
);

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

/** Action class for policy decisions — maps tools to approval categories.
 *  `delegate` is internal team coordination (lead→specialist task handoff, self-reflection)
 *  and is always auto-approved; it bypasses the standard create/modify toggles so a
 *  locked-down policy does not silently break the delegation workflow. */
export type AgentActionClass = 'read' | 'enrich' | 'fetch' | 'create' | 'modify' | 'delegate';

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
  /** Agent personality: creativity level 0-100 (0=strictly analytical, 100=highly creative/speculative) */
  creativity?: number;
  /** Agent personality: seriousness level 0-100 (0=casual/conversational, 100=formal/professional) */
  seriousness?: number;
  /** Agent personality: verbosity 0-100 (0=terse bullet points, 100=detailed prose) */
  verbosity?: number;
  /** Agent personality: risk tolerance 0-100 (0=conservative/cautious, 100=aggressive/bold) */
  riskTolerance?: number;
  /** Max agent-initiated meetings per day (0 = unlimited, default unlimited) */
  maxMeetingsPerDay?: number;
  /** Max pending human questions at once (0 = unlimited, default unlimited) */
  maxPendingQuestions?: number;
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
  /** Idempotency fingerprint (deploymentId:cycleStartedAt:toolName:argHash) —
   *  when a tool is re-invoked with the same key, the prior result is replayed
   *  instead of re-executing. Prevents double-writes on client crashes and
   *  on client↔server handoff boundaries. */
  idempotencyKey?: string;
  createdAt: number;
  executedAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

/** Runtime status of an agent for an investigation. */
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'error';

// ─── Agent Profile System ──────────────────────────────────────────

/** Role determines what an agent profile can do:
 * - executive: CISO/Chief of Staff — can delegate, dismiss agents, spawn/define new agents
 * - lead: Lead Analyst — can delegate tasks, review work, call meetings
 * - specialist: domain expert — works assigned tasks and focus areas
 * - observer: read-only — monitors without modifying */
export type AgentProfileRole = 'executive' | 'lead' | 'specialist' | 'observer';

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
  /** Persistent "soul" — cross-investigation memory, lessons, and self-identity */
  soul?: AgentSoul;
  source: TemplateSource;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

/** Persistent agent identity that transcends individual investigations. */
export interface AgentSoul {
  /** Self-description — how the agent sees itself, updated by the agent over time */
  identity: string;
  /** Lessons learned from past investigations — what worked, what didn't */
  lessons: string[];
  /** Strengths the agent has identified in itself */
  strengths: string[];
  /** Weaknesses or areas for improvement */
  weaknesses: string[];
  /** Aggregate performance stats across all deployments */
  lifetimeMetrics: {
    investigationsWorked: number;
    totalCycles: number;
    totalToolCalls: number;
    tasksCompleted: number;
    tasksRejected: number;
    meetingsAttended: number;
    /** 0-100 score derived from success rate and feedback */
    performanceScore: number;
  };
  /** Last updated timestamp */
  updatedAt: number;
}

/** Cycle outcome classification for metrics bucketing. */
export type AgentCycleOutcome = 'success' | 'timeout' | 'error' | 'policyDenied';

/** Performance metrics tracked per agent deployment. */
export interface AgentMetrics {
  cyclesRun: number;
  toolCallsExecuted: number;
  toolCallsProposed: number;
  tasksCompleted: number;
  tasksRejected: number;
  tokensUsed: { input: number; output: number };
  lastCycleAt: number;
  /** Cumulative cost in USD (provider-reported token usage × model pricing). */
  costUSD?: number;
  /** Count of tool calls by tool name (cumulative across cycles). */
  toolCallHistogram?: Record<string, number>;
  /** Count of tool errors by tool name (cumulative across cycles). */
  errorHistogram?: Record<string, number>;
  /** Cumulative cycle outcome bucket counts. */
  cyclesByOutcome?: Record<AgentCycleOutcome, number>;
  /** Tasks this deployment auto-escalated to a human (after N rejections). */
  tasksEscalated?: number;
}

/** Reference to an entity touched during a cycle, for audit summaries. */
export interface AgentEntityRef {
  type: 'note' | 'task' | 'ioc' | 'timeline' | 'folder' | 'other';
  id?: string;
  /** Short human-readable label. */
  label?: string;
}

/** Structured per-cycle summary, emitted at cycle end and persisted on the audit ChatMessage. */
export interface AgentCycleSummary {
  /** ISO-like timestamp the cycle started. */
  startedAt: number;
  /** Milliseconds elapsed. */
  durationMs: number;
  /** One-line rationale — first sentence of the agent's final assistant turn, or fallback. */
  whyThisCycle: string;
  /** Short bullets describing what the agent accomplished this cycle. */
  whatIDid: string[];
  /** Entities created or modified. */
  entitiesTouched: AgentEntityRef[];
  /** Token counts for this cycle. */
  tokens: { input: number; output: number };
  /** Cost for this cycle in USD. */
  costUSD: number;
  /** Number of tool calls auto-executed and proposed this cycle. */
  toolCalls: { executed: number; proposed: number };
  /** Per-tool breakdown for this cycle. */
  toolHistogram: Record<string, number>;
  /** Per-tool error counts for this cycle. */
  errorHistogram: Record<string, number>;
  /** LLM turns consumed this cycle. */
  turns: number;
  /** Cycle outcome classification. */
  outcome: AgentCycleOutcome;
  /** Error message if outcome !== 'success'. */
  error?: string;
  /** Provider + model used. */
  provider: string;
  model: string;
  /** Number of tasks this cycle escalated to a human (via review_completed_task). */
  tasksEscalated?: number;
}

/** Summary of what happened during a server-owned window, surfaced to the
 *  analyst after the client reclaims the deployment. Until acknowledged, it
 *  drives a banner on the deployment card. */
export interface HandoffReconciliation {
  /** Wall-clock time the reconciliation was recorded. */
  at: number;
  /** Number of agent actions the server executed during the window. */
  serverActionCount: number;
  /** IDs of those actions (already merged into local db.agentActions). Empty
   *  when the reconciliation was triggered without a server-actions pull. */
  serverActionIds: string[];
  /** Per-tool count of what the server ran, for one-glance summary display. */
  toolHistogram: Record<string, number>;
  /** Has the analyst acknowledged the reconciliation? Dismisses the banner. */
  acknowledged: boolean;
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
  /** Explicit handoff state machine:
   *   client          — this client owns the cycle loop (default)
   *   handoff-pending — heartbeat lapsed; server is about to take over
   *   server          — server bot is running cycles
   *   reclaim-pending — client is back online and reconciling state
   *  Replaces the implicit timestamp-only signal in HeartbeatManager. */
  handoffState?: 'client' | 'handoff-pending' | 'server' | 'reclaim-pending';
  /** Wall-clock time of the last successful client-side reconciliation after
   *  a server-owned window — used to gate the agent from starting a new cycle
   *  on stale local state. */
  lastReconciledAt?: number;
  /** Summary of the most recent handoff, shown to the analyst as a "here's
   *  what happened while your tab was asleep" banner until acknowledged. */
  lastHandoffReconciliation?: HandoffReconciliation;
  /** Competitive mode: cooperative (share work), competitive (independent analysis), independent (assigned tasks only) */
  competitiveness?: 'cooperative' | 'competitive' | 'independent';
  /** Shift state: active agents run cycles, resting agents don't */
  shift?: 'active' | 'resting';
  shiftStartedAt?: number;
  /** Execution order within the investigation */
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Why a meeting was called — drives structured output + prompt shaping.
 *  - redTeamReview: adversarial review of a claim/plan; verdict = holds|revise|reject
 *  - dissentSynthesis: reconcile conflicting agent positions into one view
 *  - signOff: approval gate before a high-impact action; produces decision + conditions
 *  - freeform: legacy/unscoped discussion (not recommended — rounds degrade accuracy) */
export type MeetingPurpose = 'redTeamReview' | 'dissentSynthesis' | 'signOff' | 'freeform';

/** Structured artifact produced by a meeting (shape depends on purpose). */
export type MeetingStructuredOutput =
  | { purpose: 'redTeamReview'; verdict: 'holds' | 'revise' | 'reject'; attackedClaims: string[]; counterEvidence: string[]; weakPoints: string[] }
  | { purpose: 'dissentSynthesis'; positions: Array<{ agent: string; position: string; evidence?: string }>; reconciled: string; unresolved: string[] }
  | { purpose: 'signOff'; decision: 'approved' | 'rejected' | 'needs-more-info'; approvers: string[]; blockers: string[]; conditions: string[] }
  | { purpose: 'freeform'; summary: string; keyPoints: string[]; actionItems: string[] };

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
  /** Meeting purpose — drives structured output + prompt. Defaults to 'freeform' for legacy callers. */
  purpose?: MeetingPurpose;
  /** Structured artifact produced at the end of a scoped meeting. */
  structuredOutput?: MeetingStructuredOutput;
  /** Confidence (1-5) each participant self-reported on their final turn. */
  participantConfidence?: Record<string, number>;
  createdAt: number;
  completedAt?: number;
}
