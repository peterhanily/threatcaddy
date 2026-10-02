import type { Settings, ToolUseBlock } from '../types';
import { workspaceStorageKey } from './workspace-profiles';

export const isDynamicTool = (name: string) => name.startsWith('host:') || name.startsWith('local:');
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
}

/** Persist only a digest, never host credentials or schema copies. A proposal
 * binds the exact call, investigation, mode and currently configured identity,
 * endpoint, credential and skill metadata. Old unbound proposals fail closed. */
export async function getToolBinding(tool: ToolUseBlock, folderId?: string, mode: 'plan' | 'act' = 'act', settings?: Settings): Promise<string | undefined> {
  if (!isDynamicTool(tool.name)) return undefined;
  const current: Settings = settings ?? JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}');
  let endpoint: string | undefined;
  let credential: string | undefined;
  let hostId: string | undefined;
  let skill: unknown;
  if (tool.name.startsWith('local:')) {
    endpoint = current.llmLocalEndpoint;
    credential = current.llmLocalApiKey;
    hostId = 'local';
    skill = current.llmLocalSkills?.find(item => item.name === tool.name.slice(6));
  } else {
    const [, name, ...parts] = tool.name.split(':');
    const host = current.agentHosts?.find(item => item.name === name && item.enabled);
    endpoint = host?.url;
    credential = host?.apiKey;
    hostId = host?.id;
    skill = host?.skills?.find(item => item.name === parts.join(':'));
  }
  if (!endpoint || !skill) throw new Error('Tool configuration is missing or disabled. Refresh the available tools and request approval again.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({
    version: 1, tool: tool.name, input: tool.input, scope: folderId ?? null, mode, endpoint: new URL(endpoint).href,
    hostId, credential, skill,
  })));
  return `v1:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
