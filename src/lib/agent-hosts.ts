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
import { getDynamicToolActionClass, normalizeHostActionClass } from './caddy-agent-policy';
import { workspaceStorageKey } from './workspace-profiles';
import { assertConfiguredConnection } from './connection-policy';
import { readBoundedText } from './bounded-response';
import { cancellableRequest } from './request-cancellation';

const SKILLS_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_CHARS = 500;

/**
 * Strip bearer tokens, authorization headers, and credential-like params from a
 * string before surfacing it to the LLM or audit log. Upstream servers have been
 * observed to echo the caller's Authorization header in error bodies.
 */
function redactAuth(s: string): string {
  return s
    .replace(/Authorization\s*:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [redacted]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[redacted]');
}

/** Control characters become spaces; invisible format, private-use and lone surrogate characters go. */
function stripInvisible(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- intentional: strip control chars from host-authored text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, '');
}

/** Host-authored skill text, capped at 200 characters without control, invisible format
 * or private-use characters. Applied at discovery and again to descriptions stored by older versions. */
function sanitizeSkillDescription(description: string): string {
  const text = stripInvisible(description).replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, 200).join('');
}

const MAX_SKILL_SCHEMA_CHARS = 2000;
const PARAMETER_NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
/** Removed in turn while a schema is over the size cap; the last step leaves names and types. */
const SCHEMA_DEGRADE_STEPS: ReadonlySet<string>[] = [
  new Set(),
  new Set(['description', 'title']),
  new Set(['description', 'title', 'examples', 'example', 'default']),
];

/** Host-authored parameter schema: every string and key stripped like skill text, descriptions and
 * titles capped, parameters with unsafe names dropped (from `required` too). Over 2000 JSON chars it
 * loses descriptions and titles, then examples and defaults, and only then all parameters. */
function sanitizeSkillParameters(parameters: unknown): ToolDef['input_schema'] {
  const empty = { type: 'object' as const, properties: {}, required: [] };
  const names = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string').map(stripInvisible).filter(name => PARAMETER_NAME_RE.test(name)) : [];
  // `key` is the schema keyword holding `value`; a `properties` map holds parameter schemas under parameter names.
  const clean = (value: unknown, drop: ReadonlySet<string>, key?: string): unknown =>
    typeof value === 'string' ? (key === 'description' || key === 'title' ? sanitizeSkillDescription(value) : stripInvisible(value))
    : Array.isArray(value) ? (key === 'required' ? names(value) : value.map(item => clean(item, drop)))
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).flatMap(([raw, item]) => {
      const name = stripInvisible(raw);
      if (key === 'properties') return PARAMETER_NAME_RE.test(name) ? [[name, clean(item, drop)]] : [];
      return drop.has(name) ? [] : [[name, clean(item, drop, name)]];
    }))
    : value;
  try {
    const { properties, required } = (parameters ?? {}) as { properties?: unknown; required?: unknown };
    for (const drop of SCHEMA_DEGRADE_STEPS) {
      const schema = {
        type: 'object' as const,
        properties: properties !== null && typeof properties === 'object' && !Array.isArray(properties) ? clean(properties, drop, 'properties') as Record<string, unknown> : {},
        required: names(required),
      };
      if (JSON.stringify(schema).length <= MAX_SKILL_SCHEMA_CHARS) return schema;
    }
    return empty;
  } catch { return empty; }
}

// ── Skill Discovery ──────────────────────────────────────────────────

/**
 * Fetch available skills from an agent host's GET /skills endpoint.
 * Returns the parsed skill array, or throws on failure.
 */
export async function fetchHostSkills(host: AgentHost, signal?: AbortSignal): Promise<AgentHostSkill[]> {
  const url = `${host.url.replace(/\/+$/, '')}/skills`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (host.apiKey) headers['Authorization'] = `Bearer ${host.apiKey}`;

  const lifecycle = cancellableRequest(signal);
  const { controller } = lifecycle;
  const timer = setTimeout(() => controller.abort(), SKILLS_TIMEOUT_MS);

  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    assertConfiguredConnection(url);
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) {
      const body = await readBoundedText(resp, 4096).catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${redactAuth(body).slice(0, MAX_ERROR_BODY_CHARS)}`);
    }

    const data = JSON.parse(await readBoundedText(resp, 1_000_000));
    if (!Array.isArray(data)) throw new Error('Expected JSON array of skills');

    // Validate each skill has at minimum name + description
    const SAFE_SKILL_NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;
    return data.filter(
      (s: unknown): s is AgentHostSkill =>
        typeof s === 'object' && s !== null &&
        typeof (s as AgentHostSkill).name === 'string' &&
        SAFE_SKILL_NAME_RE.test((s as AgentHostSkill).name) &&
        typeof (s as AgentHostSkill).description === 'string'
    ).map(s => ({
      name: s.name,
      description: sanitizeSkillDescription(s.description),
      parameters: sanitizeSkillParameters(s.parameters),
      actionClass: normalizeHostActionClass(s.actionClass),
    }));
  } finally {
    clearTimeout(timer);
    lifecycle.dispose();
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
        description: `[Local Agent] ${sanitizeSkillDescription(skill.description)}`,
        input_schema: sanitizeSkillParameters(skill.parameters),
      });
    }
  }

  // Additional agent hosts
  const hosts = (settings.agentHosts || []).filter(h => h.enabled && h.skills.length > 0);
  for (const host of hosts) {
    for (const skill of host.skills) {
      tools.push({
        name: `host:${host.name}:${skill.name}`,
        description: `[${host.displayName}] ${sanitizeSkillDescription(skill.description)}`,
        input_schema: sanitizeSkillParameters(skill.parameters),
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
  signal?: AbortSignal,
): Promise<string> {
  const s: Settings = settings || JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}');

  // local:<skill> — route to the local LLM endpoint
  if (toolName.startsWith('local:')) {
    const skillName = toolName.slice(6);
    if (!s.llmLocalEndpoint) return JSON.stringify({ error: 'No local LLM endpoint configured. Set it in Settings > AI.' });

    const baseUrl = s.llmLocalEndpoint.replace(/\/+$/, '').replace(/\/v1\/?$/, '');
    return await callHostExecute(baseUrl, s.llmLocalApiKey, skillName, input, 'Local Agent', signal);
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

  if (!host) return JSON.stringify({ error: `Agent host not found: ${hostName}. Named agent hosts can no longer be configured; remove it in Settings → AI.` });
  if (!host.enabled) return JSON.stringify({ error: `Agent host "${host.displayName}" is disabled.` });
  if (!isHttpsOrLoopback(host.url)) return JSON.stringify({ error: `Agent host "${host.displayName}" must use https (plain http only on localhost).` });

  return await callHostExecute(host.url, host.apiKey, skillName, input, host.displayName, signal);
}

/** Named hosts receive investigation data: https, or plain http only to this machine. */
function isHttpsOrLoopback(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

/** Shared POST /execute call for both local and named hosts. */
async function callHostExecute(
  baseUrl: string,
  apiKey: string | undefined,
  skillName: string,
  input: Record<string, unknown>,
  displayName: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'local') headers['Authorization'] = `Bearer ${apiKey}`;

  const lifecycle = cancellableRequest(signal);
  const { controller } = lifecycle;
  const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    assertConfiguredConnection(url);
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ skill: skillName, parameters: input }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      return JSON.stringify({ error: `${displayName} returned HTTP ${resp.status}` });
    }

    return await readBoundedText(resp);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return JSON.stringify({ error: `${displayName} request was cancelled or timed out. Remote completion is unknown; do not automatically retry.` });
    }
    return JSON.stringify({ error: `${displayName} execution failed: ${(err as Error).message}` });
  } finally {
    clearTimeout(timer);
    lifecycle.dispose();
  }
}

// ── Action Class Resolution ──────────────────────────────────────────

/**
 * Look up the action class for a host/local skill tool from cached settings.
 * Returns the validated action class, or 'modify' when metadata is unavailable.
 */
export function getHostSkillActionClass(toolName: string): string {
  return getDynamicToolActionClass(toolName);
}
