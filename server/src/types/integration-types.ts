// ─── Server-side Integration Types ──────────────────────────────
// Mirror of client-side types, adapted for the server runtime.
// DO NOT import from the client — the server has its own type space.

export type IntegrationCategory = 'enrichment' | 'threat-feed' | 'siem-soar' | 'notification' | 'export' | 'pipeline' | 'utility';

export type IntegrationTriggerType = 'manual' | 'on-entity-create' | 'on-entity-update' | 'scheduled' | 'webhook';

export interface IntegrationTrigger {
  type: IntegrationTriggerType;
  iocTypes?: string[];
  entityTables?: string[];
  schedule?: string;
}

export interface IntegrationConfigField {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'password' | 'number' | 'boolean' | 'select' | 'multi-select';
  required: boolean;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  secret?: boolean;
}

// === Step Types ===

export type IntegrationStepType = 'http' | 'transform' | 'condition' | 'loop' | 'create-entity' | 'update-entity' | 'delay' | 'set-variable';

export interface StepBase {
  id: string;
  type: IntegrationStepType;
  label: string;
  continueOnError?: boolean;
  condition?: string;
}

export interface HttpStep extends StepBase {
  type: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  contentType?: 'json' | 'form' | 'text';
  timeout?: number;
  responseType?: 'json' | 'text';
  retry?: { maxRetries: number; retryOn: number[]; backoffMs: number };
  pagination?: { type: 'offset' | 'cursor' | 'link-header'; nextExpression: string; maxPages: number; resultsPath: string };
}

export type TransformOp =
  | { op: 'extract'; path: string; as: string }
  | { op: 'map'; path: string; template: Record<string, string>; as: string }
  | { op: 'filter'; path: string; condition: string; as: string }
  | { op: 'flatten'; path: string; as: string }
  | { op: 'join'; path: string; separator: string; as: string }
  | { op: 'template'; template: string; as: string }
  | { op: 'lookup'; path: string; map: Record<string, string>; default?: string; as: string };

export interface TransformStep extends StepBase {
  type: 'transform';
  input: string;
  operations: TransformOp[];
}

export interface ConditionStep extends StepBase {
  type: 'condition';
  expression: string;
  thenSteps: string[];
  elseSteps?: string[];
}

export interface LoopStep extends StepBase {
  type: 'loop';
  items: string;
  itemVariable: string;
  indexVariable?: string;
  bodySteps: string[];
  maxIterations?: number;
  delayMs?: number;
}

export interface CreateEntityStep extends StepBase {
  type: 'create-entity';
  entityType: 'ioc' | 'note' | 'task' | 'timeline-event';
  fields: Record<string, unknown>;
}

export interface UpdateEntityStep extends StepBase {
  type: 'update-entity';
  entityId: string;
  entityType: 'ioc' | 'note' | 'task' | 'timeline-event';
  fields: Record<string, unknown>;
}

export interface DelayStep extends StepBase {
  type: 'delay';
  ms: number;
}

export interface SetVariableStep extends StepBase {
  type: 'set-variable';
  variables: Record<string, string>;
}

export type IntegrationStep = HttpStep | TransformStep | ConditionStep | LoopStep | CreateEntityStep | UpdateEntityStep | DelayStep | SetVariableStep;

// === Output Routing ===

export type IntegrationOutputType = 'create-ioc' | 'update-ioc' | 'create-note' | 'create-task' | 'create-timeline-event' | 'notify' | 'post-to-feed' | 'display';

export interface IntegrationOutput {
  type: IntegrationOutputType;
  condition?: string;
  template: Record<string, unknown>;
}

// === Template (the shareable definition) ===

export interface IntegrationTemplate {
  id: string;
  schemaVersion: '1.0';
  version: string;
  name: string;
  description: string;
  author: string;
  license?: string;
  icon: string;
  color: string;
  category: IntegrationCategory;
  tags: string[];
  triggers: IntegrationTrigger[];
  configSchema: IntegrationConfigField[];
  steps: IntegrationStep[];
  outputs: IntegrationOutput[];
  rateLimit?: { maxPerHour: number; maxPerDay: number };
  requiredDomains: string[];
  minVersion?: string;
  source: 'builtin' | 'user' | 'team' | 'community';
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// === Installed Integration (user's instance with config) ===

export interface InstalledIntegration {
  id: string;
  templateId: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  scopeType: 'all' | 'investigation';
  scopeFolderIds: string[];
  lastRunAt?: number;
  lastError?: string;
  runCount: number;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
}

// === Run Record ===

export type IntegrationRunStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';

export interface IntegrationRunLogEntry {
  ts: number;
  stepId: string;
  stepLabel: string;
  type: 'step-start' | 'step-complete' | 'step-error' | 'http-request' | 'http-response' | 'entity-created' | 'variable-set';
  detail?: string;
  durationMs?: number;
}

export interface IntegrationRun {
  id: string;
  integrationId: string;
  templateId: string;
  status: IntegrationRunStatus;
  trigger: IntegrationTriggerType;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  error?: string;
  entitiesCreated: number;
  entitiesUpdated: number;
  apiCallsMade: number;
  log: IntegrationRunLogEntry[];
  displayResults?: unknown;
  createdAt: number;
}
