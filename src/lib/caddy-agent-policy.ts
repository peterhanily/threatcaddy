/**
 * CaddyAgent policy framework — maps tools to action classes and checks
 * whether a tool call should be auto-executed or proposed for human approval.
 */

import type { AgentActionClass, AgentPolicy } from '../types';

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

  // Delegation tools (lead agent only)
  delegate_task: 'create',
  review_completed_task: 'modify',
  list_agent_activity: 'read',
};

/** Get the action class for a tool name. Defaults to 'modify' for unknown tools. */
export function getToolActionClass(toolName: string): AgentActionClass {
  return TOOL_ACTION_CLASS[toolName] ?? 'modify';
}

/** Check if a tool call should be auto-approved given the investigation's agent policy. */
export function shouldAutoApprove(toolName: string, policy: AgentPolicy): boolean {
  const actionClass = getToolActionClass(toolName);
  switch (actionClass) {
    case 'read':    return policy.autoApproveReads;
    case 'enrich':  return policy.autoApproveEnrich;
    case 'fetch':   return policy.autoApproveFetch ?? policy.autoApproveEnrich;
    case 'create':  return policy.autoApproveCreate;
    case 'modify':  return policy.autoApproveModify;
    default:        return false;
  }
}
