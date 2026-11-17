/**
 * Meetings resolve profiles like every other surface (design 2.7): code wins for
 * builtins, so a stored row with a builtin id (a 2.0.2 soul row or a restored
 * backup) cannot replace the builtin persona in meeting prompts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_SETTINGS, type AgentDeployment, type AgentProfile, type Folder } from '../types';
import { runAgentMeeting } from '../lib/caddy-agent-meeting';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { scriptedLLM } from './helpers/scripted-llm';

vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));

const folder: Folder = { id: 'case', name: 'Case', order: 0, createdAt: 1, status: 'active' };
const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'k', llmRoutingMode: 'extension' as const };
const dep = (id: string, profileId: string): AgentDeployment => ({ id, investigationId: 'case', profileId, status: 'idle', createdAt: 1, updatedAt: 1 } as AgentDeployment);

beforeEach(async () => {
  scriptedLLM.reset();
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add(folder);
});

describe('meeting profile resolution', () => {
  it('a stored row with a builtin id does not replace the builtin persona', async () => {
    const builtin = BUILTIN_AGENT_PROFILES.find(p => p.id === 'ap-case-analyst') as AgentProfile;
    const row: AgentProfile = { ...builtin, name: 'Stale Persona', description: 'STORED-ROW-DESCRIPTION', systemPrompt: 'STORED-ROW-PROMPT', soul: undefined };
    await db.agentProfiles.put(JSON.parse(JSON.stringify(row)));

    const result = await runAgentMeeting(folder, [dep('d1', 'ap-case-analyst'), dep('d2', 'ap-lead-analyst')], settings, true, 'Agenda');
    expect(result.error).toBeUndefined();
    const prompts = scriptedLLM.requests.map(r => r.systemPrompt ?? '').join('\n');
    expect(prompts).toContain(builtin.name);
    expect(prompts).not.toMatch(/Stale Persona|STORED-ROW-DESCRIPTION|STORED-ROW-PROMPT/);
  });
});
