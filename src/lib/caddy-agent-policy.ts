/**
 * CaddyAgent policy framework — maps tools to action classes and checks
 * whether a tool call should be auto-executed or proposed for human approval.
 */

import { DEFAULT_AGENT_POLICY, type AgentActionClass, type AgentPolicy, type Settings } from '../types';
import { workspaceStorageKey } from './workspace-profiles';

export const CROSS_CASE_READ_TOOLS: ReadonlySet<string> = new Set([
  'list_investigations', 'get_investigation_details', 'search_across_investigations', 'compare_investigations']);
/** Never in any agent toolset, any agent role, legacy included. Chat may use them with a card. */
export const AGENT_NEVER_TOOLS: ReadonlySet<string> = new Set([
  'deploy_agent', 'stop_agent', 'run_agent_cycle', 'create_in_investigation', 'run_remote_command']);
/** Agent-configuration changes: always need a person (chat card or queued proposal). */
export const AGENT_CONTROL_TOOLS: ReadonlySet<string> = new Set([
  'spawn_agent', 'define_specialist', 'dismiss_agent', 'reflect_on_performance']);
/** Tools over people and their details (personal data). Agents get them like other tools (a
 * profile that lists its tools gets only those it lists), but never through the agent bridge,
 * and an agent's identity write always needs a person's approval. */
export const IDENTITY_TOOLS: ReadonlySet<string> = new Set(['search_identities', 'read_identity', 'create_identity', 'update_identity', 'connect_identities']);
export const IDENTITY_WRITE_TOOLS: ReadonlySet<string> = new Set(['create_identity', 'update_identity', 'connect_identities']);
/** Offered to an agent only when its profile lists them explicitly. Cross-case readers also need a local-only home. */
export const EXPLICIT_ONLY_TOOLS: ReadonlySet<string> = new Set([...CROSS_CASE_READ_TOOLS, 'query_siem', 'create_ticket']);
export const isEgressToolName = (n: string) =>
  ['fetch_url', 'enrich_ioc', 'query_siem', 'create_ticket'].includes(n) || n.startsWith('host:') || n.startsWith('local:');
/** Owner decision D2. https only, exact host, no credentials, default port, href <= 2048. */
export const AGENT_AUTO_FETCH_HOSTS: readonly string[] = ['nvd.nist.gov', 'services.nvd.nist.gov', 'www.cve.org',
  'cve.mitre.org', 'cwe.mitre.org', 'attack.mitre.org', 'www.cisa.gov', 'api.first.org'];
export function isTrustedFetchUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.port === ''
    && parsed.href.length <= 2048 && AGENT_AUTO_FETCH_HOSTS.includes(parsed.hostname);
}
export const MAX_ACTIVE_DEPLOYMENTS_PER_INVESTIGATION = 8;

const POLICY_FLAGS = ['autoApproveReads', 'autoApproveEnrich', 'autoApproveFetch', 'autoApproveCreate', 'autoApproveModify'] as const;
/** Fetch predates its own flag; older policies inherit it from Enrich (see shouldAutoApprove). */
const policyFlag = (policy: Partial<AgentPolicy>, key: typeof POLICY_FLAGS[number]) =>
  key === 'autoApproveFetch' ? policy.autoApproveFetch ?? policy.autoApproveEnrich : policy[key];

/** M-AGENT-POLICY-OVERRIDE. Pure. The investigation policy is a ceiling and
 * deployment overrides can only clear a flag; neither a profile nor an override
 * can grant what the investigation turned off. */
export function resolveEffectivePolicy(folderPolicy: AgentPolicy | undefined, profilePolicy: AgentPolicy | undefined,
  overrides: Partial<AgentPolicy> | undefined, hasProfile: boolean): AgentPolicy {
  const effective: AgentPolicy = { ...(folderPolicy ?? DEFAULT_AGENT_POLICY), ...profilePolicy, ...overrides };
  for (const key of POLICY_FLAGS) {
    const base = (hasProfile ? profilePolicy && policyFlag(profilePolicy, key) : policyFlag(folderPolicy ?? DEFAULT_AGENT_POLICY, key))
      ?? DEFAULT_AGENT_POLICY[key];
    const ceiling = folderPolicy ? policyFlag(folderPolicy, key) !== false : true;
    effective[key] = base && ceiling && overrides?.[key] !== false;
  }
  return effective;
}

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
  search_identities: 'read',
  read_identity: 'read',

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
  create_identity: 'create',
  connect_identities: 'create',

  // Modify tools — change existing entities
  update_note: 'modify',
  update_task: 'modify',
  update_ioc: 'modify',
  update_timeline_event: 'modify',
  update_identity: 'modify',

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
  // Owner decision: agents create and change identities only with a person's approval.
  if (IDENTITY_WRITE_TOOLS.has(toolName)) return false;
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
