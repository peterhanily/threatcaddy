import { beforeEach, describe, it, expect, vi } from 'vitest';
import { buildAgentToolset, runAgentCycle } from '../lib/caddy-agent';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { AGENT_NEVER_TOOLS, CROSS_CASE_READ_TOOLS, EXPLICIT_ONLY_TOOLS, getToolActionClass } from '../lib/caddy-agent-policy';
import { DEFAULT_SETTINGS, type AgentProfile, type Folder } from '../types';
import { db } from '../db';
import { scriptedLLM } from './helpers/scripted-llm';
import { seedAIWorkspace } from './helpers/ai-workspace';

vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));

// Fixture: simplified tool defs just enough to exercise the allowlist logic.
const BASE = [
  { name: 'search_notes' },       // read
  { name: 'list_iocs' },          // read
  { name: 'create_note' },        // create
  { name: 'update_note' },        // modify
  { name: 'enrich_ioc' },         // enrich
  { name: 'fetch_url' },          // fetch
];
const DELEG = [
  { name: 'delegate_task' },      // delegate
  { name: 'review_completed_task' },
];
const EXEC = [
  { name: 'spawn_agent' },
  { name: 'dismiss_agent' },
];
const HOSTS = [
  { name: 'host:soc1:scan' },
];

const CLASS: Record<string, string> = {
  search_notes: 'read',
  list_iocs: 'read',
  create_note: 'create',
  update_note: 'modify',
  enrich_ioc: 'enrich',
  fetch_url: 'fetch',
  delegate_task: 'delegate',
  review_completed_task: 'delegate',
  spawn_agent: 'create',
  dismiss_agent: 'modify',
  'host:soc1:scan': 'fetch',
};

const cls = (name: string) => CLASS[name] || 'modify';

function build(profile: { role?: string; allowedTools?: string[] } | undefined) {
  return buildAgentToolset({
    profile,
    baseTools: BASE,
    delegationTools: DELEG,
    executiveTools: EXEC,
    hostTools: HOSTS,
    getActionClass: cls,
    homeShareable: true,
  });
}

describe('buildAgentToolset', () => {
  it('legacy path (no profile): base + host tools, no delegation/exec', () => {
    const { availableTools, effectiveAllowedTools } = build(undefined);
    const names = availableTools.map(t => t.name);
    expect(names).toContain('search_notes');
    expect(names).toContain('host:soc1:scan');
    expect(names).not.toContain('delegate_task');
    expect(names).not.toContain('spawn_agent');
    expect(effectiveAllowedTools).toEqual(new Set(names));
  });

  it('specialist with allowedTools: delegation tools are never visible', () => {
    const { availableTools, effectiveAllowedTools } = build({
      role: 'specialist',
      allowedTools: ['search_notes', 'create_note', 'enrich_ioc'],
    });
    const names = availableTools.map(t => t.name);
    expect(names).toEqual(['search_notes', 'create_note', 'enrich_ioc']);
    expect(names).not.toContain('delegate_task');
    expect(names).not.toContain('review_completed_task');
    expect(names).not.toContain('spawn_agent');
    expect(effectiveAllowedTools.has('delegate_task')).toBe(false);
  });

  it('lead: gets delegation tools even when not in allowedTools', () => {
    const { availableTools, effectiveAllowedTools } = build({
      role: 'lead',
      allowedTools: ['search_notes', 'create_note'],
    });
    const names = availableTools.map(t => t.name);
    expect(names).toContain('delegate_task');
    expect(names).toContain('review_completed_task');
    expect(names).not.toContain('spawn_agent'); // executive-only
    // Runtime allowlist matches exactly what the LLM sees
    expect(effectiveAllowedTools).toEqual(new Set(names));
    // Lead can still call delegate_task at runtime even though it's not in profile.allowedTools
    expect(effectiveAllowedTools.has('delegate_task')).toBe(true);
  });

  it('executive: gets delegation + executive tools', () => {
    const { availableTools } = build({ role: 'executive', allowedTools: ['search_notes'] });
    const names = availableTools.map(t => t.name);
    expect(names).toContain('delegate_task');
    expect(names).toContain('spawn_agent');
    expect(names).toContain('dismiss_agent');
  });

  it('observer: reads only, plus explicitly-allowed create tools', () => {
    const { availableTools } = build({
      role: 'observer',
      allowedTools: ['search_notes', 'list_iocs', 'create_note'],
    });
    const names = availableTools.map(t => t.name);
    expect(names).toContain('search_notes');
    expect(names).toContain('list_iocs');
    expect(names).toContain('create_note'); // explicitly allowed create
    expect(names).not.toContain('update_note'); // modify — denied
    expect(names).not.toContain('enrich_ioc');  // enrich — denied
    expect(names).not.toContain('delegate_task');
    expect(names).not.toContain('host:soc1:scan'); // hosts forbidden for observers
  });

  it('observer without explicit create in allowedTools never gets create tools', () => {
    const { availableTools } = build({
      role: 'observer',
      allowedTools: ['search_notes', 'list_iocs'],
    });
    const names = availableTools.map(t => t.name);
    expect(names).not.toContain('create_note');
  });

  it('runtime allowlist always matches prompt-visible tool names exactly', () => {
    const roles: Array<{ role: string; allowedTools?: string[] }> = [
      { role: 'specialist', allowedTools: ['search_notes', 'create_note'] },
      { role: 'lead', allowedTools: ['search_notes'] },
      { role: 'executive', allowedTools: ['search_notes'] },
      { role: 'observer', allowedTools: ['search_notes', 'create_note'] },
    ];
    for (const profile of roles) {
      const { availableTools, effectiveAllowedTools } = build(profile);
      expect(effectiveAllowedTools).toEqual(new Set(availableTools.map(t => t.name)));
    }
  });

  it('specialist with unset allowedTools: gets all base + host tools, no delegation', () => {
    const { availableTools } = build({ role: 'specialist' });
    const names = availableTools.map(t => t.name);
    expect(names).toContain('search_notes');
    expect(names).toContain('update_note');
    expect(names).toContain('host:soc1:scan');
    expect(names).not.toContain('delegate_task');
  });

  it('host tools respect profile.allowedTools when set', () => {
    const { availableTools } = build({
      role: 'specialist',
      allowedTools: ['search_notes'], // host:soc1:scan not listed
    });
    expect(availableTools.find(t => t.name === 'host:soc1:scan')).toBeUndefined();
  });
});

// ── A-TOOLSET-1: the real tool definitions ─────────────────────────────

/** define_specialist's explicit list (llm-tools.ts executeDefineSpecialist). */
const DEFINED_SPECIALIST_TOOLS = ['search_notes', 'search_all', 'read_note', 'read_task', 'read_ioc', 'read_timeline_event',
  'list_tasks', 'list_iocs', 'list_timeline_events', 'get_investigation_summary', 'create_note', 'create_task'];
const DELEGATION = new Set(DELEGATION_TOOL_DEFINITIONS.map(t => t.name));
const EXECUTIVE = new Set(EXECUTIVE_TOOL_DEFINITIONS.map(t => t.name));
type ProfileLike = Pick<AgentProfile, 'role' | 'allowedTools'> & { id?: string };
const PROFILES: Array<[string, ProfileLike | undefined]> = [
  ...BUILTIN_AGENT_PROFILES.map(profile => [profile.id, profile] as [string, ProfileLike]),
  ['legacy', undefined],
  ['unrestricted user profile', { role: 'specialist' }],
  ['unrestricted user executive', { role: 'executive' }],
  ['define_specialist profile', { role: 'specialist', allowedTools: DEFINED_SPECIALIST_TOOLS }],
];

describe('A-TOOLSET-1 agent toolsets over the real tool definitions', () => {
  it('covers all 18 builtin profiles', () => {
    expect(BUILTIN_AGENT_PROFILES).toHaveLength(18);
  });

  for (const homeShareable of [true, false]) {
    for (const [label, profile] of PROFILES) {
      it(`${label} in a ${homeShareable ? 'shareable' : 'local-only'} investigation`, () => {
        const { availableTools, effectiveAllowedTools } = buildAgentToolset({
          profile, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS,
          executiveTools: EXECUTIVE_TOOL_DEFINITIONS, hostTools: [], getActionClass: getToolActionClass, homeShareable,
        });
        const names = availableTools.map(t => t.name);
        expect(effectiveAllowedTools).toEqual(new Set(names));
        expect(names.filter(name => AGENT_NEVER_TOOLS.has(name))).toEqual([]);
        for (const name of names.filter(n => EXPLICIT_ONLY_TOOLS.has(n))) expect(profile?.allowedTools).toContain(name);
        const crossCase = names.filter(name => CROSS_CASE_READ_TOOLS.has(name));
        expect(crossCase.length > 0).toBe(profile?.id === 'ap-pattern-hunter' && !homeShareable);
        if (!profile || profile.role === 'specialist' || profile.role === 'observer') {
          expect(names.filter(name => DELEGATION.has(name) || EXECUTIVE.has(name))).toEqual([]);
        }
      });
    }
  }

  it('Pattern Hunter keeps all four readers only in a local-only investigation', () => {
    const hunter = BUILTIN_AGENT_PROFILES.find(p => p.id === 'ap-pattern-hunter');
    const build = (homeShareable: boolean) => buildAgentToolset({ profile: hunter, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS,
      executiveTools: EXECUTIVE_TOOL_DEFINITIONS, hostTools: [], getActionClass: getToolActionClass, homeShareable }).effectiveAllowedTools;
    expect([...CROSS_CASE_READ_TOOLS].every(name => build(false).has(name))).toBe(true);
    expect([...CROSS_CASE_READ_TOOLS].some(name => build(true).has(name))).toBe(false);
  });
});

describe('A-TOOLSET-1 in a running cycle', () => {
  const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'test-key', llmRoutingMode: 'extension' as const };
  beforeEach(async () => { await seedAIWorkspace(); scriptedLLM.reset(); });

  it('a legacy agent in a shared investigation is offered no lifecycle, cross-case, SIEM or ticket tools, and a forced call is refused', async () => {
    scriptedLLM.script({ toolCalls: [{ name: 'deploy_agent', input: { profileName: 'Threat Hunter' } }] });
    const result = await runAgentCycle(await db.folders.get('S') as Folder, settings, true);
    expect(result.error).toBeUndefined();
    const offered = scriptedLLM.toolNames();
    expect(offered).toContain('create_note');
    for (const name of [...AGENT_NEVER_TOOLS, ...EXPLICIT_ONLY_TOOLS]) expect(offered).not.toContain(name);
    expect((await db.agentActions.toArray()).filter(action => action.toolName === 'deploy_agent')).toEqual([]);
    expect(await db.agentDeployments.count()).toBe(0);
  });

  it('Pattern Hunter in a local-only investigation is offered the cross-case readers', async () => {
    const hunter = BUILTIN_AGENT_PROFILES.find(p => p.id === 'ap-pattern-hunter');
    await runAgentCycle(await db.folders.get('L2') as Folder, settings, true, undefined, hunter);
    expect(scriptedLLM.toolNames()).toEqual(expect.arrayContaining([...CROSS_CASE_READ_TOOLS]));
    scriptedLLM.reset();
    await runAgentCycle(await db.folders.get('S') as Folder, settings, true, undefined, hunter);
    expect(scriptedLLM.toolNames().filter(name => CROSS_CASE_READ_TOOLS.has(name))).toEqual([]);
  });
});
