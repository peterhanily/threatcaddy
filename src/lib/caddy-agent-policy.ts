/**
 * CaddyAgent policy framework — maps tools to action classes and checks
 * whether a tool call should be auto-executed or proposed for human approval.
 */

import type { AgentActionClass, AgentPolicy, Settings } from '../types';
import { workspaceStorageKey } from './workspace-profiles';

/** Map every tool to its action class for policy decisions. */
const TOOL_ACTION_CLASS: Record<string, AgentActionClass> = {
  // Read tools — always safe to auto-execute
  search_notes: 'read',
  search_all: 'read',
  read_note: 'read',
  read_task: 'read',
  read_ioc: 'read',
  read_timeline_event: 'read',
  list_tasks: 'read',
  list_iocs: 'read',
  list_timeline_events: 'read',
  get_investigation_summary: 'read',
  analyze_graph: 'read',
  list_investigations: 'read',
  get_investigation_details: 'read',
  search_across_investigations: 'read',
  compare_investigations: 'read',

  // Enrich tools — extract/analyze data without external calls
  extract_iocs: 'enrich',

  // Fetch tools — make external HTTP requests for OSINT/research
  fetch_url: 'fetch',

  // Create tools — produce new entities
  create_note: 'create',
  create_task: 'create',
  create_ioc: 'create',
  bulk_create_iocs: 'create',
  create_timeline_event: 'create',
  generate_report: 'create',
  create_in_investigation: 'create',
  link_entities: 'create',

  // Modify tools — change existing entities
  update_note: 'modify',
  update_task: 'modify',
  update_ioc: 'modify',
  update_timeline_event: 'modify',

  // Integration / enrichment tools
  enrich_ioc: 'enrich',
  list_integrations: 'read',

  // Knowledge / memory
  update_knowledge: 'create',
  recall_knowledge: 'read',

  // External systems
  run_remote_command: 'modify',   // high-impact — requires approval by default
  query_siem: 'fetch',
  create_ticket: 'create',

  // Alert ingestion
  ingest_alert: 'create',

  // Agent management (from CaddyAI chat)
  deploy_agent: 'create',
  stop_agent: 'modify',
  list_deployed_agents: 'read',
  run_agent_cycle: 'modify',

  // Folder management
  create_note_folder: 'create',
  delete_note_folder: 'modify',
  move_to_folder: 'modify',
  list_folders: 'read',

  // Forensicate.ai
  forensicate_scan: 'read',

  // Autonomy tools (lead agent only)
  ask_human: 'create',
  call_meeting: 'create',
  notify_human: 'create',
  declare_war_bridge: 'create',

  // Delegation tools (lead agent only) — 'delegate' class is always auto-approved
  // so a locked-down create/modify policy cannot silently break lead→specialist handoff.
  delegate_task: 'delegate',
  review_completed_task: 'delegate',
  list_agent_activity: 'read',
  reflect_on_performance: 'delegate',
  read_soul: 'read',
  // Executive tools remain gated under the user's create/modify toggles
  // because they change team composition (spawn/dismiss) or define new profiles.
  spawn_agent: 'create',
  define_specialist: 'create',
  dismiss_agent: 'modify',
};

/** Remote skills cannot grant themselves the trusted internal delegation class. */
export function normalizeHostActionClass(value: unknown): AgentActionClass {
  return value === 'read' || value === 'enrich' || value === 'fetch' || value === 'create' || value === 'modify'
    ? value
    : 'modify';
}

/** Resolve dynamic tool effects conservatively, including missing/stale settings. */
export function getDynamicToolActionClass(toolName: string, settings?: Settings): AgentActionClass {
  try {
    const stored: Settings = settings ?? JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}');
    if (toolName.startsWith('local:')) {
      const skill = stored.llmLocalSkills?.find(s => s.name === toolName.slice(6));
      return normalizeHostActionClass(skill?.actionClass);
    }
    const [, hostName, ...skillParts] = toolName.split(':');
    const host = stored.agentHosts?.find(h => h.name === hostName);
    const skill = host?.skills?.find(s => s.name === skillParts.join(':'));
    return normalizeHostActionClass(skill?.actionClass);
  } catch {
    return 'modify';
  }
}

/** Get the action class for a tool name. Defaults to 'modify' for unknown tools. */
export function getToolActionClass(toolName: string): AgentActionClass {
  if (Object.prototype.hasOwnProperty.call(TOOL_ACTION_CLASS, toolName)) return TOOL_ACTION_CLASS[toolName];

  // Dynamic skill tools — resolve from cached skill metadata in Settings
  if (toolName.startsWith('host:') || toolName.startsWith('local:')) {
    return getDynamicToolActionClass(toolName);
  }

  return 'modify';
}

/** Check if a tool call should be auto-approved given the investigation's agent policy. */
export function shouldAutoApprove(toolName: string, policy: AgentPolicy): boolean {
  const actionClass = getToolActionClass(toolName);
  switch (actionClass) {
    case 'read':     return policy.autoApproveReads;
    case 'enrich':   return policy.autoApproveEnrich;
    case 'fetch':    return policy.autoApproveFetch ?? policy.autoApproveEnrich;
    case 'create':   return policy.autoApproveCreate;
    case 'modify':   return policy.autoApproveModify;
    case 'delegate': return true;
    default:         return false;
  }
}
