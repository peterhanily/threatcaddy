/**
 * Agent Hosts — external REST API endpoints that ThreatCaddy agents can send
 * commands to. Each host exposes "skills" via GET /skills, and ThreatCaddy
 * generates dynamic LLM tool definitions from them.
 *
 * Host Protocol:
 *   GET  /skills  → AgentHostSkill[]
 *   POST /execute → { skill, parameters } → { result, error }
 */

import type { AgentHost, AgentHostSkill, Settings } from '../types';

const SKILLS_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 60_000;

// ── Skill Discovery ──────────────────────────────────────────────────

/**
 * Fetch available skills from an agent host's GET /skills endpoint.
 * Returns the parsed skill array, or throws on failure.
 */
export async function fetchHostSkills(host: AgentHost): Promise<AgentHostSkill[]> {
  const url = `${host.url.replace(/\/+$/, '')}/skills`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (host.apiKey) headers['Authorization'] = `Bearer ${host.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SKILLS_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);

    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('Expected JSON array of skills');

    // Validate each skill has at minimum name + description
    return data.filter(
      (s: unknown): s is AgentHostSkill =>
        typeof s === 'object' && s !== null &&
        typeof (s as AgentHostSkill).name === 'string' &&
        typeof (s as AgentHostSkill).description === 'string'
    ).map(s => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters || { type: 'object' as const, properties: {}, required: [] },
      actionClass: s.actionClass,
    }));
  } finally {
    clearTimeout(timer);
  }
}

// ── Dynamic Tool Definitions ─────────────────────────────────────────

/**
 * Generate LLM tool definitions from all enabled agent hosts' cached skills.
 * Tool names follow the pattern: host:<hostName>:<skillName>
 */
export function getHostToolDefinitions(settings: Settings): {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}[] {
  const hosts = (settings.agentHosts || []).filter(h => h.enabled && h.skills.length > 0);
  if (hosts.length === 0) return [];

  const tools: {
    name: string;
    description: string;
    input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
  }[] = [];

  for (const host of hosts) {
    for (const skill of host.skills) {
      tools.push({
        name: `host:${host.name}:${skill.name}`,
        description: `[${host.displayName}] ${skill.description}`,
        input_schema: {
          type: 'object' as const,
          properties: skill.parameters?.properties || {},
          required: (skill.parameters?.required || []) as string[],
        },
      });
    }
  }

  return tools;
}

// ── Skill Execution ──────────────────────────────────────────────────

/**
 * Execute a host skill. Tool name format: host:<hostName>:<skillName>
 * Sends POST to the host's /execute endpoint and returns the result string.
 */
export async function executeHostSkill(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Parse host:name:skill from tool name
  const parts = toolName.split(':');
  if (parts.length < 3 || parts[0] !== 'host') {
    return JSON.stringify({ error: `Invalid host tool name: ${toolName}` });
  }
  const hostName = parts[1];
  const skillName = parts.slice(2).join(':');

  // Look up host config
  const settings: Settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
  const hosts: AgentHost[] = settings.agentHosts || [];
  const host = hosts.find(h => h.name === hostName);

  if (!host) return JSON.stringify({ error: `Agent host not found: ${hostName}. Configure in Settings > AI > Agent Hosts.` });
  if (!host.enabled) return JSON.stringify({ error: `Agent host "${host.displayName}" is disabled.` });

  const url = `${host.url.replace(/\/+$/, '')}/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (host.apiKey) headers['Authorization'] = `Bearer ${host.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ skill: skillName, parameters: input }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => '');
      return JSON.stringify({ error: `Host ${host.displayName} returned ${resp.status}: ${errorBody.substring(0, 500)}` });
    }

    return await resp.text();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return JSON.stringify({ error: `Host ${host.displayName} timed out after ${EXECUTE_TIMEOUT_MS / 1000}s` });
    }
    return JSON.stringify({ error: `Host ${host.displayName} execution failed: ${(err as Error).message}` });
  } finally {
    clearTimeout(timer);
  }
}

// ── Action Class Resolution ──────────────────────────────────────────

/**
 * Look up the action class for a host skill tool from cached settings.
 * Returns the skill's declared actionClass, or 'fetch' as default.
 */
export function getHostSkillActionClass(toolName: string): string | undefined {
  const parts = toolName.split(':');
  if (parts.length < 3) return undefined;
  const hostName = parts[1];
  const skillName = parts.slice(2).join(':');

  const settings: Settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
  const hosts: AgentHost[] = settings.agentHosts || [];
  const host = hosts.find(h => h.name === hostName);
  const skill = host?.skills.find(s => s.name === skillName);
  return skill?.actionClass || 'fetch';
}
