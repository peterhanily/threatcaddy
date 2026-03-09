// ── LLM Tool Definitions (Anthropic format) ────────────────────────────

export const TOOL_DEFINITIONS = [
  // ── Read tools ─────────────────────────────────────────────────
  {
    name: 'search_notes',
    description: 'Search notes by keyword. Returns titles, snippets, and IDs of matching notes in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_all',
    description: 'Search across all entity types (notes, tasks, IOCs, timeline events) simultaneously. Returns matching entities grouped by type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results per entity type (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Get the full content of a specific note by its ID or title.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Note ID' },
        title: { type: 'string', description: 'Note title (exact or partial match). Used if id is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the current investigation, optionally filtered by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'Filter by task status' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'list_iocs',
    description: 'List standalone IOCs (indicators of compromise) in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Filter by IOC type (e.g. ipv4, domain, sha256)' },
        limit: { type: 'number', description: 'Max results (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'list_timeline_events',
    description: 'List timeline events in the current investigation with optional filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        eventType: { type: 'string', description: 'Filter by event type (e.g. initial-access, execution, detection)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_investigation_summary',
    description: 'Get entity counts and metadata for the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'analyze_graph',
    description: 'Analyze the entity relationship graph for the current investigation. Returns node/edge counts, most connected entities, IOC clusters, and optionally the shortest path between two entities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pathFrom: { type: 'string', description: 'Entity ID to find path from (optional). Use format like "note:ID", "task:ID", or "ioc:type:value".' },
        pathTo: { type: 'string', description: 'Entity ID to find path to (optional). Same format as pathFrom.' },
      },
      required: [],
    },
  },

  // ── Write tools ────────────────────────────────────────────────
  {
    name: 'create_note',
    description: 'Create a new note in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content (markdown supported)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'update_note',
    description: 'Update an existing note by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Note ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New content (optional, replaces entire content)' },
        appendContent: { type: 'string', description: 'Text to append to existing content (optional, alternative to content)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (optional, replaces all tags)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Priority level (default: none)' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'Status (default: todo)' },
        assigneeId: { type: 'string', description: 'User ID to assign the task to (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'New status (optional)' },
        priority: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'New priority (optional)' },
        assigneeId: { type: 'string', description: 'User ID to assign the task to (optional, empty string to unassign)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_ioc',
    description: 'Create a standalone IOC (indicator of compromise) in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['ipv4','ipv6','domain','url','email','md5','sha1','sha256','cve','mitre-attack','yara-rule','sigma-rule','file-path'], description: 'IOC type' },
        value: { type: 'string', description: 'IOC value' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high', 'confirmed'], description: 'Confidence level (default: medium)' },
        analystNotes: { type: 'string', description: 'Optional analyst notes' },
      },
      required: ['type', 'value'],
    },
  },
  {
    name: 'bulk_create_iocs',
    description: 'Create multiple standalone IOCs at once. Useful when processing threat reports or bulk indicator lists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        iocs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'IOC type' },
              value: { type: 'string', description: 'IOC value' },
              confidence: { type: 'string', description: 'Confidence level (default: medium)' },
              analystNotes: { type: 'string', description: 'Optional analyst notes' },
            },
            required: ['type', 'value'],
          },
          description: 'Array of IOCs to create',
        },
      },
      required: ['iocs'],
    },
  },
  {
    name: 'create_timeline_event',
    description: 'Create a new timeline event in the current investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description' },
        timestamp: { type: 'string', description: 'ISO 8601 date string (e.g. 2025-01-15T14:30:00Z)' },
        eventType: { type: 'string', enum: [
          'initial-access','execution','persistence','privilege-escalation',
          'defense-evasion','credential-access','discovery','lateral-movement',
          'collection','exfiltration','command-and-control','impact',
          'detection','containment','eradication','recovery',
          'communication','evidence','other'
        ], description: 'Event type (default: other)' },
        source: { type: 'string', description: 'Source of the event' },
        latitude: { type: 'number', description: 'WGS84 latitude (-90 to 90)' },
        longitude: { type: 'number', description: 'WGS84 longitude (-180 to 180)' },
      },
      required: ['title', 'timestamp'],
    },
  },
  {
    name: 'link_entities',
    description: 'Create cross-references between entities. Links are bidirectional where applicable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceType: { type: 'string', enum: ['note', 'task', 'timeline-event'], description: 'Source entity type' },
              sourceId: { type: 'string', description: 'Source entity ID' },
              targetType: { type: 'string', enum: ['note', 'task', 'timeline-event'], description: 'Target entity type' },
              targetId: { type: 'string', description: 'Target entity ID' },
            },
            required: ['sourceType', 'sourceId', 'targetType', 'targetId'],
          },
          description: 'Array of entity links to create',
        },
      },
      required: ['links'],
    },
  },
  {
    name: 'generate_report',
    description: 'Generate a structured investigation report as a new note. Includes executive summary, key findings, IOC table, timeline summary, and recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Report title (default: "Investigation Report")' },
        includeIOCTable: { type: 'boolean', description: 'Include IOC summary table (default: true)' },
        includeTimeline: { type: 'boolean', description: 'Include timeline summary (default: true)' },
        includeTaskStatus: { type: 'boolean', description: 'Include task status summary (default: true)' },
        executiveSummary: { type: 'string', description: 'Executive summary text (AI should write this based on investigation context)' },
        findings: { type: 'string', description: 'Key findings section (markdown)' },
        recommendations: { type: 'string', description: 'Recommendations section (markdown)' },
      },
      required: ['executiveSummary', 'findings'],
    },
  },

  // ── Web tools ────────────────────────────────────────────────
  {
    name: 'fetch_url',
    description: 'Fetch and extract readable text content from a URL (requires browser extension with URL-fetching permission enabled). Returns the page title and content converted to markdown. Use this when the user provides a URL and wants you to read, summarize, or extract information from it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to fetch (must be http or https)' },
      },
      required: ['url'],
    },
  },

  // ── Analysis tools ─────────────────────────────────────────────
  {
    name: 'extract_iocs',
    description: 'Run IOC (indicator of compromise) extraction on the given text. Extracts IPs, domains, URLs, hashes, CVEs, MITRE ATT&CK IDs, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to extract IOCs from' },
      },
      required: ['text'],
    },
  },

  // ── Global investigation tools ─────────────────────────────────
  {
    name: 'list_investigations',
    description: 'List all investigations (folders) with their status, entity counts, and metadata. Use this to get an overview of all active cases.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['active', 'closed', 'archived'], description: 'Filter by investigation status (default: all)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_investigation_details',
    description: 'Get detailed summary of a specific investigation by ID or name, including entity counts, task status breakdown, recent activity, and top IOCs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Investigation (folder) ID' },
        name: { type: 'string', description: 'Investigation name (partial match). Used if id is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'search_across_investigations',
    description: 'Search for entities across ALL investigations simultaneously. Returns results grouped by investigation. Useful for finding patterns, shared IOCs, or related activity across cases.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        entityTypes: { type: 'array', items: { type: 'string', enum: ['notes', 'tasks', 'iocs', 'events'] }, description: 'Entity types to search (default: all)' },
        limit: { type: 'number', description: 'Max results per investigation (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_in_investigation',
    description: 'Create an entity (note, task, IOC, or timeline event) in a specific investigation by ID or name. Use this when you need to create entities outside the currently selected investigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        investigationId: { type: 'string', description: 'Target investigation (folder) ID' },
        investigationName: { type: 'string', description: 'Target investigation name (partial match). Used if investigationId is not provided.' },
        entityType: { type: 'string', enum: ['note', 'task', 'ioc', 'timeline-event'], description: 'Type of entity to create' },
        data: {
          type: 'object',
          description: 'Entity data. For notes: {title, content}. For tasks: {title, description, priority, status}. For IOCs: {type, value, confidence, analystNotes}. For timeline events: {title, description, timestamp, eventType, source}.',
        },
      },
      required: ['entityType', 'data'],
    },
  },
  {
    name: 'compare_investigations',
    description: 'Compare two or more investigations side by side. Shows shared IOCs, common TTPs, overlapping timelines, and entity count comparison.',
    input_schema: {
      type: 'object' as const,
      properties: {
        investigationIds: { type: 'array', items: { type: 'string' }, description: 'Array of investigation (folder) IDs to compare' },
      },
      required: ['investigationIds'],
    },
  },
];

// ── Write tool classification ──────────────────────────────────────────

const WRITE_TOOLS = new Set([
  'create_note', 'update_note',
  'create_task', 'update_task',
  'create_ioc', 'bulk_create_iocs',
  'create_timeline_event',
  'link_entities',
  'generate_report',
  'create_in_investigation',
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}
