// ─── Bot System Types ────────────────────────────────────────────

export type BotType = 'enrichment' | 'feed' | 'monitor' | 'triage' | 'report' | 'correlation' | 'ai-agent' | 'integration' | 'custom';

export type BotTriggerType = 'event' | 'schedule' | 'webhook' | 'manual';

export type BotRunStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';

export type BotCapability =
  | 'read_entities'       // search, list, read notes/tasks/IOCs/events
  | 'create_entities'     // create notes, tasks, IOCs, timeline events
  | 'update_entities'     // update existing entities
  | 'post_to_feed'        // post to CaddyShack
  | 'notify_users'        // send notifications
  | 'call_external_apis'  // make outbound HTTP requests
  | 'cross_investigation' // search/read across investigations
  | 'execute_remote'      // SSH commands, SOAR playbook triggers
  | 'run_code';           // execute code in sandboxed Docker containers

export interface BotEvent {
  type: BotEventType;
  table?: string;
  entityId?: string;
  folderId?: string;
  userId?: string;       // who triggered the event (human or bot)
  data?: Record<string, unknown>;
  timestamp: Date;
  depth?: number;        // event chain depth — prevents infinite mutual bot loops
  originBotIds?: string[];  // tracks all bots in the event chain to prevent amplification
}

export type BotEventType =
  | 'entity.created'
  | 'entity.updated'
  | 'entity.deleted'
  | 'investigation.created'
  | 'investigation.closed'
  | 'investigation.archived'
  | 'post.created'
  | 'member.added'
  | 'member.removed'
  | 'webhook.received';

export interface BotTriggerConfig {
  events?: BotEventType[];
  eventFilters?: {
    tables?: string[];           // only trigger for these entity tables
    folderIds?: string[];        // only trigger for these investigations
    iocTypes?: string[];         // only trigger for these IOC types (for enrichment)
  };
  schedule?: string;             // cron expression (e.g., '0 */6 * * *')
  webhook?: boolean;             // accept inbound webhooks
}

export interface BotConfig {
  id: string;
  userId: string;                // FK to users (the bot's user account)
  type: BotType;
  name: string;
  description: string;
  enabled: boolean;
  triggers: BotTriggerConfig;
  config: Record<string, unknown>;  // bot-specific settings (encrypted secrets within)
  capabilities: BotCapability[];
  allowedDomains: string[];      // outbound HTTP domain allowlist
  scopeType: 'global' | 'investigation';
  scopeFolderIds: string[];      // which investigations this bot can access
  rateLimitPerHour: number;
  rateLimitPerDay: number;
  lastRunAt: Date | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
  createdBy: string;             // admin who created the bot
  createdAt: Date;
  updatedAt: Date;
}

export interface BotRunLogEntry {
  ts: number;
  type: string;      // 'tool_call' | 'tool_result' | 'llm_response' | 'error'
  name?: string;     // tool name
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  text?: string;     // LLM response text
}

export interface BotRun {
  id: string;
  botConfigId: string;
  status: BotRunStatus;
  trigger: BotTriggerType;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  error: string | null;
  entitiesCreated: number;
  entitiesUpdated: number;
  apiCallsMade: number;
  log: BotRunLogEntry[];
  createdAt: Date;
}

/** Context provided to a bot during execution */
export interface BotContext {
  botConfig: BotConfig;
  botUserId: string;
  runId: string;
  trigger: BotTriggerType;
  event?: BotEvent;

  // Counters (tracked by runtime, written to bot_runs on completion)
  entitiesCreated: number;
  entitiesUpdated: number;
  apiCallsMade: number;

  // Execution log entries (written to bot_runs.log on completion)
  log: BotRunLogEntry[];

  /** Abort signal — bot must check this and stop when aborted */
  signal: AbortSignal;
}

/** Interface that all bot implementations must satisfy */
export interface Bot {
  readonly id: string;
  readonly name: string;
  readonly type: BotType;

  /** Called once when the bot is loaded */
  onInit(config: BotConfig): Promise<void>;

  /** Called when the bot is being unloaded */
  onDestroy(): Promise<void>;

  /** Handle an event trigger */
  onEvent?(ctx: BotContext, event: BotEvent): Promise<void>;

  /** Handle a scheduled trigger */
  onSchedule?(ctx: BotContext): Promise<void>;

  /** Handle a webhook trigger */
  onWebhook?(ctx: BotContext, payload: Record<string, unknown>): Promise<void>;
}
