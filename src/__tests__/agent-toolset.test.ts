import { describe, it, expect } from 'vitest';
import { buildAgentToolset } from '../lib/caddy-agent';

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
