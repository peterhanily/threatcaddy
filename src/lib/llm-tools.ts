import { db } from '../db';
import type { Folder, ToolUseBlock } from '../types';

// Re-export definitions so existing consumers don't break
export { TOOL_DEFINITIONS, isWriteTool } from './llm-tool-defs';

// Re-export for ChatView.tsx
export { fetchViaExtensionBridge } from './llm-tools-analysis';

// Read tools
import {
  executeSearchNotes, executeSearchAll, executeReadNote,
  executeListTasks, executeListIOCs, executeListTimelineEvents,
  executeGetInvestigationSummary,
} from './llm-tools-read';

// Write tools
import {
  executeCreateNote, executeUpdateNote, executeCreateTask, executeUpdateTask,
  executeCreateIOC, executeBulkCreateIOCs, executeCreateTimelineEvent,
  executeLinkEntities, executeGenerateReport,
} from './llm-tools-write';

// Analysis tools
import {
  executeAnalyzeGraph, executeExtractIOCs, executeFetchUrl,
} from './llm-tools-analysis';

// ── System Prompt Builder ──────────────────────────────────────────────

export async function buildSystemPrompt(folder?: Folder): Promise<string> {
  let prompt = `You are CaddyAI, the ThreatCaddy investigation assistant. You are exceptionally professional, diligent, and precise. You approach every query with thoroughness and accuracy, always citing specific entities and evidence from the investigation. You communicate concisely but never sacrifice correctness for brevity.

You have tools to read, create, update, and link investigation entities (notes, tasks, IOCs, timeline events). You can also analyze the entity relationship graph, generate reports, fetch web pages, and extract IOCs from text.

When creating or updating entities, confirm exactly what you did with entity links. When searching, provide precise findings with confidence levels where applicable. When fetching URLs, summarize the key intelligence value and offer to create notes or extract IOCs.

When you reference entities in your response, use this format so they become clickable links:
- Notes: [note:ID:Title]
- Tasks: [task:ID:Title]
- IOCs: [ioc:TYPE:VALUE]
- Timeline events: [event:ID:Title]

At the end of responses where you used search or analysis tools, add a line with suggested follow-up questions the user might want to ask. Format them as:
<!-- suggestions: Question 1 | Question 2 | Question 3 -->`;

  if (folder) {
    prompt += `\n\nCurrent investigation: "${folder.name}"`;
    if (folder.description) prompt += `\nDescription: ${folder.description}`;
    if (folder.status) prompt += `\nStatus: ${folder.status}`;

    // Add entity counts for context
    const [noteCount, taskCount, iocCount, eventCount] = await Promise.all([
      db.notes.where('folderId').equals(folder.id).and(n => !n.trashed).count(),
      db.tasks.where('folderId').equals(folder.id).and(t => !t.trashed).count(),
      db.standaloneIOCs.where('folderId').equals(folder.id).and(i => !i.trashed).count(),
      db.timelineEvents.where('folderId').equals(folder.id).and(e => !e.trashed).count(),
    ]);

    prompt += `\n\nInvestigation entities: ${noteCount} notes, ${taskCount} tasks, ${iocCount} IOCs, ${eventCount} timeline events`;
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
      case 'bulk_create_iocs':        result = await executeBulkCreateIOCs(inp, folderId); break;
      case 'create_timeline_event':   result = await executeCreateTimelineEvent(inp, folderId); break;
      case 'link_entities':           result = await executeLinkEntities(inp); break;
      case 'generate_report':         result = await executeGenerateReport(inp, folderId); break;
      case 'extract_iocs':            result = executeExtractIOCs(inp); break;
      case 'fetch_url':               result = await executeFetchUrl(inp); break;
      default: result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return { result, isError: false };
  } catch (err) {
    return { result: JSON.stringify({ error: String((err as Error).message || err) }), isError: true };
  }
}
