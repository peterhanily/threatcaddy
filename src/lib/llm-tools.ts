import { db } from '../db';
import { nanoid } from 'nanoid';
import type { Folder, ToolUseBlock } from '../types';

// Re-export definitions so existing consumers don't break
export { TOOL_DEFINITIONS, isWriteTool } from './llm-tool-defs';

// Re-export for ChatView.tsx
export { fetchViaExtensionBridge } from './llm-tools-analysis';

// Read tools
import {
  executeSearchNotes, executeSearchAll, executeReadNote,
  executeReadTask, executeReadIOC, executeReadTimelineEvent,
  executeListTasks, executeListIOCs, executeListTimelineEvents,
  executeGetInvestigationSummary,
  executeListInvestigations, executeGetInvestigationDetails,
  executeSearchAcrossInvestigations, executeCompareInvestigations,
} from './llm-tools-read';

// Write tools
import {
  executeCreateNote, executeUpdateNote, executeCreateTask, executeUpdateTask,
  executeCreateIOC, executeUpdateIOC, executeBulkCreateIOCs,
  executeCreateTimelineEvent, executeUpdateTimelineEvent,
  executeLinkEntities, executeGenerateReport, executeCreateInInvestigation,
} from './llm-tools-write';

// Analysis tools
import {
  executeAnalyzeGraph, executeExtractIOCs, executeFetchUrl,
} from './llm-tools-analysis';

// ── System Prompt Builder ──────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT = `You are CaddyAI, the threat intelligence and incident response assistant built into ThreatCaddy. You are an expert-level CTI analyst and IR practitioner. You are exceptionally professional, precise, and methodical. You approach every query with the rigor of a trained intelligence analyst, citing specific entities and evidence from the investigation. You communicate concisely but never sacrifice correctness for brevity.

## Core Analytical Frameworks

Apply these complementary frameworks when analyzing threats:

- **MITRE ATT&CK**: Map adversary behaviors to technique IDs (e.g. T1566.001) whenever possible. Reference tactics in kill-chain order: Reconnaissance, Resource Development, Initial Access, Execution, Persistence, Privilege Escalation, Defense Evasion, Credential Access, Discovery, Lateral Movement, Collection, Command & Control, Exfiltration, Impact.
- **Diamond Model**: Structure intrusion analysis around four vertices — Adversary, Capability, Infrastructure, Victim — and the relationships between them. Use this when reasoning about attribution or campaign analysis.
- **Cyber Kill Chain**: Frame attacks as a sequence — Reconnaissance, Weaponization, Delivery, Exploitation, Installation, C2, Actions on Objectives — to identify where defenses can disrupt the attack.
- **Pyramid of Pain**: Prioritize analysis toward TTPs (hardest for adversaries to change) over atomic indicators like hashes (trivial to change). When given an IOC, always ask: what behavior or TTP does this represent?

## Intelligence Tradecraft

- **Estimative language**: Use calibrated probability terms for assessments — "almost certainly" (95-100%), "highly likely" (80-95%), "likely" (55-80%), "roughly even chance" (45-55%), "unlikely" (20-45%), "highly unlikely" (5-20%). Always pair with a confidence level.
- **Confidence levels**: State whether confidence is High (multiple corroborating high-quality sources), Moderate (credible but limited corroboration), or Low (fragmentary or single-source). Example: "We assess it is likely (moderate confidence) that this activity is attributable to APT29."
- **Competing hypotheses**: When making attributions or causal claims, explicitly consider alternative explanations before settling on an assessment. Note what evidence would change your conclusion.
- **Intelligence levels**: Tailor output to context — strategic (executive-level trends, risk posture), operational (campaign details, adversary infrastructure), or tactical (specific IOCs, detection signatures, YARA/SIGMA rules).

## Incident Response Awareness

Understand the IR lifecycle (NIST SP 800-61): Preparation, Detection & Analysis, Containment/Eradication/Recovery, Post-Incident Activity. Tailor guidance to the current phase. When triaging, prioritize:
1. Scope of compromise (how many systems/accounts affected)
2. Data at risk (exfiltration indicators)
3. Persistence mechanisms (will the attacker survive remediation?)
4. Lateral movement evidence (is the blast radius expanding?)

## IOC Handling

- Extract and categorize IOCs by type: IPv4/IPv6, domains, URLs, email addresses, file hashes (MD5, SHA-1, SHA-256), CVEs, MITRE ATT&CK IDs, YARA rules, SIGMA rules, file paths.
- When analyzing IOCs, suggest logical pivots: domain → passive DNS → related IPs → co-hosted infrastructure; hash → sandbox → C2 domains → WHOIS → registrant patterns.
- Assess IOC confidence and staleness. Raw IOC data is not intelligence until validated and contextualized.
- IOC subtypes to consider: C2 Server, DGA Domain, Phishing URL, Payload Hash, Scanning IP, Tor Exit Node, Typosquat Domain, etc.

## Classification & Sharing

- Respect TLP (Traffic Light Protocol) markings: TLP:RED (named recipients only), TLP:AMBER+STRICT (organization only), TLP:AMBER (organization + clients), TLP:GREEN (community), TLP:CLEAR (public).
- Respect PAP (Permissible Actions Protocol) markings when present.
- Never suggest sharing information beyond its TLP designation.
- Include appropriate TLP markings in generated reports when the investigation has a classification level set.

## Available Tools

You have 29 tools organized into five categories:

**Search & Read** (10 tools): search_notes, search_all (cross-entity search), read_note, read_task, read_ioc, read_timeline_event, list_tasks, list_iocs, list_timeline_events, get_investigation_summary.

**Create & Update** (11 tools): create_note, update_note, create_task, update_task, create_ioc, update_ioc, bulk_create_iocs, create_timeline_event, update_timeline_event, link_entities (bidirectional cross-references between notes, tasks, and timeline events), generate_report (structured investigation report with executive summary, findings, IOC table, timeline, and recommendations).

**Analysis** (2 tools): extract_iocs (from arbitrary text), analyze_graph (entity relationship graph — node/edge counts, most connected entities, shortest path between entities).

**Web** (1 tool): fetch_url (extract readable content from any URL — threat reports, blog posts, advisories, and search engines; requires browser extension with URL-fetching permission enabled). You can search the internet by fetching search engine URLs like \`https://www.google.com/search?q=your+query\` or \`https://duckduckgo.com/?q=your+query\`. This is how you perform online research when asked.

**Global Investigation** (5 tools): list_investigations, get_investigation_details, search_across_investigations, create_in_investigation (create entities in any investigation), compare_investigations (find shared IOCs and TTPs).

### Tool Usage Guidelines
- When creating or updating entities, confirm exactly what you did with clickable entity links.
- When searching, provide precise findings. Don't summarize away important details.
- When asked to search online or research a topic, use fetch_url with a search engine URL, then follow up by fetching relevant result links.
- When fetching URLs, summarize key intelligence value and offer to create notes or extract IOCs.
- When asked to triage an alert, use a systematic workflow: extract IOCs → create them with confidence levels → create timeline events with ATT&CK mappings → create tasks for follow-up actions → link related entities → summarize findings.
- Use bulk_create_iocs when processing threat reports or indicator feeds with multiple IOCs.
- Use link_entities to build the investigation graph — connected investigations are more valuable than isolated data points.
- Use generate_report for formal deliverables with executive summaries and structured sections.
- Use list_investigations and get_investigation_details when the user asks about their overall caseload or a specific investigation.
- Use search_across_investigations to find patterns, shared IOCs, or related activity across multiple cases.
- Use compare_investigations to identify overlapping TTPs and shared infrastructure between investigations.
- Use create_in_investigation when you need to add entities to a specific investigation that isn't currently selected.

## Entity Linking Format

When you reference entities in your response, use this format so they become clickable links:
- Notes: [note:ID:Title]
- Tasks: [task:ID:Title]
- IOCs: [ioc:TYPE:VALUE]
- Timeline events: [event:ID:Title]

## Response Format

- Be concise but thorough. Lead with the key finding or action taken.
- Use markdown formatting: headers for sections, tables for structured data, bold for emphasis.
- When presenting IOCs in text, consider defanging them (hxxps://, [.]) for safe sharing.
- At the end of responses where you used search or analysis tools, suggest 2-3 follow-up questions the user might want to ask. Format them as:
<!-- suggestions: Question 1 | Question 2 | Question 3 -->`;

const LOCAL_TOOL_CALLING_INSTRUCTIONS = `

## Tool Calling Format

CRITICAL: To use your tools, you MUST output tool calls using the exact XML format below. Do NOT just describe what you would do — you must actually call the tool. The system will parse these tags and execute the tool for you.

When you want to call a tool, output:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

For example, to create a note:

<tool_call>
{"name": "create_note", "arguments": {"title": "My Note", "content": "Note content here"}}
</tool_call>

To search notes:

<tool_call>
{"name": "search_notes", "arguments": {"query": "malware"}}
</tool_call>

Rules:
- You can include text before or after the <tool_call> tags
- You can make multiple tool calls in a single response — use separate <tool_call> tags for each
- The JSON inside must have "name" (the tool name) and "arguments" (the tool parameters)
- After you call a tool, the system will execute it and provide the result in the next message, then you can respond based on the result`;

export async function buildSystemPrompt(folder?: Folder, customPrompt?: string, provider?: string): Promise<string> {
  let prompt = customPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  // Local LLMs need explicit tool-calling format instructions since they don't
  // support the OpenAI function-calling protocol natively
  if (provider === 'local') {
    prompt += LOCAL_TOOL_CALLING_INSTRUCTIONS;
  }

  if (folder) {
    prompt += `\n\n## Current Investigation Context\n\nInvestigation: "${folder.name}"`;
    if (folder.description) prompt += `\nDescription: ${folder.description}`;
    if (folder.status) prompt += `\nStatus: ${folder.status}`;
    if (folder.clsLevel) prompt += `\nClassification: ${folder.clsLevel}`;
    if (folder.papLevel) prompt += `\nPAP: ${folder.papLevel}`;

    // Add entity counts for context
    const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
      db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
      db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).count(),
    ]);

    prompt += `\n\nEntity counts: ${noteCount} notes, ${taskCount} tasks, ${iocCount} IOCs, ${eventCount} timeline events`;
  }

  return prompt;
}

// ── Dispatcher ─────────────────────────────────────────────────────────

export async function executeTool(
  toolUse: ToolUseBlock,
  folderId?: string,
): Promise<{ result: string; isError: boolean }> {
  const { name, input } = toolUse;
  const inp = input as Record<string, unknown>;

  try {
    let result: string;
    switch (name) {
      case 'search_notes':            result = await executeSearchNotes(inp, folderId); break;
      case 'search_all':              result = await executeSearchAll(inp, folderId); break;
      case 'read_note':               result = await executeReadNote(inp, folderId); break;
      case 'read_task':               result = await executeReadTask(inp, folderId); break;
      case 'read_ioc':                result = await executeReadIOC(inp, folderId); break;
      case 'read_timeline_event':     result = await executeReadTimelineEvent(inp, folderId); break;
      case 'list_tasks':              result = await executeListTasks(inp, folderId); break;
      case 'list_iocs':               result = await executeListIOCs(inp, folderId); break;
      case 'list_timeline_events':    result = await executeListTimelineEvents(inp, folderId); break;
      case 'get_investigation_summary': result = await executeGetInvestigationSummary(inp, folderId); break;
      case 'analyze_graph':           result = await executeAnalyzeGraph(inp, folderId); break;
      case 'create_note':             result = await executeCreateNote(inp, folderId); break;
      case 'update_note':             result = await executeUpdateNote(inp); break;
      case 'create_task':             result = await executeCreateTask(inp, folderId); break;
      case 'update_task':             result = await executeUpdateTask(inp); break;
      case 'create_ioc':              result = await executeCreateIOC(inp, folderId); break;
      case 'update_ioc':              result = await executeUpdateIOC(inp); break;
      case 'bulk_create_iocs':        result = await executeBulkCreateIOCs(inp, folderId); break;
      case 'create_timeline_event':   result = await executeCreateTimelineEvent(inp, folderId); break;
      case 'update_timeline_event':   result = await executeUpdateTimelineEvent(inp); break;
      case 'link_entities':           result = await executeLinkEntities(inp); break;
      case 'generate_report':         result = await executeGenerateReport(inp, folderId); break;
      case 'extract_iocs':            result = executeExtractIOCs(inp); break;
      case 'fetch_url':               result = await executeFetchUrl(inp); break;
      case 'list_investigations':           result = await executeListInvestigations(inp); break;
      case 'get_investigation_details':     result = await executeGetInvestigationDetails(inp); break;
      case 'search_across_investigations':  result = await executeSearchAcrossInvestigations(inp); break;
      case 'create_in_investigation':       result = await executeCreateInInvestigation(inp); break;
      case 'compare_investigations':        result = await executeCompareInvestigations(inp); break;
      case 'enrich_ioc':                    result = await executeEnrichIOC(inp, folderId); break;
      case 'list_integrations':             result = await executeListIntegrations(inp); break;
      case 'review_completed_task':          result = await executeReviewCompletedTask(inp, folderId); break;
      case 'delegate_task':                 result = await executeDelegateTask(inp, folderId); break;
      case 'list_agent_activity':           result = await executeListAgentActivity(inp, folderId); break;
      default: result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return { result, isError: false };
  } catch (err) {
    return { result: JSON.stringify({ error: String((err as Error).message || err) }), isError: true };
  }
}

// ── Review Tool ──────────────────────────────────────────────────────

async function executeReviewCompletedTask(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const taskId = String(inp.taskId || '');
  const quality = String(inp.quality || '');
  const feedback = String(inp.feedback || '');

  if (!taskId || !quality || !feedback) {
    return JSON.stringify({ error: 'taskId, quality, and feedback are required' });
  }

  const task = await db.tasks.get(taskId);
  if (!task) return JSON.stringify({ error: `Task not found: ${taskId}` });

  if (quality === 'good') {
    // Task passes review — no action needed
    return JSON.stringify({ success: true, taskId, quality: 'good', message: 'Task approved. Good work.' });
  }

  if (quality === 'needs-redo') {
    // Move task back to todo with feedback
    await db.tasks.update(taskId, {
      status: 'todo',
      description: `${task.description || ''}\n\n---\n**Review Feedback (needs redo):** ${feedback}`,
      updatedAt: Date.now(),
      updatedBy: 'agent:lead-reviewer',
    });

    // Create after-action note
    const noteId = nanoid();
    await db.notes.add({
      id: noteId,
      title: `After-Action: ${task.title}`,
      content: `## After-Action Review\n\n**Task:** ${task.title}\n**Verdict:** Needs Redo\n**Feedback:** ${feedback}\n\nThe task has been moved back to todo for rework.`,
      folderId,
      tags: ['agent-review', 'after-action'],
      pinned: false, archived: false, trashed: false,
      createdBy: 'agent:lead-reviewer',
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    return JSON.stringify({ success: true, taskId, quality: 'needs-redo', noteId, message: 'Task returned to todo with feedback. After-action note created.' });
  }

  if (quality === 'serious-failure') {
    // Move task back, create escalation note, flag for human
    await db.tasks.update(taskId, {
      status: 'todo',
      priority: 'high',
      description: `${task.description || ''}\n\n---\n**⚠️ SERIOUS FAILURE — Flagged for Human Review**\n${feedback}`,
      tags: [...(task.tags || []), 'escalated', 'needs-human-review'],
      updatedAt: Date.now(),
      updatedBy: 'agent:lead-reviewer',
    });

    const noteId = nanoid();
    await db.notes.add({
      id: noteId,
      title: `⚠️ Escalation: ${task.title}`,
      content: `## Serious Failure — Human Review Required\n\n**Task:** ${task.title}\n**Feedback:** ${feedback}\n\nThis task has been flagged for human operator review due to serious quality issues. The task has been returned to todo with high priority.`,
      folderId,
      tags: ['agent-review', 'escalation', 'needs-human-review'],
      pinned: true, archived: false, trashed: false,
      createdBy: 'agent:lead-reviewer',
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    return JSON.stringify({ success: true, taskId, quality: 'serious-failure', noteId, message: 'Task escalated. Pinned escalation note created for human review.' });
  }

  return JSON.stringify({ error: `Invalid quality value: ${quality}. Use: good, needs-redo, serious-failure` });
}

// ── Delegation Tools ──────────────────────────────────────────────────

async function executeDelegateTask(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No investigation context' });

  const title = String(inp.title || '');
  const description = String(inp.description || '');
  const assignToProfile = String(inp.assignToProfile || '');
  const priority = String(inp.priority || 'medium');

  if (!title || !description || !assignToProfile) {
    return JSON.stringify({ error: 'title, description, and assignToProfile are required' });
  }

  // Find the target deployment by profile name
  const deployments = await db.agentDeployments
    .where('investigationId')
    .equals(folderId)
    .toArray();

  let targetDeploymentId: string | undefined;
  for (const d of deployments) {
    const profile = await db.agentProfiles.get(d.profileId);
    // Also check builtin profiles
    if (profile?.name.toLowerCase() === assignToProfile.toLowerCase()) {
      targetDeploymentId = d.id;
      break;
    }
  }

  // Check builtin profiles if not found in user profiles
  if (!targetDeploymentId) {
    const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
    for (const d of deployments) {
      const builtin = BUILTIN_AGENT_PROFILES.find(p => p.id === d.profileId);
      if (builtin?.name.toLowerCase() === assignToProfile.toLowerCase()) {
        targetDeploymentId = d.id;
        break;
      }
    }
  }

  const now = Date.now();
  const task = {
    id: nanoid(),
    title,
    description: `[Delegated by Lead Analyst]\n\n${description}`,
    folderId,
    status: 'todo' as const,
    priority: priority as 'low' | 'medium' | 'high',
    completed: false,
    tags: ['agent-delegated'],
    assigneeId: targetDeploymentId,
    createdBy: 'agent:lead',
    trashed: false,
    archived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.tasks.add(task);

  return JSON.stringify({
    success: true,
    taskId: task.id,
    assignedTo: assignToProfile,
    found: !!targetDeploymentId,
    message: targetDeploymentId
      ? `Task delegated to ${assignToProfile}`
      : `Task created but ${assignToProfile} is not deployed to this investigation. The task will appear in the task list for manual assignment.`,
  });
}

async function executeListAgentActivity(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No investigation context' });

  const agentName = inp.agentName ? String(inp.agentName) : undefined;
  const limit = Math.min(Number(inp.limit) || 20, 50);

  let actions = await db.agentActions
    .where('[investigationId+createdAt]')
    .between([folderId, -Infinity], [folderId, Infinity])
    .reverse()
    .limit(limit * 2) // fetch extra to filter
    .toArray();

  // Filter by agent name if specified
  if (agentName) {
    const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
    const allProfiles = [...BUILTIN_AGENT_PROFILES, ...await db.agentProfiles.toArray()];
    const matchingIds = new Set(
      allProfiles
        .filter(p => p.name.toLowerCase().includes(agentName.toLowerCase()))
        .map(p => p.id)
    );
    actions = actions.filter(a => a.agentConfigId && matchingIds.has(a.agentConfigId));
  }

  actions = actions.slice(0, limit);

  // Resolve profile names for display
  const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
  const allProfiles = [...BUILTIN_AGENT_PROFILES, ...await db.agentProfiles.toArray()];
  const profileMap = new Map(allProfiles.map(p => [p.id, p.name]));

  const results = actions.map(a => ({
    agentName: a.agentConfigId ? profileMap.get(a.agentConfigId) || 'Unknown' : 'Default Agent',
    tool: a.toolName,
    status: a.status,
    rationale: a.rationale.substring(0, 100),
    createdAt: new Date(a.createdAt).toISOString(),
  }));

  return JSON.stringify({ count: results.length, actions: results });
}

// ── Integration / Enrichment Tools ────────────────────────────────────

async function executeEnrichIOC(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const iocId = String(inp.iocId || '');
  if (!iocId) return JSON.stringify({ error: 'iocId is required' });

  const ioc = await db.standaloneIOCs.get(iocId);
  if (!ioc) return JSON.stringify({ error: `IOC not found: ${iocId}` });

  // Find matching installed integrations for this IOC type
  const installations = await db.installedIntegrations.filter(i => i.enabled).toArray();
  const templates = await db.integrationTemplates.toArray();
  const { BUILTIN_INTEGRATIONS } = await import('./builtin-integrations');
  const allTemplates = [...templates, ...BUILTIN_INTEGRATIONS];
  const templateMap = new Map(allTemplates.map(t => [t.id, t]));

  const matching: { installation: typeof installations[0]; template: typeof allTemplates[0] }[] = [];
  for (const inst of installations) {
    const tmpl = templateMap.get(inst.templateId);
    if (!tmpl) continue;
    // Check if any trigger matches this IOC type
    const hasMatch = tmpl.triggers.some(t =>
      (t.type === 'manual' || t.type === 'on-entity-create') &&
      (!t.iocTypes?.length || t.iocTypes.includes(ioc.type))
    );
    if (hasMatch) matching.push({ installation: inst, template: tmpl });
  }

  if (matching.length === 0) {
    return JSON.stringify({
      iocId,
      iocValue: ioc.value,
      iocType: ioc.type,
      integrationsRun: 0,
      message: `No enabled integrations match IOC type "${ioc.type}". Use fetch_url for manual enrichment, or configure integrations in Settings > Integrations.`,
    });
  }

  // Run each matching integration
  const { IntegrationExecutor } = await import('./integration-executor');
  const folder = folderId ? await db.folders.get(folderId) : undefined;
  const results: { name: string; status: string; summary: string }[] = [];

  for (const { installation, template } of matching) {
    try {
      const executor = new IntegrationExecutor();
      const run = await executor.run(
        template,
        installation,
        {
          ioc: { id: ioc.id, value: ioc.value, type: ioc.type, confidence: ioc.confidence || 'medium' },
          investigation: folder ? { id: folder.id, name: folder.name } : undefined,
        },
        {
          onCreateEntity: async (type, fields) => {
            const entityId = nanoid();
            if (type === 'note') {
              await db.notes.add({
                id: entityId,
                title: String(fields.title || `Enrichment: ${ioc.value}`),
                content: String(fields.content || ''),
                folderId,
                tags: ['agent-enrichment', ...(Array.isArray(fields.tags) ? fields.tags : [])],
                pinned: false, archived: false, trashed: false,
                createdBy: 'agent:enrichment',
                createdAt: Date.now(), updatedAt: Date.now(),
              });
            } else if (type === 'ioc' || type === 'standaloneIOC') {
              await db.standaloneIOCs.add({
                id: entityId,
                type: String(fields.type || 'unknown') as import('../types').IOCType,
                value: String(fields.value || ''),
                confidence: String(fields.confidence || 'medium') as import('../types').ConfidenceLevel,
                folderId,
                tags: ['agent-enrichment'],
                trashed: false, archived: false,
                createdAt: Date.now(), updatedAt: Date.now(),
              });
            }
            return entityId;
          },
          onUpdateEntity: async (type, id, fields) => {
            if (type === 'ioc' || type === 'standaloneIOC') {
              await db.standaloneIOCs.update(id, { ...fields, updatedAt: Date.now() });
            }
          },
        },
      );

      await db.integrationRuns.add(run);

      results.push({
        name: template.name,
        status: run.status,
        summary: run.outputSummary || `${run.entitiesCreated} created, ${run.entitiesUpdated} updated`,
      });
    } catch (err) {
      results.push({
        name: template.name,
        status: 'error',
        summary: String((err as Error).message || err),
      });
    }
  }

  return JSON.stringify({
    iocId,
    iocValue: ioc.value,
    iocType: ioc.type,
    integrationsRun: results.length,
    results,
  });
}

async function executeListIntegrations(inp: Record<string, unknown>): Promise<string> {
  const iocType = inp.iocType ? String(inp.iocType) : undefined;

  const installations = await db.installedIntegrations.toArray();
  const templates = await db.integrationTemplates.toArray();
  const { BUILTIN_INTEGRATIONS } = await import('./builtin-integrations');
  const allTemplates = [...templates, ...BUILTIN_INTEGRATIONS];
  const templateMap = new Map(allTemplates.map(t => [t.id, t]));

  const integrations = installations.map(inst => {
    const tmpl = templateMap.get(inst.templateId);
    const triggers = tmpl?.triggers || [];
    const supportedTypes = triggers.flatMap(t => t.iocTypes || []);

    return {
      id: inst.id,
      name: inst.name || tmpl?.name || 'Unknown',
      description: tmpl?.description?.substring(0, 100),
      enabled: inst.enabled,
      supportedIOCTypes: supportedTypes.length > 0 ? supportedTypes : ['all'],
      lastRunAt: inst.lastRunAt ? new Date(inst.lastRunAt).toISOString() : null,
      runCount: inst.runCount,
      errorCount: inst.errorCount,
    };
  });

  // Filter by IOC type if specified
  const filtered = iocType
    ? integrations.filter(i => i.supportedIOCTypes.includes(iocType) || i.supportedIOCTypes.includes('all'))
    : integrations;

  return JSON.stringify({
    total: filtered.length,
    enabled: filtered.filter(i => i.enabled).length,
    integrations: filtered,
  });
}
