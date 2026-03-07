import type { BotExecutionContext } from './bot-context.js';
import type { BotCapability } from './types.js';

// ─── BotTool interface ──────────────────────────────────────────
// Each tool wraps a BotExecutionContext method with a JSON Schema
// for the LLM to call, plus an execute function that runs it.

export interface BotTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  execute(args: Record<string, unknown>, ctx: BotExecutionContext): Promise<unknown>;
}

// ─── Tool Definitions ───────────────────────────────────────────

const searchNotesTool: BotTool = {
  name: 'search_notes',
  description: 'Search notes in an investigation by keyword. Returns matching note titles and snippets.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID to search within' },
      query: { type: 'string', description: 'Search query (matched against title and content)' },
      limit: { type: 'number', description: 'Max results (default 20, max 100)' },
    },
    required: ['folderId', 'query'],
  },
  async execute(args, ctx) {
    return ctx.searchNotes(args.folderId as string, args.query as string, (args.limit as number) || 20);
  },
};

const readNoteTool: BotTool = {
  name: 'read_note',
  description: 'Read the full content of a note by its ID.',
  parameters: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: 'The note ID to read' },
    },
    required: ['noteId'],
  },
  async execute(args, ctx) {
    return ctx.readNote(args.noteId as string);
  },
};

const listIOCsTool: BotTool = {
  name: 'list_iocs',
  description: 'List IOCs (Indicators of Compromise) in an investigation. Optionally filter by type (ip, domain, hash, url, email, etc).',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      typeFilter: { type: 'string', description: 'IOC type filter (e.g., "ip", "domain", "hash")' },
      limit: { type: 'number', description: 'Max results (default 500)' },
    },
    required: ['folderId'],
  },
  async execute(args, ctx) {
    return ctx.listIOCs(args.folderId as string, args.typeFilter as string | undefined, (args.limit as number) || 500);
  },
};

const listTasksTool: BotTool = {
  name: 'list_tasks',
  description: 'List tasks in an investigation. Optionally filter by status (todo, in-progress, done).',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      statusFilter: { type: 'string', description: 'Status filter: "todo", "in-progress", or "done"' },
      limit: { type: 'number', description: 'Max results (default 500)' },
    },
    required: ['folderId'],
  },
  async execute(args, ctx) {
    return ctx.listTasks(args.folderId as string, args.statusFilter as string | undefined, (args.limit as number) || 500);
  },
};

const listTimelineEventsTool: BotTool = {
  name: 'list_timeline_events',
  description: 'List timeline events in an investigation.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      limit: { type: 'number', description: 'Max results (default 500)' },
    },
    required: ['folderId'],
  },
  async execute(args, ctx) {
    return ctx.listTimelineEvents(args.folderId as string, (args.limit as number) || 500);
  },
};

const getInvestigationTool: BotTool = {
  name: 'get_investigation',
  description: 'Get details of an investigation (folder) by its ID.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
    },
    required: ['folderId'],
  },
  async execute(args, ctx) {
    return ctx.getInvestigation(args.folderId as string);
  },
};

const listInvestigationsTool: BotTool = {
  name: 'list_investigations',
  description: 'List all investigations the bot has access to.',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    return ctx.listInvestigations();
  },
};

const searchAcrossInvestigationsTool: BotTool = {
  name: 'search_across_investigations',
  description: 'Search IOC values across all investigations the bot has access to. Requires cross_investigation capability.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'IOC value to search for' },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    return ctx.searchAcrossInvestigations(args.query as string);
  },
};

const createNoteTool: BotTool = {
  name: 'create_note',
  description: 'Create a new note in an investigation.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      title: { type: 'string', description: 'Note title' },
      content: { type: 'string', description: 'Note content (markdown supported)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
    },
    required: ['folderId', 'title', 'content'],
  },
  async execute(args, ctx) {
    const id = await ctx.createNote(
      args.folderId as string,
      args.title as string,
      args.content as string,
      (args.tags as string[]) || [],
    );
    return { id, created: true };
  },
};

const createIOCTool: BotTool = {
  name: 'create_ioc',
  description: 'Create a new IOC (Indicator of Compromise) in an investigation.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      type: { type: 'string', description: 'IOC type: ip, domain, hash, url, email, etc.' },
      value: { type: 'string', description: 'The IOC value' },
      confidence: { type: 'string', description: 'Confidence level: low, medium, high (default medium)' },
      analystNotes: { type: 'string', description: 'Optional analyst notes' },
    },
    required: ['folderId', 'type', 'value'],
  },
  async execute(args, ctx) {
    const id = await ctx.createIOC(
      args.folderId as string,
      args.type as string,
      args.value as string,
      (args.confidence as string) || 'medium',
      args.analystNotes as string | undefined,
    );
    return { id, created: true };
  },
};

const createTaskTool: BotTool = {
  name: 'create_task',
  description: 'Create a new task in an investigation.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Task description' },
      priority: { type: 'string', description: 'Priority: none, low, medium, high (default none)' },
    },
    required: ['folderId', 'title'],
  },
  async execute(args, ctx) {
    const id = await ctx.createTask(
      args.folderId as string,
      args.title as string,
      args.description as string | undefined,
      (args.priority as string) || 'none',
    );
    return { id, created: true };
  },
};

const createTimelineEventTool: BotTool = {
  name: 'create_timeline_event',
  description: 'Create a new timeline event in an investigation.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Investigation folder ID' },
      title: { type: 'string', description: 'Event title' },
      eventType: { type: 'string', description: 'Event type (e.g., "phishing", "malware", "lateral-movement")' },
      timestamp: { type: 'string', description: 'ISO 8601 timestamp for when the event occurred' },
      description: { type: 'string', description: 'Event description' },
      source: { type: 'string', description: 'Source of the event info' },
      confidence: { type: 'string', description: 'Confidence level: low, medium, high' },
    },
    required: ['folderId', 'title', 'eventType', 'timestamp'],
  },
  async execute(args, ctx) {
    const id = await ctx.createTimelineEvent(
      args.folderId as string,
      args.title as string,
      args.eventType as string,
      new Date(args.timestamp as string),
      {
        description: args.description as string | undefined,
        source: args.source as string | undefined,
        confidence: args.confidence as string | undefined,
      },
    );
    return { id, created: true };
  },
};

const postToFeedTool: BotTool = {
  name: 'post_to_feed',
  description: 'Post a message to the CaddyShack feed. Optionally scoped to an investigation.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Post content (markdown supported)' },
      folderId: { type: 'string', description: 'Optional investigation folder ID to scope the post' },
    },
    required: ['content'],
  },
  async execute(args, ctx) {
    const id = await ctx.postToFeed(args.content as string, args.folderId as string | undefined);
    return { id, posted: true };
  },
};

const notifyUserTool: BotTool = {
  name: 'notify_user',
  description: 'Send a notification to a specific user.',
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User ID to notify' },
      message: { type: 'string', description: 'Notification message' },
      folderId: { type: 'string', description: 'Optional investigation context' },
    },
    required: ['userId', 'message'],
  },
  async execute(args, ctx) {
    await ctx.notifyUser(args.userId as string, args.message as string, args.folderId as string | undefined);
    return { notified: true };
  },
};

const fetchUrlTool: BotTool = {
  name: 'fetch_url',
  description: 'Fetch data from an external URL (must be in the bot\'s allowed domains list). Returns the response body as text or JSON.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch (must be in allowed domains)' },
      method: { type: 'string', description: 'HTTP method (default GET)' },
      headers: { type: 'object', description: 'Additional request headers' },
      body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
    },
    required: ['url'],
  },
  async execute(args, ctx) {
    const opts: RequestInit = {};
    if (args.method) opts.method = args.method as string;
    if (args.headers) opts.headers = args.headers as Record<string, string>;
    if (args.body) opts.body = args.body as string;

    const response = await ctx.fetchExternal(args.url as string, opts);
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      // Truncate large text responses for the LLM context
      data = text.length > 10000 ? text.slice(0, 10000) + '\n... [truncated]' : text;
    }
    return { status: response.status, data };
  },
};

// ─── Capability → Tool mapping ──────────────────────────────────

const CAPABILITY_TOOLS: Array<{ capability: BotCapability; tools: BotTool[] }> = [
  {
    capability: 'read_entities',
    tools: [searchNotesTool, readNoteTool, listIOCsTool, listTasksTool, listTimelineEventsTool, getInvestigationTool, listInvestigationsTool],
  },
  {
    capability: 'create_entities',
    tools: [createNoteTool, createIOCTool, createTaskTool, createTimelineEventTool],
  },
  {
    capability: 'post_to_feed',
    tools: [postToFeedTool],
  },
  {
    capability: 'notify_users',
    tools: [notifyUserTool],
  },
  {
    capability: 'call_external_apis',
    tools: [fetchUrlTool],
  },
  {
    capability: 'cross_investigation',
    tools: [searchAcrossInvestigationsTool],
  },
];

/**
 * Build the set of tools available to a bot based on its capabilities.
 * Returns a deduplicated list — tools are only included if the bot has
 * the corresponding capability.
 */
export function getToolsForCapabilities(capabilities: BotCapability[]): BotTool[] {
  const tools: BotTool[] = [];
  const seen = new Set<string>();

  for (const entry of CAPABILITY_TOOLS) {
    if (!capabilities.includes(entry.capability)) continue;
    for (const tool of entry.tools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        tools.push(tool);
      }
    }
  }

  return tools;
}

/**
 * Convert BotTool[] to the Anthropic tool format for the Messages API.
 */
export function toAnthropicTools(tools: BotTool[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.parameters },
  }));
}

/**
 * Convert BotTool[] to the OpenAI tool format for the Chat Completions API.
 */
export function toOpenAITools(tools: BotTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
