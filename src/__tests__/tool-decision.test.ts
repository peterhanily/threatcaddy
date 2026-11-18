import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_POLICY, type AgentPolicy } from '../types';
import { decideToolCall, isPlanModeTool, isRoutineReach, type ToolReach, type ToolSurface, type Verdict } from '../lib/tool-reach';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS, isWriteTool } from '../lib/llm-tool-defs';
import { CROSS_CASE_READ_TOOLS, isEgressToolName } from '../lib/caddy-agent-policy';

const ALLOW: AgentPolicy = { ...DEFAULT_AGENT_POLICY, autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: true, autoApproveCreate: true, autoApproveModify: true };
const LOCKED: AgentPolicy = { ...DEFAULT_AGENT_POLICY, autoApproveReads: false, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false };
const SURFACES: ToolSurface[] = ['chat-act', 'chat-yolo', 'chat-plan', 'agent', 'supervisor', 'bridge'];

const reach = (overrides: Partial<ToolReach>): ToolReach => ({
  name: 'search_notes', write: false, homeFolderId: 'S', homeShareable: true, crossRead: false, crossWrite: false,
  targetFolderIds: [], hidden: false, egress: 'none', destinations: [], harvested: false, flags: [], ...overrides,
});
const label = (verdict: Verdict) => verdict.kind === 'ask' ? `ask:${verdict.reason}` : verdict.kind;

type Cell = string | undefined; // undefined = row not reached on that surface
type Row = [string, Partial<ToolReach>, Partial<Record<ToolSurface, Cell>>, Partial<Record<ToolSurface, Cell>>?];

// [row, reach, cells with an all-allow agent policy, agent cells that differ under an all-off policy]
const TABLE: Row[] = [
  ['1 hidden', { hidden: true, name: 'read_note' },
    { 'chat-act': 'deny', 'chat-yolo': 'deny', 'chat-plan': 'deny', agent: 'deny', supervisor: 'deny', bridge: 'deny' }],
  ['2 plan write', { write: true, name: 'create_note' }, { 'chat-plan': 'deny' }],
  ['2 plan egress', { egress: 'trusted-fetch', name: 'fetch_url' }, { 'chat-plan': 'deny' }],
  ['2 plan cross read', { crossRead: true, name: 'list_investigations', homeShareable: false }, { 'chat-plan': 'deny' }],
  ['3 never', { name: 'deploy_agent', write: true, agentControl: 'never' },
    { 'chat-act': 'ask:agent-control', 'chat-yolo': 'ask:agent-control', 'chat-plan': 'deny', agent: 'deny', supervisor: 'deny', bridge: 'deny' }],
  ['4 bridge cross read', { name: 'read_note', crossRead: true }, { bridge: 'deny' }],
  ['4 bridge cross write', { name: 'update_note', write: true, crossWrite: true }, { bridge: 'deny' }],
  ['4 bridge egress', { name: 'enrich_ioc', write: true, egress: 'vendor' }, { bridge: 'deny' }],
  ['4 bridge agent control', { name: 'spawn_agent', write: true, agentControl: 'ask' }, { bridge: 'deny' }],
  ['5 harvested write', { name: 'create_note', write: true, harvested: true },
    { 'chat-act': 'ask:harvested', 'chat-yolo': 'ask:harvested', 'chat-plan': 'deny', agent: 'ask:harvested', supervisor: 'ask:harvested' }],
  ['5 harvested in-scope read is routine', { name: 'search_notes', harvested: true },
    { 'chat-act': 'run', 'chat-yolo': 'run', 'chat-plan': 'run', agent: 'run', supervisor: 'run', bridge: 'run' }],
  ['6 agent control', { name: 'spawn_agent', write: true, agentControl: 'ask' },
    { 'chat-act': 'ask:agent-control', 'chat-yolo': 'ask:agent-control', 'chat-plan': 'deny', agent: 'ask:agent-control', supervisor: 'deny', bridge: 'deny' }],
  ['7 cross write', { name: 'update_note', write: true, crossWrite: true },
    { 'chat-act': 'ask:cross-write', 'chat-yolo': 'ask:cross-write', 'chat-plan': 'deny', agent: 'deny', supervisor: 'ask:cross-write', bridge: 'deny' }],
  ['8 cross read from a shared home', { name: 'read_note', crossRead: true, homeShareable: true },
    { 'chat-act': 'ask:cross-read', 'chat-yolo': 'ask:cross-read', 'chat-plan': 'deny', agent: 'deny', supervisor: 'run', bridge: 'deny' }],
  ['8 by-id cross read from a local-only home', { name: 'read_note', crossRead: true, homeShareable: false },
    { 'chat-act': 'run', 'chat-yolo': 'run', 'chat-plan': 'deny', agent: 'deny', supervisor: 'run' }],
  ['8 cross-case reader from a local-only home', { name: 'list_investigations', crossRead: true, homeShareable: false },
    { 'chat-act': 'run', 'chat-yolo': 'run', agent: 'run', supervisor: 'run' }, { agent: 'ask:cross-read' }],
  ['8 cross-case reader from a shared home', { name: 'list_investigations', crossRead: true, homeShareable: true },
    { 'chat-act': 'ask:cross-read', 'chat-yolo': 'ask:cross-read', agent: 'deny', supervisor: 'run', bridge: 'deny' }],
  ['9 open fetch', { name: 'fetch_url', egress: 'open-fetch' },
    { 'chat-act': 'ask:egress', 'chat-yolo': 'ask:egress', 'chat-plan': 'deny', agent: 'ask:egress', supervisor: 'deny', bridge: 'deny' }],
  ['10 trusted fetch', { name: 'fetch_url', egress: 'trusted-fetch' },
    { 'chat-act': 'ask:egress', 'chat-yolo': 'ask:egress', 'chat-plan': 'deny', agent: 'run', supervisor: 'deny', bridge: 'deny' }, { agent: 'ask:egress' }],
  ['11 vendor lookup', { name: 'enrich_ioc', write: true, egress: 'vendor' },
    { 'chat-act': 'ask:egress', 'chat-yolo': 'run', 'chat-plan': 'deny', agent: 'run', supervisor: 'deny', bridge: 'deny' }, { agent: 'ask:egress' }],
  ['12 configured system', { name: 'host:x:y', egress: 'configured' },
    { 'chat-act': 'ask:egress', 'chat-yolo': 'ask:egress', 'chat-plan': 'deny', agent: 'ask:egress', supervisor: 'deny', bridge: 'deny' }],
  ['13 in-scope write', { name: 'create_note', write: true },
    { 'chat-act': 'ask:write', 'chat-yolo': 'run', 'chat-plan': 'deny', agent: 'run', supervisor: 'run', bridge: 'run' }, { agent: 'ask:policy' }],
  ['13 delegation stays automatic', { name: 'delegate_task', write: true },
    { agent: 'run' }, { agent: 'run' }],
  ['14 in-scope read', { name: 'search_notes' },
    { 'chat-act': 'run', 'chat-yolo': 'run', 'chat-plan': 'run', agent: 'run', supervisor: 'run', bridge: 'run' }, { agent: 'ask:policy' }],
];

describe('A-DEC-1 decision table (design section 2.4)', () => {
  for (const [row, overrides, cells, lockedCells] of TABLE) {
    for (const surface of SURFACES) {
      const expected = cells[surface];
      if (expected === undefined) continue;
      it(`row ${row} on ${surface} with permissive policy → ${expected}`, () => {
        expect(label(decideToolCall(reach(overrides), { surface, policy: ALLOW }))).toBe(expected);
      });
    }
    for (const [surface, expected] of Object.entries(lockedCells ?? {})) {
      it(`row ${row} on ${surface} with all automatic approval off → ${expected}`, () => {
        expect(label(decideToolCall(reach(overrides), { surface: surface as ToolSurface, policy: LOCKED }))).toBe(expected);
      });
    }
  }

  it('asks on the agent surface when no policy was supplied', () => {
    expect(label(decideToolCall(reach({ name: 'create_note', write: true }), { surface: 'agent' }))).toBe('ask:policy');
    expect(label(decideToolCall(reach({ name: 'fetch_url', egress: 'trusted-fetch' }), { surface: 'agent' }))).toBe('ask:egress');
  });

  it('never says pending_approval in a refusal, which the agent loop reserves for queued calls', () => {
    for (const [, overrides] of TABLE) {
      for (const surface of SURFACES) {
        const verdict = decideToolCall(reach(overrides), { surface, policy: ALLOW });
        if (verdict.kind === 'deny') expect(verdict.message).not.toContain('pending_approval');
      }
    }
  });
});

describe('Plan-mode and routine helpers', () => {
  const ALL = [...TOOL_DEFINITIONS, ...DELEGATION_TOOL_DEFINITIONS, ...EXECUTIVE_TOOL_DEFINITIONS].map(tool => tool.name);

  it('every Plan-mode tool is a non-egress read that stays in the investigation', () => {
    const plan = ALL.filter(isPlanModeTool);
    expect(plan.length).toBeGreaterThan(10);
    for (const name of plan) {
      expect(isWriteTool(name)).toBe(false);
      expect(isEgressToolName(name)).toBe(false);
      expect(CROSS_CASE_READ_TOOLS.has(name)).toBe(false);
    }
    for (const name of ['fetch_url', 'query_siem', 'list_investigations', 'search_across_investigations', 'create_note', 'deploy_agent', 'reflect_on_performance', 'host:x:y', 'local:z']) {
      expect(isPlanModeTool(name)).toBe(false);
    }
    expect(isPlanModeTool('search_notes')).toBe(true);
  });

  it('routine reach is in-scope, offline, not agent control and not harvested', () => {
    expect(isRoutineReach(reach({ name: 'create_note', write: true }))).toBe(true);
    for (const overrides of [{ egress: 'open-fetch' as const }, { agentControl: 'ask' as const }, { crossWrite: true }, { crossRead: true }, { harvested: true }, { hidden: true }]) {
      expect(isRoutineReach(reach(overrides))).toBe(false);
    }
  });
});
