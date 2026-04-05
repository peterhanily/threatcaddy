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
    name: 'read_task',
    description: 'Get the full details of a specific task by its ID or title, including description, comments, priority, status, and assignee.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task ID' },
        title: { type: 'string', description: 'Task title (exact or partial match). Used if id is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'read_ioc',
    description: 'Get the full details of a specific IOC by its ID or value, including analyst notes, attribution, relationships, subtype, and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'IOC ID' },
        value: { type: 'string', description: 'IOC value (exact or partial match). Used if id is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'read_timeline_event',
    description: 'Get the full details of a specific timeline event by its ID or title, including description, MITRE ATT&CK mappings, actor, assets, and geolocation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Timeline event ID' },
        title: { type: 'string', description: 'Event title (exact or partial match). Used if id is not provided.' },
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
    name: 'update_ioc',
    description: 'Update an existing standalone IOC by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'IOC ID to update' },
        type: { type: 'string', enum: ['ipv4','ipv6','domain','url','email','md5','sha1','sha256','cve','mitre-attack','yara-rule','sigma-rule','file-path'], description: 'New IOC type (optional)' },
        value: { type: 'string', description: 'New IOC value (optional)' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high', 'confirmed'], description: 'New confidence level (optional)' },
        analystNotes: { type: 'string', description: 'New analyst notes (optional)' },
        attribution: { type: 'string', description: 'Threat actor or campaign attribution (optional)' },
        iocSubtype: { type: 'string', description: 'IOC subtype e.g. C2 Server, Phishing URL (optional)' },
        iocStatus: { type: 'string', description: 'IOC status e.g. active, resolved, false-positive (optional)' },
      },
      required: ['id'],
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
    name: 'update_timeline_event',
    description: 'Update an existing timeline event by ID. Only the provided fields are modified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Timeline event ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        timestamp: { type: 'string', description: 'New ISO 8601 timestamp (optional)' },
        eventType: { type: 'string', enum: [
          'initial-access','execution','persistence','privilege-escalation',
          'defense-evasion','credential-access','discovery','lateral-movement',
          'collection','exfiltration','command-and-control','impact',
          'detection','containment','eradication','recovery',
          'communication','evidence','other'
        ], description: 'New event type (optional)' },
        source: { type: 'string', description: 'New source (optional)' },
        actor: { type: 'string', description: 'Threat actor name (optional)' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high', 'confirmed'], description: 'New confidence level (optional)' },
        latitude: { type: 'number', description: 'WGS84 latitude -90 to 90 (optional)' },
        longitude: { type: 'number', description: 'WGS84 longitude -180 to 180 (optional)' },
      },
      required: ['id'],
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
  // ── Integration / Enrichment tools ──────────────────────────────────
  {
    name: 'enrich_ioc',
    description: 'Run configured vendor integrations (VirusTotal, AbuseIPDB, Shodan, etc.) to enrich an IOC. Automatically finds matching integrations for the IOC type and runs them. Returns enrichment results. This is preferred over manual fetch_url for IOCs when integrations are configured.',
    input_schema: {
      type: 'object' as const,
      properties: {
        iocId: { type: 'string', description: 'ID of the IOC to enrich (from list_iocs or read_ioc)' },
      },
      required: ['iocId'],
    },
  },
  {
    name: 'list_integrations',
    description: 'List available vendor integrations and their status (enabled/disabled, last run, etc.). Shows what enrichment sources are configured.',
    input_schema: {
      type: 'object' as const,
      properties: {
        iocType: { type: 'string', description: 'Filter by IOC type (ipv4, domain, url, md5, sha256, etc.)' },
      },
      required: [],
    },
  },
  {
    name: 'forensicate_scan',
    description: 'Scan text for prompt injection patterns using Forensicate.ai detection rules (keyword, regex, heuristic, NLP). Returns confidence score, matched rules, and attack complexity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to scan for prompt injection, jailbreak attempts, or adversarial inputs' },
        threshold: { type: 'number', description: 'Confidence threshold 0-100. Only rules at or above are reported. Default: 0' },
      },
      required: ['text'],
    },
  },
  // ── Agent knowledge / long-term memory ─────────────────────────────
  {
    name: 'update_knowledge',
    description: 'Store a key-value entry in the investigation knowledge base. Use to record persistent findings, hypotheses, confirmed facts, or important context that should be available in future cycles. Knowledge persists across all agent cycles.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Knowledge key — descriptive name (e.g. "confirmed_c2_servers", "attacker_attribution", "timeline_gaps")' },
        value: { type: 'string', description: 'Knowledge value — the information to store' },
        category: { type: 'string', enum: ['finding', 'hypothesis', 'fact', 'context', 'decision'], description: 'Category of knowledge (default finding)' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall_knowledge',
    description: 'Retrieve entries from the investigation knowledge base. Returns all stored knowledge or filtered by key/category. Use at the start of each cycle to refresh your understanding.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Specific key to recall (optional — omit for all knowledge)' },
        category: { type: 'string', description: 'Filter by category (optional)' },
      },
      required: [],
    },
  },
  // ── External system integration ───────────────────────────────────
  {
    name: 'run_remote_command',
    description: 'Execute a command on a remote host via SSH through the team server. Requires server connection and host to be in the allowed hosts list. Use for live forensics, log collection, containment actions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        host: { type: 'string', description: 'Hostname or IP address of the target system' },
        command: { type: 'string', description: 'Shell command to execute (read-only commands preferred for safety)' },
        reason: { type: 'string', description: 'Why this command needs to run — logged for audit trail' },
      },
      required: ['host', 'command', 'reason'],
    },
  },
  {
    name: 'query_siem',
    description: 'Query a SIEM or log management system (Splunk, Elastic, Sentinel) via its API. Searches for events matching a query within a time range. Configure SIEM endpoint in Settings > Integrations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query in the SIEM\'s query language (SPL, KQL, Lucene)' },
        timeRange: { type: 'string', description: 'Time range: "1h", "24h", "7d", or ISO date range "2024-01-01/2024-01-02"' },
        maxResults: { type: 'number', description: 'Maximum results to return (default 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_ticket',
    description: 'Create a ticket in an external system (Jira, ServiceNow, etc.) for tracking remediation, escalation, or follow-up actions. Configure ticketing endpoint in Settings > Integrations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Ticket title/summary' },
        description: { type: 'string', description: 'Detailed description of the issue and required action' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Ticket priority' },
        assignee: { type: 'string', description: 'Who to assign the ticket to (optional)' },
        labels: { type: 'string', description: 'Comma-separated labels/tags for the ticket' },
      },
      required: ['title', 'description'],
    },
  },
  // ── Alert Ingestion ──────────────────────────────────────────────
  {
    name: 'ingest_alert',
    description: 'Ingest an external alert into the current investigation. Creates a pinned alert note and optionally extracts IOCs. Use when processing alerts from SIEM, email, or other sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Alert source system (e.g. splunk, elastic, sentinel, email)' },
        title: { type: 'string', description: 'Alert title/summary' },
        description: { type: 'string', description: 'Full alert description or body text' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Alert severity' },
        raw_data: { type: 'string', description: 'Raw alert payload as JSON string (optional)' },
      },
      required: ['source', 'title'],
    },
  },
  // ── Folder Management ───────────────────────────────────────────
  {
    name: 'create_note_folder',
    description: 'Create a folder to organize notes in the current investigation. Returns the folder note ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Folder name' },
        icon: { type: 'string', description: 'Emoji icon for the folder (default: 📁)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_note_folder',
    description: 'Delete a note folder. Choose whether to trash all notes inside it or move them out to the top level.',
    input_schema: {
      type: 'object' as const,
      properties: {
        folderId: { type: 'string', description: 'ID of the folder note to delete' },
        action: { type: 'string', enum: ['trash_contents', 'move_out'], description: 'What to do with notes inside: trash_contents = trash them all, move_out = move to top level (default: move_out)' },
      },
      required: ['folderId'],
    },
  },
  {
    name: 'move_to_folder',
    description: 'Move a note into a folder, or out to the top level. Use parentFolderId: null to move a note out of its folder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        noteId: { type: 'string', description: 'ID of the note to move' },
        parentFolderId: { type: 'string', description: 'ID of the target folder note, or null/empty to move to top level' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'list_folders',
    description: 'List all note folders in the current investigation with their names and child note counts.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Delegation tools (Lead agent only) ─────────────────────────────────

export const DELEGATION_TOOL_DEFINITIONS = [
  {
    name: 'delegate_task',
    description: 'Create a task delegated to a specific specialist agent. Only available to Lead Analyst agents. The specialist will see this task on their next cycle.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title describing what needs to be done' },
        description: { type: 'string', description: 'Detailed instructions for the specialist agent' },
        assignToProfile: { type: 'string', description: 'Name of the agent profile to assign to (e.g. "IOC Enricher", "Timeline Builder")' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority (default medium)' },
      },
      required: ['title', 'description', 'assignToProfile'],
    },
  },
  {
    name: 'review_completed_task',
    description: 'Review a completed task for quality. If quality is poor, move it back to todo with feedback. Creates an after-action note documenting what went wrong. For serious failures, flags for human operator review. Only available to Lead agents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'ID of the completed task to review' },
        quality: { type: 'string', enum: ['good', 'needs-redo', 'serious-failure'], description: 'Assessment of the work quality' },
        feedback: { type: 'string', description: 'Detailed feedback explaining the assessment' },
      },
      required: ['taskId', 'quality', 'feedback'],
    },
  },
  {
    name: 'list_agent_activity',
    description: 'List recent actions taken by other agents in this investigation. Use to review what specialists have done before delegating new work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agentName: { type: 'string', description: 'Filter by agent profile name (optional)' },
        limit: { type: 'number', description: 'Max results to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'ask_human',
    description: 'Ask the human operator a question and wait for their response. Use when you need human judgment, authorization, or information that cannot be found through tools. The question appears in the agent inbox for the human to answer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The question to ask the human operator' },
        context: { type: 'string', description: 'Background context to help the human understand why you are asking' },
        options: { type: 'string', description: 'Suggested response options (comma-separated) if applicable' },
      },
      required: ['question'],
    },
  },
  {
    name: 'call_meeting',
    description: 'Schedule and run an agent meeting with a specific agenda. All deployed agents participate. Rate-limited by investigation policy. Only available to Lead agents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agenda: { type: 'string', description: 'Meeting agenda — what should agents discuss?' },
        maxRounds: { type: 'number', description: 'Number of discussion rounds (default 2)' },
      },
      required: ['agenda'],
    },
  },
  {
    name: 'notify_human',
    description: 'Send a notification to the human operator via the CaddyShack feed. Use for major findings, critical updates, or decisions requiring human judgment. Creates a pinned post visible to all team members.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Notification message — be clear and concise about what needs human attention' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Severity level (default warning)' },
      },
      required: ['message'],
    },
  },
  {
    name: 'declare_war_bridge',
    description: 'Declare a war bridge — emergency all-hands meeting triggered by a critical finding (confirmed breach, active C2, data exfiltration, etc.). Creates an emergency meeting, pinned escalation note, and desktop notification. Use only for genuinely critical situations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        situation: { type: 'string', description: 'Description of the critical situation that triggered the war bridge' },
        immediateActions: { type: 'string', description: 'Recommended immediate containment/response actions' },
      },
      required: ['situation'],
    },
  },
];

// ── Executive tools (CISO / Chief of Staff only) ──────────────────────

export const EXECUTIVE_TOOL_DEFINITIONS = [
  // ── Agent Spawning ──────────────────────────────────────────────
  {
    name: 'spawn_agent',
    description: 'Deploy an existing agent profile to this investigation. Use when you need additional specialist help. The new agent will start working on the next cycle.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profileName: { type: 'string', description: 'Name of the agent profile to deploy (e.g. "IOC Enricher", "Timeline Builder", "Malware Analyst")' },
        reason: { type: 'string', description: 'Why this agent is needed — what gap does it fill?' },
        competitiveness: { type: 'string', enum: ['cooperative', 'competitive', 'independent'], description: 'Work mode (default: cooperative)' },
      },
      required: ['profileName', 'reason'],
    },
  },
  {
    name: 'define_specialist',
    description: 'Create a new custom agent profile and deploy it to this investigation. Use when no existing profile fits the need. The new agent starts immediately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Profile name (e.g. "Cloud Infrastructure Analyst")' },
        icon: { type: 'string', description: 'Emoji icon' },
        role: { type: 'string', enum: ['specialist', 'observer'], description: 'Role (default: specialist)' },
        systemPrompt: { type: 'string', description: 'What this agent does — its expertise, approach, and focus areas (keep under 500 chars)' },
        reason: { type: 'string', description: 'Why this specialist is needed' },
      },
      required: ['name', 'systemPrompt', 'reason'],
    },
  },
  // ── Agent Override / Dismissal ───────────────────────────────────
  {
    name: 'dismiss_agent',
    description: 'Dismiss a poorly performing agent from this investigation and optionally replace them. This is a serious action — requires strong evidence of poor performance (rejected tasks, repeated mistakes, failure to follow instructions). Creates a dismissal record and after-action note. The dismissed agent\'s soul is updated with the feedback.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agentName: { type: 'string', description: 'Name of the agent to dismiss (profile name)' },
        reason: { type: 'string', description: 'Detailed justification — what specifically went wrong (required, must be substantive)' },
        evidence: { type: 'string', description: 'Specific examples of poor performance (task IDs, action IDs, or descriptions of failures)' },
        replacementProfile: { type: 'string', description: 'Name of a profile to deploy as replacement (optional — leave empty to not replace)' },
      },
      required: ['agentName', 'reason', 'evidence'],
    },
  },
  // ── Soul / Self-Reflection ──────────────────────────────────────
  {
    name: 'reflect_on_performance',
    description: 'Update your soul — record lessons learned, strengths, weaknesses, and self-identity. Called at the end of significant work to build persistent cross-investigation memory. Your soul persists across all investigations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lesson: { type: 'string', description: 'A lesson learned from this investigation (what worked or what to avoid next time)' },
        strength: { type: 'string', description: 'A strength you demonstrated (optional)' },
        weakness: { type: 'string', description: 'An area for improvement you identified (optional)' },
        identity: { type: 'string', description: 'Updated self-description — how you see your role and approach (optional, replaces previous)' },
      },
      required: ['lesson'],
    },
  },
  {
    name: 'read_soul',
    description: 'Read your persistent soul — your identity, lessons, strengths, weaknesses, and lifetime performance metrics. Use at the start of each investigation to remember who you are.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Write tool classification ──────────────────────────────────────────

const WRITE_TOOLS = new Set([
  'create_note', 'update_note',
  'create_task', 'update_task',
  'create_ioc', 'update_ioc', 'bulk_create_iocs',
  'create_timeline_event', 'update_timeline_event',
  'link_entities',
  'generate_report',
  'create_in_investigation',
  'delegate_task',
  'review_completed_task',
  'call_meeting',
  'notify_human',
  'declare_war_bridge',
  'enrich_ioc',
  'run_remote_command',
  'create_ticket',
  'ingest_alert',
  'update_knowledge',
  'ask_human',
  'create_note_folder',
  'delete_note_folder',
  'move_to_folder',
  'spawn_agent',
  'define_specialist',
  'dismiss_agent',
  'reflect_on_performance',
]);

export function isWriteTool(name: string): boolean {
  if (WRITE_TOOLS.has(name)) return true;
  // Host/local skills with 'modify' or 'create' action class are write tools
  if (name.startsWith('host:') || name.startsWith('local:')) {
    try {
      const settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
      if (name.startsWith('local:')) {
        const skillName = name.slice(6);
        const skill = (settings.llmLocalSkills || []).find((s: { name: string }) => s.name === skillName);
        return skill?.actionClass === 'modify' || skill?.actionClass === 'create';
      }
      const parts = name.split(':');
      if (parts.length >= 3) {
        const hostName = parts[1];
        const skillName = parts.slice(2).join(':');
        const host = (settings.agentHosts || []).find((h: { name: string }) => h.name === hostName);
        const skill = host?.skills?.find((s: { name: string }) => s.name === skillName);
        return skill?.actionClass === 'modify' || skill?.actionClass === 'create';
      }
    } catch { /* fall through */ }
  }
  return false;
}
