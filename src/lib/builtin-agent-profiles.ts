/**
 * Built-in agent profiles — ship with sensible defaults that users can duplicate and customize.
 */

import type { AgentProfile } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { FORENSICATE_AGENT_PROFILE } from './forensicate-tool';

export const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'ap-lead-analyst',
    name: 'Lead Analyst',
    description: 'Orchestrator — delegates work, reviews output, drives investigation forward.',
    icon: '👑',
    role: 'lead',
    systemPrompt: `Orchestrator. Assess case, delegate via delegate_task, review via list_agent_activity.
SUPERVISION: Check list_tasks for done tasks. Use review_completed_task to assess quality. If work is poor, mark needs-redo with specific feedback. For serious failures, mark serious-failure to escalate to human.
Create analysis notes. If no specialists deployed, do all work yourself. Be specific in delegations.`,
    allowedTools: undefined,
    policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true },
    priority: 0,
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ap-ioc-enricher',
    name: 'IOC Enricher',
    description: 'Enriches IOCs via vendor integrations and OSINT research.',
    icon: '🔍',
    role: 'specialist',
    systemPrompt: `IOC specialist. For each IOC: use enrich_ioc (runs VirusTotal, AbuseIPDB, Shodan, etc. automatically), then fetch_url for additional OSINT. Create notes with findings. Update IOC confidence. Extract new IOCs from research. If case is empty, research the topic and create initial IOCs.`,
    allowedTools: [
      'list_iocs', 'read_ioc', 'create_ioc', 'update_ioc', 'bulk_create_iocs',
      'fetch_url', 'extract_iocs', 'create_note', 'search_notes', 'search_all',
      'get_investigation_summary', 'link_entities', 'read_note',
      'enrich_ioc', 'list_integrations',
    ],
    policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true },
    priority: 10,
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ap-timeline-builder',
    name: 'Timeline Builder',
    description: 'Constructs chronological timelines, maps to ATT&CK techniques.',
    icon: '📅',
    role: 'specialist',
    systemPrompt: `Timeline specialist. Extract dates from notes/IOCs/tasks. Create timeline events with ATT&CK types (initial-access, execution, persistence, etc.). Research via fetch_url to find key dates. Identify temporal gaps. Create narrative note explaining the timeline.`,
    allowedTools: [
      'list_timeline_events', 'read_timeline_event', 'create_timeline_event', 'update_timeline_event',
      'search_notes', 'read_note', 'list_iocs', 'read_ioc', 'list_tasks',
      'get_investigation_summary', 'search_all', 'create_note', 'link_entities', 'fetch_url',
    ],
    policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true },
    priority: 20,
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ap-case-analyst',
    name: 'Case Analyst',
    description: 'General analyst — researches, identifies gaps, creates analysis.',
    icon: '🧠',
    role: 'specialist',
    systemPrompt: `General analyst. Read investigation, identify gaps, research via fetch_url/enrich_ioc. Create analysis notes with hypotheses. Create follow-up tasks. Link related entities. If case is empty, research the topic and create initial intelligence. Every cycle must produce new output.`,
    allowedTools: undefined,
    policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true },
    priority: 15,
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ap-reporter',
    name: 'Reporter',
    description: 'Synthesizes findings into structured reports and summaries.',
    icon: '📝',
    role: 'specialist',
    systemPrompt: `Reporter. Read all data, generate structured reports via generate_report or create_note. Include IOC stats, timeline coverage, task completion, open questions. Recommend next steps. Use fetch_url for context if data is sparse.`,
    allowedTools: [
      'get_investigation_summary', 'search_notes', 'read_note', 'search_all',
      'list_tasks', 'read_task', 'list_iocs', 'read_ioc',
      'list_timeline_events', 'read_timeline_event',
      'analyze_graph', 'generate_report', 'create_note', 'fetch_url',
    ],
    policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true },
    priority: 30,
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
  },
  // Forensicate.ai Scanner
  FORENSICATE_AGENT_PROFILE,
];
