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

type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
};

/**
 * Generate LLM tool definitions from:
 * 1. Local LLM endpoint skills (prefix: local:<skill>)
 * 2. Additional agent hosts' cached skills (prefix: host:<hostName>:<skill>)
 */
export function getHostToolDefinitions(settings: Settings): ToolDef[] {
  const tools: ToolDef[] = [];

  // Local LLM skills — discovered from the same endpoint used for chat
  const localSkills = settings.llmLocalSkills || [];
  if (settings.llmLocalEndpoint && localSkills.length > 0) {
    for (const skill of localSkills) {
      tools.push({
        name: `local:${skill.name}`,
        description: `[Local Agent] ${skill.description}`,
        input_schema: {
          type: 'object' as const,
          properties: skill.parameters?.properties || {},
          required: (skill.parameters?.required || []) as string[],
        },
      });
    }
  }

  // Additional agent hosts
  const hosts = (settings.agentHosts || []).filter(h => h.enabled && h.skills.length > 0);
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
 * Execute a host skill. Supports two formats:
 *   local:<skillName>         — uses the local LLM endpoint
 *   host:<hostName>:<skill>   — uses a named agent host
 */
export async function executeHostSkill(
  toolName: string,
  input: Record<string, unknown>,
  settings?: Settings,
): Promise<string> {
  const s: Settings = settings || JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');

  // local:<skill> — route to the local LLM endpoint
  if (toolName.startsWith('local:')) {
    const skillName = toolName.slice(6);
    if (!s.llmLocalEndpoint) return JSON.stringify({ error: 'No local LLM endpoint configured. Set it in Settings > AI.' });

    const baseUrl = s.llmLocalEndpoint.replace(/\/+$/, '').replace(/\/v1\/?$/, '');
    return await callHostExecute(baseUrl, s.llmLocalApiKey, skillName, input, 'Local Agent');
  }

  // host:<name>:<skill> — route to a named agent host
  const parts = toolName.split(':');
  if (parts.length < 3 || parts[0] !== 'host') {
    return JSON.stringify({ error: `Invalid host tool name: ${toolName}` });
  }
  const hostName = parts[1];
  const skillName = parts.slice(2).join(':');

  const hosts: AgentHost[] = s.agentHosts || [];
  const host = hosts.find(h => h.name === hostName);

  if (!host) return JSON.stringify({ error: `Agent host not found: ${hostName}. Configure in Settings > AI > Agent Hosts.` });
  if (!host.enabled) return JSON.stringify({ error: `Agent host "${host.displayName}" is disabled.` });

  return await callHostExecute(host.url, host.apiKey, skillName, input, host.displayName);
}

/** Shared POST /execute call for both local and named hosts. */
async function callHostExecute(
  baseUrl: string,
  apiKey: string | undefined,
  skillName: string,
  input: Record<string, unknown>,
  displayName: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'local') headers['Authorization'] = `Bearer ${apiKey}`;

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
      return JSON.stringify({ error: `${displayName} returned HTTP ${resp.status}` });
    }

    return await resp.text();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return JSON.stringify({ error: `${displayName} timed out after ${EXECUTE_TIMEOUT_MS / 1000}s` });
    }
    return JSON.stringify({ error: `${displayName} execution failed: ${(err as Error).message}` });
  } finally {
    clearTimeout(timer);
  }
}

// ── Action Class Resolution ──────────────────────────────────────────

/**
 * Look up the action class for a host/local skill tool from cached settings.
 * Returns the skill's declared actionClass, or 'fetch' as default.
 */
export function getHostSkillActionClass(toolName: string): string {
  const settings: Settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');

  // local:<skill>
  if (toolName.startsWith('local:')) {
    const skillName = toolName.slice(6);
    const skill = (settings.llmLocalSkills || []).find(s => s.name === skillName);
    return skill?.actionClass || 'modify';
  }

  // host:<name>:<skill>
  const parts = toolName.split(':');
  if (parts.length >= 3) {
    const hostName = parts[1];
    const skillName = parts.slice(2).join(':');
    const hosts: AgentHost[] = settings.agentHosts || [];
    const host = hosts.find(h => h.name === hostName);
    const skill = host?.skills.find(s => s.name === skillName);
    return skill?.actionClass || 'modify';
  }

  return 'modify';
}
