/**
 * R6U-3: builtin profile names come from the 'agent' namespace, which the hosted
 * build loads on demand, while the agent loop starts about 3 s after load. The
 * namespace loads before an agent cycle or a chat tool resolves profiles by name,
 * and a stored audit thread title is never rewritten from an unresolved key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_SETTINGS, type Folder, type Settings, type ToolUseBlock } from '../types';
import i18n from '../i18n';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { runAgentCycle } from '../lib/caddy-agent';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { createChatToolExecutor } from '../lib/chat-tool-executor';
import { mintHumanApproval } from '../lib/human-approval';
import { TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { scriptedLLM } from './helpers/scripted-llm';
import { seedAIWorkspace } from './helpers/ai-workspace';

vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));

const settings: Settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'test-key', llmRoutingMode: 'extension' };
const TITLE = 'Lead Analyst — Audit Log';
const lead = BUILTIN_AGENT_PROFILES.find(profile => profile.id === 'ap-lead-analyst')!;

let load: ReturnType<typeof vi.spyOn>;
let restore = () => {};
/** As in the hosted build: the namespace arrives only when something loads it. */
function unloadAgentNamespace() {
  const bundle = i18n.getResourceBundle('en', 'agent') as Record<string, unknown>;
  i18n.removeResourceBundle('en', 'agent');
  load = vi.spyOn(i18n, 'loadNamespaces').mockImplementation(async namespaces => {
    if ([namespaces].flat().includes('agent') && !i18n.hasResourceBundle('en', 'agent')) i18n.addResourceBundle('en', 'agent', bundle);
  });
  restore = () => { load.mockRestore(); i18n.addResourceBundle('en', 'agent', bundle, true, true); };
}

beforeEach(async () => {
  await seedAIWorkspace();
  localStorage.clear();
  scriptedLLM.reset();
  await db.chatThreads.add({ id: 'lead-thread', title: TITLE, messages: [], model: 'claude-sonnet-4-6', provider: 'anthropic', folderId: 'S',
    tags: [], source: 'agent', trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
  await db.agentDeployments.add({ id: 'dep-lead', investigationId: 'S', profileId: 'ap-lead-analyst', threadId: 'lead-thread', status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
});
afterEach(() => { restore(); restore = () => {}; vi.restoreAllMocks(); });

describe('an agent cycle soon after load', () => {
  it('loads the namespace first: the prompt names the agent and its audit thread keeps its title', async () => {
    unloadAgentNamespace();
    const name = vi.spyOn(lead, 'name', 'get');
    scriptedLLM.script({ text: 'Nothing new.' });
    const result = await runMultiAgentCycle(await db.folders.get('S') as Folder, settings, true);
    expect(result.errors).toEqual([]);
    expect(load).toHaveBeenCalledWith('agent');
    expect(name).toHaveBeenCalled();
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(name.mock.invocationCallOrder[0]);
    expect(scriptedLLM.requests).toHaveLength(1);
    expect(String(scriptedLLM.requests[0].systemPrompt)).toContain('## Lead Analyst (lead)');
    expect(String(scriptedLLM.requests[0].systemPrompt)).not.toContain('builtinProfile.');
    expect((await db.chatThreads.get('lead-thread'))?.title).toBe(TITLE);
  });

  it('never renames a stored audit thread from an unresolved name', async () => {
    unloadAgentNamespace();
    load.mockImplementation(async () => {});
    scriptedLLM.script({ text: 'Nothing new.' });
    const deployment = await db.agentDeployments.get('dep-lead');
    await runAgentCycle(await db.folders.get('S') as Folder, settings, true, undefined, lead, deployment);
    expect(lead.name).toBe('builtinProfile.leadAnalyst.name');
    expect((await db.chatThreads.get('lead-thread'))?.title).toBe(TITLE);
  });

  it('still renames a stale title once the name is known', async () => {
    await db.chatThreads.update('lead-thread', { title: 'Agent: Shared case' });
    scriptedLLM.script({ text: 'Nothing new.' });
    await runAgentCycle(await db.folders.get('S') as Folder, settings, true, undefined, lead, await db.agentDeployments.get('dep-lead'));
    expect((await db.chatThreads.get('lead-thread'))?.title).toBe(`${lead.icon} Lead Analyst`);
  });
});

describe('chat\'s deploy_agent soon after load', () => {
  it('finds "Lead Analyst" by name', async () => {
    await db.agentDeployments.clear();
    unloadAgentNamespace();
    const name = vi.spyOn(lead, 'name', 'get');
    const toolUse: ToolUseBlock = { type: 'tool_use', id: 'call-deploy', name: 'deploy_agent', input: { profileName: 'Lead Analyst' } };
    const execute = createChatToolExecutor({
      homeFolderId: 'S', mode: 'act', isYolo: () => false, settings,
      allowedTools: new Set(TOOL_DEFINITIONS.map(tool => tool.name)),
      requestApproval: async item => mintHumanApproval(item.toolUse, item.reach.homeFolderId, 'chat-card'),
      runCheckpointed: run => run(),
    });
    const result = await execute(toolUse, new AbortController().signal);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(name.mock.invocationCallOrder[0]);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.result)).toMatchObject({ success: true });
    expect(await db.agentDeployments.where('investigationId').equals('S').toArray()).toEqual([expect.objectContaining({ profileId: 'ap-lead-analyst' })]);
  });
});
