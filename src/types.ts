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
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  linkedNoteIds?: string[];
  linkedTaskIds?: string[];
  linkedTimelineEventIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface IOCTarget {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
}

export interface TaskComment {
  id: string;
  text: string;
  createdAt: number;
}

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in-progress' | 'done';

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
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  comments?: TaskComment[];
  linkedNoteIds?: string[];
  linkedTaskIds?: string[];
  linkedTimelineEventIds?: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Folder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  order: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type ViewMode = 'notes' | 'tasks' | 'timeline' | 'whiteboard' | 'activity' | 'graph';
export type EditorMode = 'edit' | 'preview' | 'split';
export type TaskViewMode = 'list' | 'kanban';

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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultView: 'notes',
  editorMode: 'split',
  sidebarCollapsed: false,
  taskViewMode: 'list',
};

// IOC Analysis types
export type IOCType =
  | 'ipv4' | 'ipv6' | 'domain' | 'url' | 'email'
  | 'md5' | 'sha1' | 'sha256'
  | 'cve' | 'mitre-attack' | 'yara-rule' | 'sigma-rule' | 'file-path';

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
  relatedId?: string;          // deprecated — use relationships[]
  relationshipType?: string;   // deprecated — use relationships[]
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
export type TimelineEventType =
  | 'initial-access' | 'execution' | 'persistence' | 'privilege-escalation'
  | 'defense-evasion' | 'credential-access' | 'discovery' | 'lateral-movement'
  | 'collection' | 'exfiltration' | 'command-and-control' | 'impact'
  | 'detection' | 'containment' | 'eradication' | 'recovery'
  | 'communication' | 'evidence'
  | 'other';

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
  iocAnalysis?: IOCAnalysis;
  iocTypes?: IOCType[];
  createdAt: number;
  updatedAt: number;
}

export interface Timeline {
  id: string;
  name: string;
  description?: string;
  color?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Whiteboard {
  id: string;
  name: string;
  elements: string;     // JSON.stringify(ExcalidrawElement[])
  appState?: string;    // JSON.stringify({zoom, scrollX, scrollY, theme})
  folderId?: string;
  tags: string[];
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface TimelineExportData {
  format: 'browsernotes-timeline';
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

// OCI Sync types
export interface SharedItemEnvelope {
  version: 1;
  type: 'note' | 'clip' | 'ioc-report' | 'full-backup';
  sharedBy: string;
  sharedAt: number;
  payload: Note | Note[] | Task[] | ExportData;
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
}

export const TAG_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f97316', '#ef4444',
  '#ec4899', '#a855f7',
];

// Activity Log types
export type ActivityCategory =
  | 'note' | 'task' | 'timeline' | 'whiteboard'
  | 'folder' | 'tag' | 'ioc' | 'sync' | 'data';

export type ActivityAction =
  | 'create' | 'update' | 'delete'
  | 'trash' | 'restore' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'empty-trash'
  | 'complete' | 'reopen'
  | 'star' | 'unstar'
  | 'analyze' | 'dismiss' | 'push-iocs'
  | 'export' | 'import' | 'share' | 'backup' | 'share-ioc-report'
  | 'rename';

export interface ActivityLogEntry {
  id: string;
  action: ActivityAction;
  category: ActivityCategory;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  timestamp: number;
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, { label: string; color: string }> = {
  note:       { label: 'Note',       color: '#3b82f6' },
  task:       { label: 'Task',       color: '#22c55e' },
  timeline:   { label: 'Timeline',   color: '#f97316' },
  whiteboard: { label: 'Whiteboard', color: '#a855f7' },
  folder:     { label: 'Folder',     color: '#eab308' },
  tag:        { label: 'Tag',        color: '#ec4899' },
  ioc:        { label: 'IOC',        color: '#ef4444' },
  sync:       { label: 'Sync',       color: '#06b6d4' },
  data:       { label: 'Data',       color: '#6366f1' },
};
