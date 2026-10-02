import type { ToolUseBlock } from '../types';

/** Direct local effects, including side effects outside a tool's display name.
 * Unknown/remote execution cannot promise entity isolation and fails closed for
 * restricted profiles. Keep this contract in sync with the dispatcher. */
const effects: Record<string, readonly string[]> = {
  search_notes: [], search_all: [], read_note: [], read_task: [], read_ioc: [], read_timeline_event: [],
  list_tasks: [], list_iocs: [], list_timeline_events: [], get_investigation_summary: [], analyze_graph: [],
  list_investigations: [], get_investigation_details: [], search_across_investigations: [], compare_investigations: [],
  extract_iocs: [], fetch_url: [], list_integrations: [], recall_knowledge: [], query_siem: [],
  list_agent_activity: [], list_deployed_agents: [], list_folders: [], read_soul: [], forensicate_scan: [],
  create_note: ['note'], update_note: ['note'], generate_report: ['note'], update_knowledge: ['note'],
  call_meeting: ['note'], notify_human: ['note'], declare_war_bridge: ['note'], ingest_alert: ['note'],
  create_note_folder: ['note', 'folder'], delete_note_folder: ['note', 'folder'], move_to_folder: ['note'],
  create_task: ['task'], update_task: ['task'], delegate_task: ['task'], create_ticket: ['task'],
  review_completed_task: ['task', 'note', 'agent'], ask_human: ['note', 'agent'],
  create_ioc: ['ioc'], update_ioc: ['ioc'], bulk_create_iocs: ['ioc'], enrich_ioc: ['ioc', 'note', 'integration'],
  create_timeline_event: ['timeline'], update_timeline_event: ['timeline'],
  reflect_on_performance: ['agent'], stop_agent: ['agent'], dismiss_agent: ['agent', 'note'],
  // These can start another agent or execute arbitrary configured work.
  deploy_agent: ['*'], spawn_agent: ['*'], define_specialist: ['*'], run_agent_cycle: ['*'], run_remote_command: ['*'],
};
const canonicalType = (type: string) => type === 'timeline-event' ? 'timeline' : type;

export function getToolEntityEffects(tool: ToolUseBlock): readonly string[] {
  if (tool.name === 'create_in_investigation') {
    const type = canonicalType(String(tool.input.entityType));
    return ['note', 'task', 'ioc', 'timeline'].includes(type) ? [type] : ['*'];
  }
  if (tool.name === 'link_entities') {
    if (!Array.isArray(tool.input.links)) return ['*'];
    const types = tool.input.links.map(link => canonicalType(String(link?.sourceType)));
    return types.every(type => ['note', 'task', 'timeline'].includes(type)) ? [...new Set(types)] : ['*'];
  }
  return effects[tool.name] ?? ['*'];
}

export function getReadOnlyEntityError(tool: ToolUseBlock, readOnlyTypes?: readonly string[]): string | undefined {
  if (!readOnlyTypes?.length) return;
  const writes = getToolEntityEffects(tool);
  if (writes.includes('*')) return `Tool "${tool.name}" cannot guarantee this agent's read-only entity restrictions.`;
  const blocked = readOnlyTypes.map(canonicalType).filter(type => writes.includes(type));
  if (blocked.length) return `Cannot modify "${blocked.join(', ')}" entities — read-only restriction.`;
}
