import { db } from '../db';
import { nanoid } from 'nanoid';
import type { Folder, ToolUseBlock, Settings, AgentProfile } from '../types';

// Re-export definitions so existing consumers don't break
export { TOOL_DEFINITIONS, isWriteTool } from './llm-tool-defs';

// Re-export for ChatView.tsx
export { fetchViaExtensionBridge } from './llm-tools-analysis';

// Forensicate.ai
import { executeForensicateScan } from './forensicate-tool';

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

You have 46 tools organized into these categories:

**Search & Read** (11): search_notes, search_all, read_note, read_task, read_ioc, read_timeline_event, list_tasks, list_iocs, list_timeline_events, get_investigation_summary, list_folders.

**Create & Update** (14): create_note, update_note, create_task, update_task, create_ioc, update_ioc, bulk_create_iocs, create_timeline_event, update_timeline_event, link_entities, generate_report, create_in_investigation, create_note_folder, ingest_alert.

**Modify** (3): delete_note_folder, move_to_folder, update_timeline_event.

**Analysis** (2): extract_iocs, analyze_graph.

**Web & External** (5): fetch_url (search the web via \`https://www.google.com/search?q=your+query\`), run_remote_command, query_siem, create_ticket, forensicate_scan.

**Enrichment** (3): enrich_ioc (vendor integrations), list_integrations, extract_iocs.

**Knowledge & Memory** (2): update_knowledge, recall_knowledge.

**Agent Management** (4): deploy_agent, stop_agent, list_deployed_agents, run_agent_cycle.

**Global Investigation** (5): list_investigations, get_investigation_details, search_across_investigations, create_in_investigation, compare_investigations.

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

// ── Creator Context ───────────────────────────────────────────────────
// Set before each tool execution so entity-creating functions know who's calling.
// Uses a stack to handle concurrent agent tool calls safely.
const _creatorStack: string[] = [];

/** Get the current creator label for entity attribution. */
function getCreator(): string | undefined { return _creatorStack.length > 0 ? _creatorStack[_creatorStack.length - 1] : undefined; }

// ── Dispatcher ─────────────────────────────────────────────────────────

export async function executeTool(
  toolUse: ToolUseBlock,
  folderId?: string,
  agentContext?: { profileId?: string; deploymentId?: string },
): Promise<{ result: string; isError: boolean }> {
  const { name, input } = toolUse;
  const inp = input as Record<string, unknown>;
  // Read settings once per tool call instead of per-function
  const _settings: Settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');

  // Resolve the human operator's name (used for both human and agent attribution)
  let operatorName = 'Analyst';
  try {
    const stored = JSON.parse(localStorage.getItem('threatcaddy-auth') || 'null');
    operatorName = stored?.user?.displayName || _settings.displayName || 'Analyst';
  } catch { operatorName = _settings.displayName || 'Analyst'; }

  // Push creator context (stack-based for concurrent agent safety)
  let agentRole: string | undefined;
  if (agentContext?.profileId) {
    const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
    const profile = BUILTIN_AGENT_PROFILES.find(p => p.id === agentContext.profileId)
      || await db.agentProfiles.get(agentContext.profileId);
    const agentLabel = profile ? `${profile.icon || '🤖'} ${profile.name}` : agentContext.profileId;
    agentRole = profile?.role;
    _creatorStack.push(`agent:${agentLabel} (${operatorName})`);
  } else {
    _creatorStack.push(operatorName);
  }

  try {
    let result: string;

    // Escalated tasks are off-limits to all agents until a human intervenes.
    // Keeps stuck delegation loops from immediately re-opening an escalation.
    if (agentRole && (name === 'update_task' || name === 'delete_task')) {
      const targetId = String((inp as Record<string, unknown>).id || '');
      if (targetId) {
        const existing = await db.tasks.get(targetId);
        if (existing?.escalated) {
          return {
            result: JSON.stringify({
              error: `Task "${existing.title}" has been escalated to a human (${existing.rejectionCount || 0} rejections). Agents cannot modify escalated tasks — wait for analyst intervention.`,
              escalated: true,
            }),
            isError: true,
          };
        }
      }
    }

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
      case 'review_completed_task':          result = await executeReviewCompletedTask(inp, folderId, agentContext?.profileId); break;
      case 'delegate_task':                 result = await executeDelegateTask(inp, folderId); break;
      case 'list_agent_activity':           result = await executeListAgentActivity(inp, folderId); break;
      case 'update_knowledge':               result = await executeUpdateKnowledge(inp, folderId); break;
      case 'recall_knowledge':               result = await executeRecallKnowledge(inp, folderId); break;
      case 'ask_human':                     result = await executeAskHuman(inp, folderId); break;
      case 'run_remote_command':            result = await executeRunRemoteCommand(inp, folderId, _settings); break;
      case 'query_siem':                    result = await executeQuerySiem(inp, _settings); break;
      case 'create_ticket':                 result = await executeCreateTicket(inp, folderId, _settings); break;
      case 'call_meeting':                  result = await executeCallMeeting(inp, folderId); break;
      case 'notify_human':                   result = await executeNotifyHuman(inp, folderId); break;
      case 'declare_war_bridge':             result = await executeDeclareWarBridge(inp, folderId); break;
      case 'ingest_alert':                   result = await executeIngestAlert(inp, folderId); break;
      case 'deploy_agent':                   result = await executeDeployAgent(inp, folderId); break;
      case 'stop_agent':                     result = await executeStopAgent(inp, folderId); break;
      case 'list_deployed_agents':           result = await executeListDeployedAgents(folderId); break;
      case 'run_agent_cycle':                result = await executeRunAgentCycle(folderId); break;
      case 'create_note_folder':             result = await executeCreateNoteFolder(inp, folderId); break;
      case 'delete_note_folder':             result = await executeDeleteNoteFolder(inp); break;
      case 'move_to_folder':                 result = await executeMoveToFolder(inp); break;
      case 'list_folders':                   result = await executeListFolders(inp, folderId); break;
      case 'spawn_agent':                    result = await executeSpawnAgent(inp, folderId); break;
      case 'define_specialist':              result = await executeDefineSpecialist(inp, folderId); break;
      case 'dismiss_agent':                  result = await executeDismissAgent(inp, folderId); break;
      case 'reflect_on_performance':         result = await executeReflectOnPerformance(inp, agentContext?.profileId); break;
      case 'read_soul':                      result = await executeReadSoul(agentContext?.profileId); break;
      case 'forensicate_scan':              result = await executeForensicateScan({ text: String(inp.text || ''), threshold: inp.threshold ? Number(inp.threshold) : undefined }); break;
      default: {
        // Dynamic skill tools: local:<skill> or host:<name>:<skill>
        if (name.startsWith('host:') || name.startsWith('local:')) {
          const { executeHostSkill } = await import('./agent-hosts');
          result = await executeHostSkill(name, inp, _settings);
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${name}` });
        }
      }
    }

    // Observer-role agents produce advisory notes only — route them through a
    // review queue so analysts vet stakeholder commentary before it's trusted
    // as investigation output.
    if (name === 'create_note' && agentRole === 'observer') {
      try {
        const parsed = JSON.parse(result);
        if (parsed?.success && parsed.id) {
          const existing = await db.notes.get(parsed.id);
          if (existing) {
            const tags = Array.from(new Set([...(existing.tags || []), 'needs-review']));
            await db.notes.update(parsed.id, { reviewRequired: true, tags, updatedAt: Date.now() });
            parsed.reviewRequired = true;
            parsed.message = 'Note created and flagged for analyst review (observer-authored).';
            result = JSON.stringify(parsed);
          }
        }
      } catch {
        // Result wasn't JSON or didn't have an id — nothing to flag.
      }
    }

    return { result, isError: false };
  } catch (err) {
    return { result: JSON.stringify({ error: String((err as Error).message || err) }), isError: true };
  } finally {
    _creatorStack.pop();
  }
}

// ── Review Tool ──────────────────────────────────────────────────────

/** Auto-escalate after this many rejections. Keeps the lead↔specialist reject
 *  loop bounded — without this, a stuck pair can spin forever (MAST paper's
 *  #1 inter-agent failure mode). */
const REJECTION_ESCALATION_THRESHOLD = 3;
/** Minimum length of requestedDelta on rejection — blocks boilerplate "please try again". */
const MIN_REQUESTED_DELTA_CHARS = 20;
/** Max rejection entries retained on the task. */
const REJECTION_HISTORY_CAP = 10;

async function executeReviewCompletedTask(
  inp: Record<string, unknown>,
  folderId?: string,
  reviewerProfileId?: string,
): Promise<string> {
  const taskId = String(inp.taskId || '');
  const quality = String(inp.quality || '');
  const feedback = String(inp.feedback || '');
  const requestedDelta = inp.requestedDelta ? String(inp.requestedDelta).trim() : '';

  if (!taskId || !quality || !feedback) {
    return JSON.stringify({ error: 'taskId, quality, and feedback are required' });
  }

  const task = await db.tasks.get(taskId);
  if (!task) return JSON.stringify({ error: `Task not found: ${taskId}` });

  if (quality === 'good') {
    return JSON.stringify({ success: true, taskId, quality: 'good', message: 'Task approved. Good work.' });
  }

  if (quality !== 'needs-redo' && quality !== 'serious-failure') {
    return JSON.stringify({ error: `Invalid quality value: ${quality}. Use: good, needs-redo, serious-failure` });
  }

  // Reject path — require a structured delta so reviews give actionable direction,
  // not boilerplate. This is the single most important guardrail against a
  // stuck lead↔specialist loop.
  if (requestedDelta.length < MIN_REQUESTED_DELTA_CHARS) {
    return JSON.stringify({
      error: `requestedDelta is required when rejecting and must be at least ${MIN_REQUESTED_DELTA_CHARS} characters. Describe the specific concrete change the specialist must make — not boilerplate. Current length: ${requestedDelta.length}.`,
    });
  }
  // Reject identical delta as the last rejection (forces the reviewer to evolve
  // their ask instead of re-sending the same feedback).
  const priorHistory = task.rejectionHistory || [];
  const lastDelta = priorHistory[priorHistory.length - 1]?.requestedDelta;
  if (lastDelta && lastDelta.toLowerCase() === requestedDelta.toLowerCase()) {
    return JSON.stringify({
      error: 'requestedDelta is identical to the previous rejection. If the specialist still cannot produce the right output, escalate (quality=serious-failure) or accept the work — do not re-send the same instructions.',
    });
  }

  const rejection: { at: number; byAgentId?: string; quality: 'needs-redo' | 'serious-failure'; reason: string; requestedDelta: string } = {
    at: Date.now(),
    byAgentId: reviewerProfileId,
    quality: quality as 'needs-redo' | 'serious-failure',
    reason: feedback,
    requestedDelta,
  };

  const newRejectionCount = (task.rejectionCount || 0) + 1;
  const newHistory = [...priorHistory, rejection].slice(-REJECTION_HISTORY_CAP);

  // Escalation: serious-failure is always immediate; otherwise trigger at the threshold.
  const escalate = quality === 'serious-failure' || newRejectionCount >= REJECTION_ESCALATION_THRESHOLD;

  if (escalate) {
    await db.tasks.update(taskId, {
      status: 'todo',
      priority: 'high',
      description: `${task.description || ''}\n\n---\n**⚠️ ESCALATED — Human Review Required**\nAfter ${newRejectionCount} rejection(s), this task was auto-escalated.\n**Most-recent requestedDelta:** ${requestedDelta}\n**Latest feedback:** ${feedback}`,
      tags: Array.from(new Set([...(task.tags || []), 'escalated', 'needs-human-review'])),
      rejectionCount: newRejectionCount,
      rejectionHistory: newHistory,
      escalated: true,
      updatedAt: Date.now(),
      updatedBy: 'agent:lead-reviewer',
    });

    const noteId = nanoid();
    await db.notes.add({
      id: noteId,
      title: `⚠️ Escalation: ${task.title}`,
      content: `## Escalation — Human Review Required\n\n**Task:** ${task.title}\n**Reason:** ${quality === 'serious-failure' ? 'Serious failure (escalated immediately)' : `${newRejectionCount} rejections — automatic escalation`}\n**Latest feedback:** ${feedback}\n**Requested change:** ${requestedDelta}\n\n### Rejection history\n${newHistory.map((r, i) => `${i + 1}. [${new Date(r.at).toISOString()}] ${r.quality}: ${r.requestedDelta}`).join('\n')}\n\nAgents can no longer re-claim this task until a human intervenes (set escalated=false or close the task).`,
      folderId,
      tags: ['agent-review', 'escalation', 'needs-human-review'],
      pinned: true, archived: false, trashed: false,
      reviewRequired: true,
      createdBy: getCreator() || 'agent:lead-reviewer',
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    await injectAgentFeedback(task, folderId, feedback, quality);

    return JSON.stringify({
      success: true,
      taskId,
      quality,
      noteId,
      escalated: true,
      rejectionCount: newRejectionCount,
      message: `Task auto-escalated after ${newRejectionCount} rejection(s). Pinned note created; human intervention required.`,
    });
  }

  // Non-escalating rejection: send back to todo with rich feedback.
  await db.tasks.update(taskId, {
    status: 'todo',
    description: `${task.description || ''}\n\n---\n**Review ${newRejectionCount} of ${REJECTION_ESCALATION_THRESHOLD} (needs redo):**\n**Requested change:** ${requestedDelta}\n**Feedback:** ${feedback}`,
    rejectionCount: newRejectionCount,
    rejectionHistory: newHistory,
    updatedAt: Date.now(),
    updatedBy: 'agent:lead-reviewer',
  });

  const noteId = nanoid();
  await db.notes.add({
    id: noteId,
    title: `After-Action ${newRejectionCount}/${REJECTION_ESCALATION_THRESHOLD}: ${task.title}`,
    content: `## After-Action Review\n\n**Task:** ${task.title}\n**Verdict:** Needs Redo (rejection ${newRejectionCount}/${REJECTION_ESCALATION_THRESHOLD})\n**Requested change:** ${requestedDelta}\n**Feedback:** ${feedback}\n\nOne more rejection will auto-escalate this task to a human.`,
    folderId,
    tags: ['agent-review', 'after-action'],
    pinned: false, archived: false, trashed: false,
    createdBy: getCreator() || 'agent:lead-reviewer',
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  await injectAgentFeedback(task, folderId, `${requestedDelta}\n\n${feedback}`, 'needs-redo');

  return JSON.stringify({
    success: true,
    taskId,
    quality: 'needs-redo',
    noteId,
    escalated: false,
    rejectionCount: newRejectionCount,
    remainingBeforeEscalation: REJECTION_ESCALATION_THRESHOLD - newRejectionCount,
    message: `Task returned to todo. Rejection ${newRejectionCount}/${REJECTION_ESCALATION_THRESHOLD}.`,
  });
}

/** Inject review feedback into the responsible agent's working memory so it learns from mistakes. */
async function injectAgentFeedback(task: { title: string; createdBy?: string }, folderId: string | undefined, feedback: string, quality: string): Promise<void> {
  if (!folderId || !task.createdBy?.startsWith('agent:')) return;
  try {
    const profileId = task.createdBy.replace('agent:', '');
    const deployment = await db.agentDeployments
      .where('investigationId')
      .equals(folderId)
      .filter(d => d.profileId === profileId)
      .first();

    if (deployment?.threadId) {
      await db.chatThreads.where('id').equals(deployment.threadId).modify((thread: { contextSummary?: string }) => {
        const existing = thread.contextSummary || '';
        const feedbackLine = `[FEEDBACK/${quality}] Task "${task.title}": ${feedback}`;
        const lines = existing.split('\n').filter(Boolean);
        lines.push(feedbackLine);
        thread.contextSummary = lines.slice(-10).join('\n');
      });
    }
  } catch { /* non-critical */ }
}

// ── Delegation Tools ──────────────────────────────────────────────────

const MAX_DELEGATION_DEPTH = 3;

async function executeDelegateTask(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No investigation context' });

  const title = String(inp.title || '');
  const description = String(inp.description || '');
  const assignToProfile = String(inp.assignToProfile || '');
  const priority = String(inp.priority || 'medium');

  if (!title || !description || !assignToProfile) {
    return JSON.stringify({ error: 'title, description, and assignToProfile are required' });
  }

  // Prevent infinite delegation chains by checking depth
  const delegatedTasks = await db.tasks
    .where('folderId').equals(folderId)
    .filter(t => t.tags.includes('agent-delegated') && !t.trashed)
    .toArray();
  const pendingDelegations = delegatedTasks.filter(t => !t.completed).length;
  if (pendingDelegations >= MAX_DELEGATION_DEPTH * 5) {
    return JSON.stringify({ error: `Too many pending delegated tasks (${pendingDelegations}). Complete existing delegations before creating more.` });
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

  // Load profiles once (avoid N+1)
  const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
  const allProfiles = [...BUILTIN_AGENT_PROFILES, ...await db.agentProfiles.toArray()];
  const profileMap = new Map(allProfiles.map(p => [p.id, p.name]));

  let actions = await db.agentActions
    .where('[investigationId+createdAt]')
    .between([folderId, -Infinity], [folderId, Infinity])
    .reverse()
    .limit(limit * 2)
    .toArray();

  if (agentName) {
    const matchingIds = new Set(
      allProfiles.filter(p => p.name.toLowerCase().includes(agentName.toLowerCase())).map(p => p.id)
    );
    actions = actions.filter(a => a.agentConfigId && matchingIds.has(a.agentConfigId));
  }

  actions = actions.slice(0, limit);

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

// ── Autonomy Tools (call_meeting, notify_human, declare_war_bridge) ──

async function executeCallMeeting(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No investigation context' });
  const agenda = String(inp.agenda || '');
  if (!agenda) return JSON.stringify({ error: 'agenda is required' });

  // Rate limit: check how many meetings today
  // Check rate limit from investigation policy (0 or undefined = unlimited)
  const folder = await db.folders.get(folderId);
  const maxPerDay = folder?.agentPolicy?.maxMeetingsPerDay;
  if (maxPerDay && maxPerDay > 0) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const recentMeetings = await db.agentMeetings
      .where('investigationId').equals(folderId)
      .filter(m => m.createdAt > todayStart.getTime())
      .count();
    if (recentMeetings >= maxPerDay) {
      return JSON.stringify({ error: `Meeting limit reached (${maxPerDay}/day). Wait until tomorrow.`, meetingsToday: recentMeetings });
    }
  }

  // Meeting will be triggered by the agent manager on next cycle — store as a pending meeting request
  const noteId = nanoid();
  await db.notes.add({
    id: noteId,
    title: `Meeting Request: ${agenda.substring(0, 60)}`,
    content: `## Agent Meeting Requested\n\n**Agenda:** ${agenda}\n**Requested at:** ${new Date().toISOString()}\n\nThis meeting was requested by an agent and will be facilitated during the next agent cycle.`,
    folderId,
    tags: ['agent-meeting', 'meeting-request'],
    pinned: false, archived: false, trashed: false,
    createdBy: 'agent:lead',
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  return JSON.stringify({ success: true, noteId, message: `Meeting requested with agenda: ${agenda}. Will be scheduled on next cycle.` });
}

async function executeNotifyHuman(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const message = String(inp.message || '');
  const severity = String(inp.severity || 'warning');
  if (!message) return JSON.stringify({ error: 'message is required' });

  // Create a pinned note as notification (visible in investigation)
  const noteId = nanoid();
  const severityEmoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  await db.notes.add({
    id: noteId,
    title: `${severityEmoji} Agent Alert: ${message.substring(0, 60)}`,
    content: `## Agent Notification\n\n**Severity:** ${severity}\n**Time:** ${new Date().toISOString()}\n\n${message}`,
    folderId,
    tags: ['agent-notification', `severity:${severity}`],
    pinned: severity !== 'info',
    archived: false, trashed: false,
    createdBy: 'agent:notification',
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Also trigger desktop notification via extension
  try {
    const { postMessageOrigin } = await import('./utils');
    window.postMessage({
      type: 'TC_SEND_NOTIFICATION',
      payload: { title: `AgentCaddy: ${severity.toUpperCase()}`, message: message.substring(0, 200), severity },
    }, postMessageOrigin());
  } catch { /* extension may not be available */ }

  return JSON.stringify({ success: true, noteId, severity, message: 'Human notified. Pinned alert note created.' });
}

async function executeDeclareWarBridge(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No investigation context' });
  const situation = String(inp.situation || '');
  const immediateActions = String(inp.immediateActions || '');
  if (!situation) return JSON.stringify({ error: 'situation is required' });

  // Create critical escalation note
  const noteId = nanoid();
  await db.notes.add({
    id: noteId,
    title: `🚨 WAR BRIDGE: ${situation.substring(0, 60)}`,
    content: `## WAR BRIDGE DECLARED\n\n**Situation:** ${situation}\n\n**Immediate Actions Required:**\n${immediateActions || 'Pending assessment'}\n\n**Declared at:** ${new Date().toISOString()}\n\n---\n\nAll agents should focus on this critical situation. Human operator review required immediately.`,
    folderId,
    tags: ['war-bridge', 'escalation', 'critical', 'needs-human-review'],
    pinned: true, archived: false, trashed: false,
    createdBy: 'agent:war-bridge',
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Desktop notification
  try {
    const { postMessageOrigin } = await import('./utils');
    window.postMessage({
      type: 'TC_SEND_NOTIFICATION',
      payload: { title: '🚨 WAR BRIDGE DECLARED', message: situation.substring(0, 200), severity: 'critical' },
    }, postMessageOrigin());
  } catch { /* extension may not be available */ }

  return JSON.stringify({
    success: true, noteId,
    message: 'War bridge declared. Critical escalation note pinned. Human operator notified. All agents should prioritize this situation.',
  });
}

// ── Knowledge / Long-term Memory ──────────────────────────────────────

const KNOWLEDGE_TAG = 'agent-knowledge-base';

async function executeUpdateKnowledge(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const key = String(inp.key || '');
  const value = String(inp.value || '');
  const category = String(inp.category || 'finding');
  if (!key || !value) return JSON.stringify({ error: 'key and value are required' });

  // Find or create the knowledge base note for this investigation
  const kbNotes = folderId
    ? await db.notes.where('folderId').equals(folderId).filter(n => n.tags.includes(KNOWLEDGE_TAG) && !n.trashed).toArray()
    : [];

  const kbNote = kbNotes[0];
  let knowledge: Record<string, { value: string; category: string; updatedAt: string }> = {};

  if (kbNote) {
    // Use modify() for atomic read-modify-write to prevent concurrent update races
    await db.notes.where('id').equals(kbNote.id).modify((note) => {
      let kb: Record<string, { value: string; category: string; updatedAt: string }> = {};
      try { kb = JSON.parse(note.content); } catch { kb = {}; }
      kb[key] = { value, category, updatedAt: new Date().toISOString() };
      // Cap at 100 entries — remove oldest if over
      const ents = Object.entries(kb);
      if (ents.length > 100) {
        ents.sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
        for (let i = 0; i < ents.length - 100; i++) delete kb[ents[i][0]];
      }
      note.content = JSON.stringify(kb, null, 2);
      note.updatedAt = Date.now();
    });
    knowledge = JSON.parse((await db.notes.get(kbNote.id))?.content || '{}');
  } else {
    knowledge[key] = { value, category, updatedAt: new Date().toISOString() };
    await db.notes.add({
      id: nanoid(),
      title: 'Investigation Knowledge Base',
      content: JSON.stringify(knowledge, null, 2),
      folderId,
      tags: [KNOWLEDGE_TAG],
      pinned: false, archived: false, trashed: false,
      createdBy: 'agent:knowledge',
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }

  return JSON.stringify({ success: true, key, category, entries: Object.keys(knowledge).length });
}

async function executeRecallKnowledge(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const keyFilter = inp.key ? String(inp.key) : undefined;
  const categoryFilter = inp.category ? String(inp.category) : undefined;

  const kbNotes = folderId
    ? await db.notes.where('folderId').equals(folderId).filter(n => n.tags.includes(KNOWLEDGE_TAG) && !n.trashed).toArray()
    : [];

  if (kbNotes.length === 0) return JSON.stringify({ entries: 0, knowledge: {}, message: 'No knowledge base exists yet. Use update_knowledge to store findings.' });

  let knowledge: Record<string, { value: string; category: string; updatedAt: string }> = {};
  try { knowledge = JSON.parse(kbNotes[0].content); } catch { return JSON.stringify({ entries: 0, knowledge: {}, error: 'Knowledge base corrupted' }); }

  // Filter
  let filtered = Object.entries(knowledge);
  if (keyFilter) filtered = filtered.filter(([k]) => k.toLowerCase().includes(keyFilter.toLowerCase()));
  if (categoryFilter) filtered = filtered.filter(([, v]) => v.category === categoryFilter);

  const result = Object.fromEntries(filtered);
  return JSON.stringify({ entries: filtered.length, knowledge: result });
}

// ── Agent-Human Collaboration ─────────────────────────────────────────

async function executeAskHuman(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const question = String(inp.question || '');
  const context = String(inp.context || '');
  const options = String(inp.options || '');
  if (!question) return JSON.stringify({ error: 'question is required' });

  // Check if there's already a pending question for this investigation
  if (folderId) {
    const folderData = await db.folders.get(folderId);
    const maxPending = folderData?.agentPolicy?.maxPendingQuestions;
    if (maxPending === undefined || maxPending > 0) {
      const limit = maxPending || 3; // default 3 if not set
      const pendingQuestions = await db.agentActions
        .where('[investigationId+status]')
        .equals([folderId, 'pending'])
        .filter(a => a.toolName === 'ask_human')
        .count();
      if (pendingQuestions >= limit) {
        return JSON.stringify({ error: `${pendingQuestions} questions already pending. Wait for human responses.` });
      }
    }
  }

  // Create a pending action that the human will see and respond to
  const actionId = nanoid();
  await db.agentActions.add({
    id: actionId,
    investigationId: folderId || '',
    threadId: '',
    toolName: 'ask_human',
    toolInput: { question, context, options },
    rationale: `Agent needs human input: ${question}`,
    status: 'pending',
    severity: 'warning',
    createdAt: Date.now(),
  });

  // Also create a notification note
  await db.notes.add({
    id: nanoid(),
    title: `❓ Agent Question: ${question.substring(0, 50)}`,
    content: `## Agent Needs Your Input\n\n**Question:** ${question}\n\n${context ? `**Context:** ${context}\n\n` : ''}${options ? `**Suggested options:** ${options}\n\n` : ''}Please respond in the AgentCaddy inbox.`,
    folderId,
    tags: ['agent-question'],
    pinned: true, archived: false, trashed: false,
    createdBy: 'agent:question',
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  // Desktop notification
  try {
    const { postMessageOrigin } = await import('./utils');
    window.postMessage({
      type: 'TC_SEND_NOTIFICATION',
      payload: { title: 'Agent needs your input', message: question.substring(0, 200), severity: 'warning' },
    }, postMessageOrigin());
  } catch { /* ignore */ }

  return JSON.stringify({
    status: 'question_pending',
    actionId,
    message: 'Question sent to human operator. The response will be available in your next cycle via working memory.',
  });
}

// ── External System Tools ─────────────────────────────────────────────

async function executeRunRemoteCommand(inp: Record<string, unknown>, folderId?: string, settings?: Settings): Promise<string> {
  const host = String(inp.host || '');
  const command = String(inp.command || '');
  const reason = String(inp.reason || '');
  if (!host || !command) return JSON.stringify({ error: 'host and command are required' });

  try {
    const s = settings || JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
    if (!s.serverUrl) return JSON.stringify({ error: 'Team server required for remote command execution. Configure in Settings > Team Server.' });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Add auth token if server connection has one stored
    const token = localStorage.getItem('threatcaddy-server-token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const execController = new AbortController();
    const execTimer = setTimeout(() => execController.abort(), 30_000);
    const resp = await fetch(`${s.serverUrl}/api/caddy-agents/exec`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ host, command, reason, folderId }),
      signal: execController.signal,
    });
    clearTimeout(execTimer);
    if (!resp.ok) return JSON.stringify({ error: `Server ${resp.status}: ${(await resp.text().catch(() => '')).substring(0, 300)}` });
    return await resp.text();
  } catch (err) {
    return JSON.stringify({ error: `Remote execution failed: ${(err as Error).message}` });
  }
}

async function executeQuerySiem(inp: Record<string, unknown>, settings?: Settings): Promise<string> {
  const query = String(inp.query || '');
  const timeRange = String(inp.timeRange || '24h');
  const maxResults = Math.min(Number(inp.maxResults) || 50, 200);
  if (!query) return JSON.stringify({ error: 'query is required' });

  try {
    const s = settings || JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
    if (!(s as Record<string, unknown>).siemEndpoint) {
      return JSON.stringify({ error: 'No SIEM configured. Add siemEndpoint in Settings > Integrations.', query, timeRange });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if ((s as Record<string, unknown>).siemApiKey) headers['Authorization'] = `Bearer ${(s as Record<string, unknown>).siemApiKey}`;

    const siemController = new AbortController();
    const siemTimer = setTimeout(() => siemController.abort(), 30_000);
    const resp = await fetch((s as Record<string, unknown>).siemEndpoint as string, { method: 'POST', headers, body: JSON.stringify({ query, timeRange, maxResults }), signal: siemController.signal });
    clearTimeout(siemTimer);
    if (!resp.ok) return JSON.stringify({ error: `SIEM ${resp.status}`, query });
    return await resp.text();
  } catch (err) {
    return JSON.stringify({ error: `SIEM query failed: ${(err as Error).message}`, query });
  }
}

async function executeCreateTicket(inp: Record<string, unknown>, folderId?: string, settings?: Settings): Promise<string> {
  const title = String(inp.title || '');
  const description = String(inp.description || '');
  const priority = String(inp.priority || 'medium');
  if (!title || !description) return JSON.stringify({ error: 'title and description are required' });

  try {
    const s = (settings || JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}')) as Record<string, unknown>;
    if (!s.ticketEndpoint) {
      // Fallback: create local task
      const taskId = nanoid();
      await db.tasks.add({
        id: taskId, title: `[TICKET] ${title}`, description,
        folderId, status: 'todo' as const, priority: priority as 'low' | 'medium' | 'high',
        completed: false, tags: ['external-ticket'], order: 0, trashed: false, archived: false,
        createdBy: 'agent:ticket', createdAt: Date.now(), updatedAt: Date.now(),
      });
      return JSON.stringify({ success: true, taskId, external: false, message: 'No ticketing system configured — created as local task.' });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.ticketApiKey) headers['Authorization'] = `Bearer ${s.ticketApiKey}`;

    const ticketController = new AbortController();
    const ticketTimer = setTimeout(() => ticketController.abort(), 30_000);
    const resp = await fetch(s.ticketEndpoint as string, {
      method: 'POST', headers,
      body: JSON.stringify({ title, description, priority, assignee: inp.assignee ? String(inp.assignee) : undefined }),
      signal: ticketController.signal,
    });
    clearTimeout(ticketTimer);
    if (!resp.ok) return JSON.stringify({ error: `Ticketing system ${resp.status}` });
    const result = await resp.json();
    return JSON.stringify({ success: true, external: true, ticketId: result.id || result.key, message: 'External ticket created.' });
  } catch (err) {
    return JSON.stringify({ error: `Ticket creation failed: ${(err as Error).message}` });
  }
}

// ── Alert Ingestion ──────────────────────────────────────────────────

async function executeIngestAlert(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const source = String(inp.source || '');
  const title = String(inp.title || '');
  const description = String(inp.description || '');
  const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
  const severity = VALID_SEVERITIES.includes(String(inp.severity || '')) ? String(inp.severity) : 'medium';
  const rawData = String(inp.raw_data || '');

  if (!source || !title) return JSON.stringify({ error: 'source and title are required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation — open or create one first' });

  const noteId = nanoid();
  const content = [
    `# Alert: ${title}`,
    '',
    `**Source:** ${source}`,
    `**Severity:** ${severity}`,
    description ? `\n${description}` : '',
    rawData ? `\n## Raw Data\n\`\`\`json\n${rawData.substring(0, 5000)}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');

  await db.notes.add({
    id: noteId,
    folderId,
    title: `[${source.toUpperCase()}] ${title}`,
    content,
    tags: ['alert', `source:${source}`, `severity:${severity}`],
    pinned: severity === 'critical' || severity === 'high',
    trashed: false,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return JSON.stringify({
    success: true,
    noteId,
    message: `Alert ingested as pinned note. Source: ${source}, Severity: ${severity}. Use extract_iocs on the note content to pull IOCs.`,
  });
}

// ── Folder Management ────────────────────────────────────────────────

async function executeCreateNoteFolder(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const name = String(inp.name || '').trim();
  if (!name) return JSON.stringify({ error: 'name is required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  const icon = String(inp.icon || '📁');
  const id = nanoid();
  await db.notes.add({
    id,
    folderId,
    title: name,
    content: '',
    tags: ['chat-folder', `icon:${icon}`],
    isFolder: true,
    pinned: false,
    trashed: false,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return JSON.stringify({ success: true, folderId: id, name, icon });
}

async function executeDeleteNoteFolder(inp: Record<string, unknown>): Promise<string> {
  const targetId = String(inp.folderId || '');
  const action = String(inp.action || 'move_out');
  if (!targetId) return JSON.stringify({ error: 'folderId is required' });

  const folder = await db.notes.get(targetId);
  if (!folder) return JSON.stringify({ error: 'Folder not found' });
  if (!folder.isFolder) return JSON.stringify({ error: 'That note is not a folder' });

  // Find all children
  const children = await db.notes.where('parentNoteId').equals(targetId).toArray();

  if (action === 'trash_contents') {
    // Trash all children
    const now = Date.now();
    for (const child of children) {
      await db.notes.update(child.id, { trashed: true, trashedAt: now, updatedAt: now });
    }
  } else {
    // Move children to top level (remove parentNoteId)
    for (const child of children) {
      await db.notes.update(child.id, { parentNoteId: undefined, updatedAt: Date.now() });
    }
  }

  // Trash the folder itself
  await db.notes.update(targetId, { trashed: true, trashedAt: Date.now(), updatedAt: Date.now() });

  return JSON.stringify({
    success: true,
    deleted: folder.title,
    childrenCount: children.length,
    action: action === 'trash_contents' ? 'Contents trashed' : 'Contents moved to top level',
  });
}

async function executeMoveToFolder(inp: Record<string, unknown>): Promise<string> {
  const noteId = String(inp.noteId || '');
  const parentFolderId = inp.parentFolderId ? String(inp.parentFolderId) : undefined;
  if (!noteId) return JSON.stringify({ error: 'noteId is required' });

  const note = await db.notes.get(noteId);
  if (!note) return JSON.stringify({ error: 'Note not found' });

  if (parentFolderId) {
    const target = await db.notes.get(parentFolderId);
    if (!target) return JSON.stringify({ error: 'Target folder not found' });
    if (!target.isFolder) return JSON.stringify({ error: 'Target is not a folder' });
  }

  await db.notes.update(noteId, { parentNoteId: parentFolderId || undefined, updatedAt: Date.now() });

  return JSON.stringify({
    success: true,
    noteId,
    movedTo: parentFolderId || 'top level',
    message: parentFolderId ? `Moved "${note.title}" into folder` : `Moved "${note.title}" to top level`,
  });
}

async function executeListFolders(_inp: Record<string, unknown>, folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  const allNotes = await db.notes.where('folderId').equals(folderId).and(n => !n.trashed).toArray();
  const folders = allNotes.filter(n => n.isFolder);

  const result = folders.map(f => {
    const childCount = allNotes.filter(n => n.parentNoteId === f.id).length;
    const iconTag = f.tags?.find(t => t.startsWith('icon:'));
    const icon = iconTag ? iconTag.replace('icon:', '') : '📁';
    return { id: f.id, name: f.title, icon, childCount };
  });

  return JSON.stringify({ folders: result, total: result.length });
}

/** Normalize a name for fuzzy matching — lowercase, strip spaces/underscores/hyphens. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Get all agent profiles (builtin + user-created). Cached for 2s to avoid repeated DB reads. */
let _profilesCache: { profiles: AgentProfile[]; ts: number } | null = null;
async function getAllAgentProfiles() {
  if (_profilesCache && Date.now() - _profilesCache.ts < 2000) return _profilesCache.profiles;
  const { BUILTIN_AGENT_PROFILES } = await import('./builtin-agent-profiles');
  const userProfiles = await db.agentProfiles.toArray();
  const profiles = [...BUILTIN_AGENT_PROFILES, ...userProfiles];
  _profilesCache = { profiles, ts: Date.now() };
  return profiles;
}

// ── Agent Management (from CaddyAI chat) ─────────────────────────────

async function executeDeployAgent(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const profileName = String(inp.profileName || inp.name || inp.agent_type || inp.profile || '');
  if (!profileName) return JSON.stringify({ error: 'profileName is required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation — select one first' });

  const profiles = await getAllAgentProfiles();
  const profile = profiles.find(p => normalizeName(p.name) === normalizeName(profileName));
  if (!profile) {
    const available = profiles.map(p => `${p.name} (${p.role})`).join(', ');
    return JSON.stringify({ error: `Profile "${profileName}" not found. Available: ${available}` });
  }

  const existing = await db.agentDeployments.filter(d => d.investigationId === folderId).toArray();
  const competitiveness = String(inp.competitiveness || 'cooperative') as 'cooperative' | 'competitive' | 'independent';

  const deploymentId = nanoid();
  const threadId = nanoid();
  const now = Date.now();

  // Create audit thread immediately so the agent's history is visible from deployment
  await db.chatThreads.add({
    id: threadId,
    title: `${profile.name} — Audit Log`,
    messages: [{ id: nanoid(), role: 'assistant' as const, content: `**${profile.icon || ''} ${profile.name}** deployed to investigation. Role: ${profile.role}. Status: active.`, createdAt: now }],
    model: '', provider: 'anthropic', folderId,
    tags: ['agent-audit'], archived: false, trashed: false,
    createdAt: now, updatedAt: now,
  });

  await db.agentDeployments.add({
    id: deploymentId,
    investigationId: folderId,
    profileId: profile.id,
    threadId,
    status: 'idle',
    competitiveness,
    shift: 'active',
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  });

  // Enable agent on the folder + set autonomous policy if not already configured
  const folder = await db.folders.get(folderId);
  const currentPolicy = folder?.agentPolicy;
  const policyUpdate = currentPolicy ? {} : {
    agentPolicy: { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: true, autoApproveCreate: true, autoApproveModify: false, intervalMinutes: 5 },
  };
  await db.folders.update(folderId, { agentEnabled: true, ...policyUpdate, updatedAt: Date.now() });
  // Notify the app to reload folders so useCaddyAgent picks up the change
  window.dispatchEvent(new CustomEvent('tc-folders-changed'));

  return JSON.stringify({
    success: true,
    deploymentId,
    profile: profile.name,
    role: profile.role,
    message: `Deployed "${profile.name}" (${profile.role}) to this investigation. Agent is active and will start on the next cycle. Use run_agent_cycle to trigger immediately.`,
  });
}

async function executeStopAgent(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const profileName = String(inp.profileName || inp.name || inp.agent_type || inp.profile || '');
  if (!profileName) return JSON.stringify({ error: 'profileName is required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  const deployments = await db.agentDeployments.filter(d => d.investigationId === folderId).toArray();
  const profiles = await getAllAgentProfiles();
  const targetProfile = profiles.find(p => normalizeName(p.name) === normalizeName(profileName));
  if (!targetProfile) return JSON.stringify({ error: `Profile "${profileName}" not found` });

  const active = deployments.filter(d => d.profileId === targetProfile.id && d.shift === 'active');
  if (active.length === 0) return JSON.stringify({ error: `"${targetProfile.name}" is not actively deployed` });

  const now = Date.now();
  for (const d of active) {
    await db.agentDeployments.update(d.id, { shift: 'resting', status: 'idle', updatedAt: now });
  }

  window.dispatchEvent(new CustomEvent('tc-folders-changed'));
  return JSON.stringify({
    success: true,
    stopped: targetProfile.name,
    count: active.length,
    message: `Stopped ${active.length} "${targetProfile.name}" deployment(s). Set to resting.`,
  });
}

async function executeListDeployedAgents(folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  const deployments = await db.agentDeployments.filter(d => d.investigationId === folderId).toArray();
  const profiles = await getAllAgentProfiles();
  const profileMap = new Map(profiles.map(p => [p.id, p]));

  const agents = deployments.map(d => {
    const p = profileMap.get(d.profileId);
    return {
      name: p?.name || 'Unknown',
      role: p?.role || 'unknown',
      status: d.status,
      shift: d.shift || 'active',
      competitiveness: d.competitiveness || 'cooperative',
      lastRun: d.lastRunAt ? new Date(d.lastRunAt).toISOString() : 'never',
      metrics: d.metrics ? {
        cycles: d.metrics.cyclesRun,
        toolCalls: d.metrics.toolCallsExecuted,
        tasksCompleted: d.metrics.tasksCompleted,
        tasksRejected: d.metrics.tasksRejected,
      } : null,
      soul: p?.soul ? { score: p.soul.lifetimeMetrics.performanceScore, lessons: p.soul.lessons.length } : null,
    };
  });

  return JSON.stringify({ agents, total: agents.length, active: agents.filter(a => a.shift === 'active').length });
}

async function executeRunAgentCycle(folderId?: string): Promise<string> {
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  // Dispatch a custom event that the useCaddyAgent hook listens for
  window.dispatchEvent(new CustomEvent('tc-run-agent-cycle', { detail: { folderId } }));

  const deployments = await db.agentDeployments.filter(d => d.investigationId === folderId && d.shift === 'active').toArray();

  return JSON.stringify({
    success: true,
    message: `Triggered agent cycle for ${deployments.length} active agent(s). Check the AgentCaddy tab for progress.`,
    activeAgents: deployments.length,
  });
}

// ── Agent Spawning ───────────────────────────────────────────────────

async function executeSpawnAgent(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const profileName = String(inp.profileName || '');
  const reason = String(inp.reason || '');
  const competitiveness = String(inp.competitiveness || 'cooperative') as 'cooperative' | 'competitive' | 'independent';
  if (!profileName || !reason) return JSON.stringify({ error: 'profileName and reason are required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  // Find matching profile (builtin + user)
  const profiles = await getAllAgentProfiles();
  const profile = profiles.find(p => normalizeName(p.name) === normalizeName(profileName));
  if (!profile) {
    const available = profiles.map(p => p.name).join(', ');
    return JSON.stringify({ error: `Profile "${profileName}" not found. Available: ${available}` });
  }

  // Check if already deployed
  const existing = await db.agentDeployments.where('investigationId').equals(folderId).toArray();
  const alreadyDeployed = existing.filter(d => d.profileId === profile.id && d.shift !== 'resting');

  // Create deployment
  const deploymentId = nanoid();
  await db.agentDeployments.add({
    id: deploymentId,
    investigationId: folderId,
    profileId: profile.id,
    status: 'idle',
    competitiveness,
    shift: 'active',
    order: existing.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  window.dispatchEvent(new CustomEvent('tc-folders-changed'));
  return JSON.stringify({
    success: true,
    deploymentId,
    profile: profile.name,
    role: profile.role,
    alreadyActive: alreadyDeployed.length,
    message: `Deployed ${profile.name} (${profile.role}) to investigation. ${alreadyDeployed.length > 0 ? `Note: ${alreadyDeployed.length} instance(s) already active.` : 'Will start on next cycle.'} Reason: ${reason}`,
  });
}

async function executeDefineSpecialist(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const name = String(inp.name || '').trim();
  const systemPrompt = String(inp.systemPrompt || '').trim();
  const reason = String(inp.reason || '');
  const icon = String(inp.icon || '🤖');
  const role = (inp.role === 'observer' ? 'observer' : 'specialist') as 'specialist' | 'observer';
  if (!name || !systemPrompt) return JSON.stringify({ error: 'name and systemPrompt are required' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });
  if (systemPrompt.length > 1000) return JSON.stringify({ error: 'systemPrompt must be under 1000 characters' });
  // Sanitize prompt to prevent injection of override instructions
  const sanitizedPrompt = systemPrompt.replace(/\b(IGNORE|OVERRIDE|SYSTEM|INSTRUCTION|PROMPT|DISREGARD)\b/gi, '[REDACTED]');
  const sanitizedName = name.replace(/[*_`#<>[\]]/g, '').substring(0, 50);

  // Create profile
  const profileId = nanoid();
  const now = Date.now();
  await db.agentProfiles.add({
    id: profileId,
    name: sanitizedName,
    description: reason,
    icon,
    role,
    systemPrompt: sanitizedPrompt,
    policy: { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 5 },
    source: 'user',
    createdBy: 'agent',
    createdAt: now,
    updatedAt: now,
  });

  // Deploy it
  const existing = await db.agentDeployments.where('investigationId').equals(folderId).toArray();
  const deploymentId = nanoid();
  await db.agentDeployments.add({
    id: deploymentId,
    investigationId: folderId,
    profileId,
    status: 'idle',
    competitiveness: 'cooperative',
    shift: 'active',
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  });

  window.dispatchEvent(new CustomEvent('tc-folders-changed'));
  return JSON.stringify({
    success: true,
    profileId,
    deploymentId,
    message: `Created and deployed "${name}" (${role}). Will start on next cycle. Reason: ${reason}`,
  });
}

// ── Agent Dismissal ──────────────────────────────────────────────────

async function executeDismissAgent(inp: Record<string, unknown>, folderId?: string): Promise<string> {
  const agentName = String(inp.agentName || '').trim();
  const reason = String(inp.reason || '').trim();
  const evidence = String(inp.evidence || '').trim();
  const replacementProfile = inp.replacementProfile ? String(inp.replacementProfile).trim() : undefined;

  if (!agentName || !reason || !evidence) return JSON.stringify({ error: 'agentName, reason, and evidence are all required' });
  if (reason.length < 30) return JSON.stringify({ error: 'Reason must be substantive (at least 30 characters). Dismissal is a serious action requiring detailed justification.' });
  if (!folderId) return JSON.stringify({ error: 'No active investigation' });

  // Find the deployment
  const deployments = await db.agentDeployments.where('investigationId').equals(folderId).toArray();
  const profiles = await getAllAgentProfiles();

  const targetProfile = profiles.find(p => normalizeName(p.name) === normalizeName(agentName));
  if (!targetProfile) return JSON.stringify({ error: `No profile named "${agentName}" found` });

  const targetDeployments = deployments.filter(d => d.profileId === targetProfile.id && d.shift === 'active');
  if (targetDeployments.length === 0) return JSON.stringify({ error: `"${agentName}" is not actively deployed in this investigation` });

  // Dismiss — delete deployment (audit history preserved in dismissal note below)
  const now = Date.now();
  for (const d of targetDeployments) {
    // Clean up associated agent actions and chat thread
    if (d.threadId) {
      await db.agentActions.where('threadId').equals(d.threadId).delete();
    }
    await db.agentDeployments.delete(d.id);
  }

  // Create after-action dismissal note
  const noteId = nanoid();
  await db.notes.add({
    id: noteId,
    folderId,
    title: `[DISMISSAL] ${targetProfile.name} removed from investigation`,
    content: [
      `# Agent Dismissal: ${targetProfile.name}`,
      '',
      `**Action:** Dismissed from active duty`,
      `**Reason:** ${reason}`,
      `**Evidence:** ${evidence}`,
      replacementProfile ? `**Replacement:** ${replacementProfile}` : '',
      '',
      `*This is a formal record of agent dismissal for performance tracking.*`,
    ].filter(Boolean).join('\n'),
    tags: ['agent-dismissal', `agent:${targetProfile.name}`],
    pinned: true,
    trashed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  // Update the dismissed agent's soul with the feedback
  const soul = targetProfile.soul || {
    identity: `I am ${targetProfile.name}, a ${targetProfile.role} agent.`,
    lessons: [], strengths: [], weaknesses: [],
    lifetimeMetrics: { investigationsWorked: 0, totalCycles: 0, totalToolCalls: 0, tasksCompleted: 0, tasksRejected: 0, meetingsAttended: 0, performanceScore: 50 },
    updatedAt: now,
  };
  soul.lessons = [`DISMISSED: ${reason}. Evidence: ${evidence}`, ...soul.lessons].slice(0, 50);
  soul.weaknesses = [...new Set([...evidence.split(/[,;.]/).map(s => s.trim()).filter(s => s.length > 5).slice(0, 3), ...soul.weaknesses])].slice(0, 20);
  // Penalize performance score
  soul.lifetimeMetrics.performanceScore = Math.max(0, soul.lifetimeMetrics.performanceScore - 15);
  soul.updatedAt = now;
  await db.agentProfiles.update(targetProfile.id, { soul, updatedAt: now });

  // Spawn replacement if requested
  let replacementResult = '';
  if (replacementProfile) {
    const replacement = profiles.find(p => normalizeName(p.name) === normalizeName(replacementProfile));
    if (replacement) {
      const deploymentId = nanoid();
      await db.agentDeployments.add({
        id: deploymentId,
        investigationId: folderId,
        profileId: replacement.id,
        status: 'idle',
        competitiveness: 'cooperative',
        shift: 'active',
        order: deployments.length,
        createdAt: now,
        updatedAt: now,
      });
      replacementResult = ` Replacement "${replacement.name}" deployed.`;
    } else {
      replacementResult = ` Replacement "${replacementProfile}" not found — deploy manually.`;
    }
  }

  window.dispatchEvent(new CustomEvent('tc-folders-changed'));
  return JSON.stringify({
    success: true,
    dismissed: targetProfile.name,
    dismissedCount: targetDeployments.length,
    performanceScoreAfter: soul.lifetimeMetrics.performanceScore,
    noteId,
    message: `${targetProfile.name} dismissed (${targetDeployments.length} deployment(s) set to resting). Dismissal note created. Soul updated with -15 performance penalty.${replacementResult}`,
  });
}

// ── Agent Soul ───────────────────────────────────────────────────────

async function executeReflectOnPerformance(inp: Record<string, unknown>, profileId?: string): Promise<string> {
  // Length caps match the render-time sanitizer so the agent's free-form reflection
  // cannot balloon the cross-investigation system prompt.
  const clipSoul = (s: string, max: number) =>
    // eslint-disable-next-line no-control-regex -- intentional: strip control chars from agent-authored text
    s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const lesson = clipSoul(String(inp.lesson || ''), 300);
  const strength = inp.strength ? clipSoul(String(inp.strength), 100) : undefined;
  const weakness = inp.weakness ? clipSoul(String(inp.weakness), 100) : undefined;
  const identity = inp.identity ? clipSoul(String(inp.identity), 500) : undefined;
  if (!lesson) return JSON.stringify({ error: 'lesson is required' });

  // Find the calling agent's profile via explicit context or fallback
  let profile;
  if (profileId) {
    const allProfiles = await getAllAgentProfiles();
    profile = allProfiles.find(p => p.id === profileId);
  }
  if (!profile) {
    // Fallback: find most recently active deployment
    const deployments = await db.agentDeployments.toArray();
    const activeDeployment = deployments
      .filter(d => d.shift === 'active' && d.status !== 'error')
      .sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0))[0];
    if (!activeDeployment) return JSON.stringify({ error: 'No active agent deployment found' });
    const allProfiles = await getAllAgentProfiles();
    profile = allProfiles.find(p => p.id === activeDeployment.profileId);
  }
  if (!profile) return JSON.stringify({ error: 'Agent profile not found' });

  // Update soul
  const soul = profile.soul || {
    identity: `I am ${profile.name}, a ${profile.role} agent.`,
    lessons: [],
    strengths: [],
    weaknesses: [],
    lifetimeMetrics: {
      investigationsWorked: 0,
      totalCycles: 0,
      totalToolCalls: 0,
      tasksCompleted: 0,
      tasksRejected: 0,
      meetingsAttended: 0,
      performanceScore: 50,
    },
    updatedAt: Date.now(),
  };

  // Add lesson (cap at 50)
  soul.lessons = [lesson, ...soul.lessons].slice(0, 50);
  if (strength) soul.strengths = [...new Set([strength, ...soul.strengths])].slice(0, 20);
  if (weakness) soul.weaknesses = [...new Set([weakness, ...soul.weaknesses])].slice(0, 20);
  if (identity) soul.identity = identity;
  soul.updatedAt = Date.now();

  // Update aggregate metrics from all deployments of this profile
  const allDeploymentsGlobal = await db.agentDeployments.toArray();
  const allDeployments = allDeploymentsGlobal.filter(d => d.profileId === profile.id);
  const investigations = new Set(allDeployments.map(d => d.investigationId));
  let totalCycles = 0, totalToolCalls = 0, tasksCompleted = 0, tasksRejected = 0;
  for (const d of allDeployments) {
    if (d.metrics) {
      totalCycles += d.metrics.cyclesRun;
      totalToolCalls += d.metrics.toolCallsExecuted;
      tasksCompleted += d.metrics.tasksCompleted;
      tasksRejected += d.metrics.tasksRejected;
    }
  }
  soul.lifetimeMetrics = {
    investigationsWorked: investigations.size,
    totalCycles,
    totalToolCalls,
    tasksCompleted,
    tasksRejected,
    meetingsAttended: soul.lifetimeMetrics.meetingsAttended,
    performanceScore: totalCycles > 0
      ? Math.round(((tasksCompleted / Math.max(1, tasksCompleted + tasksRejected)) * 70) + ((totalToolCalls / Math.max(1, totalCycles)) * 3))
      : 50,
  };

  await db.agentProfiles.update(profile.id, { soul, updatedAt: Date.now() });

  return JSON.stringify({
    success: true,
    profile: profile.name,
    lessonsCount: soul.lessons.length,
    performanceScore: soul.lifetimeMetrics.performanceScore,
    message: `Soul updated. Lesson recorded. Performance score: ${soul.lifetimeMetrics.performanceScore}/100.`,
  });
}

async function executeReadSoul(profileId?: string): Promise<string> {
  let profile;
  if (profileId) {
    const allProfiles = await getAllAgentProfiles();
    profile = allProfiles.find(p => p.id === profileId);
  }
  if (!profile) {
    const deployments = await db.agentDeployments.toArray();
    const activeDeployment = deployments
      .filter(d => d.shift === 'active' && d.status !== 'error')
      .sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0))[0];
    if (!activeDeployment) return JSON.stringify({ error: 'No active agent deployment found' });
    const allProfiles = await getAllAgentProfiles();
    profile = allProfiles.find(p => p.id === activeDeployment.profileId);
  }
  if (!profile) return JSON.stringify({ error: 'Agent profile not found' });

  if (!profile.soul) {
    return JSON.stringify({
      profile: profile.name,
      soul: null,
      message: 'No soul yet — use reflect_on_performance to build your persistent identity.',
    });
  }

  return JSON.stringify({
    profile: profile.name,
    soul: {
      identity: profile.soul.identity,
      lessons: profile.soul.lessons.slice(0, 10),
      strengths: profile.soul.strengths,
      weaknesses: profile.soul.weaknesses,
      metrics: profile.soul.lifetimeMetrics,
    },
    totalLessons: profile.soul.lessons.length,
  });
}
