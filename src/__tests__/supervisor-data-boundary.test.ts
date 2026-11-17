/**
 * S4-1: the supervisor reads every investigation, local-only ones included. A
 * proposal it files in another investigation carries none of its reasoning, agents
 * there never list supervisor or server rows, and an investigation export drops the
 * reasoning that older supervisor rows still hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentAction, type Folder, type Settings } from '../types';
import { findSupervisorFolder, runSupervisorCycle } from '../lib/caddy-agent-supervisor';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { rejectAction } from '../lib/agent-action-approval';
import { exportInvestigationJSON } from '../lib/export';
import i18n from '../i18n';
import enAgent from '../../public/locales/en/agent.json';
import deAgent from '../../public/locales/de/agent.json';
import { scriptedLLM } from './helpers/scripted-llm';
import { canary, ids, seedAIWorkspace, syncQueueContains } from './helpers/ai-workspace';
import { execTool } from './helpers/tool-exec';

vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));

const settings: Settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'test-key', llmRoutingMode: 'extension' };
const LOCAL = canary('L');
const PRIVATE = canary('P');
const FIXED = enAgent['supervisor.proposalRationale'];

/** Every tool result the model received in the latest request. */
function toolResultsSeen(): string {
  const messages = (scriptedLLM.requests.at(-1)?.messages ?? []) as Array<{ content: unknown }>;
  return messages.flatMap(message => Array.isArray(message.content) ? message.content as Array<{ type: string; content?: unknown }> : [])
    .filter(block => block.type === 'tool_result').map(block => String(block.content)).join('\n');
}

/** The supervisor searches every case, then proposes an S IOC update whose reply quotes what it read. */
async function supervisorProposesInS() {
  scriptedLLM.script(
    { toolCalls: [{ name: 'search_across_investigations', input: { query: 'Evidence' } }] },
    {
      get text() { return `Overlap: ${(toolResultsSeen().match(/Evidence CANARY-[A-Z0-9]+/g) ?? []).join('; ')} also in Shared case.`; },
      toolCalls: [{ name: 'update_ioc', input: { id: ids('S').ioc, confidence: 'high' } }],
    },
  );
  expect((await runSupervisorCycle(settings, true)).error).toBeUndefined();
  return await db.agentActions.where('investigationId').equals('S').toArray();
}

const supervisorRow = (id: string, investigationId: string, extra: Partial<AgentAction> = {}): AgentAction => ({
  id, investigationId, threadId: 'sup-thread', agentConfigId: 'caddy-supervisor', toolName: 'update_ioc', toolInput: { id: ids('S').ioc, confidence: 'high' },
  rationale: `Cross-case: Evidence ${LOCAL} and Evidence ${PRIVATE} match.`, status: 'rejected', createdAt: 1, ...extra,
});

beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); scriptedLLM.reset(); });
afterEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage('en'); });

describe('a supervisor proposal in another investigation', () => {
  it('stores a fixed sentence, and the supervisor investigation keeps the reasoning', async () => {
    const [row] = await supervisorProposesInS();
    expect(row).toMatchObject({ agentConfigId: 'caddy-supervisor', toolName: 'update_ioc', status: 'pending', rationale: FIXED });
    expect(JSON.stringify(row)).not.toContain(LOCAL);

    const own = await findSupervisorFolder();
    const audit = await db.chatThreads.where('folderId').equals(own!.id).toArray();
    expect(JSON.stringify(audit)).toContain(LOCAL);
  });

  it('a proposal in the supervisor investigation itself keeps the reply as its reason', async () => {
    scriptedLLM.script(
      { toolCalls: [{ name: 'search_across_investigations', input: { query: 'Evidence' } }] },
      { get text() { return `Summary of ${(toolResultsSeen().match(/CANARY-L/g) ?? []).join(' ')}`; }, toolCalls: [{ name: 'create_note', input: { title: 'Findings' } }] },
    );
    await runSupervisorCycle(settings, true);
    const own = await findSupervisorFolder();
    const [row] = await db.agentActions.where('investigationId').equals(own!.id).toArray();
    expect(row).toMatchObject({ toolName: 'create_note', status: 'pending' });
    expect(row.rationale).toContain(LOCAL);
  });

  it('is written in the analyst\'s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    const [row] = await supervisorProposesInS();
    expect(row.rationale).toBe(deAgent['supervisor.proposalRationale']);
  });

  it('reaches no lead in that investigation, even after a rejection, so nothing local syncs', async () => {
    const [row] = await supervisorProposesInS();
    await rejectAction(row.id);
    // An older row that still holds the reasoning is not listed either.
    await db.agentActions.add(supervisorRow('old-sup', 'S'));
    await db.table('_syncQueue').clear();

    await db.agentDeployments.put({ id: 'd-lead', investigationId: 'S', profileId: 'ap-lead-analyst', status: 'idle', shift: 'active', order: 0, createdAt: 1, updatedAt: 1 });
    scriptedLLM.reset();
    let listed = '';
    scriptedLLM.script(
      { toolCalls: [{ name: 'list_agent_activity', input: {} }] },
      { get text() { listed = toolResultsSeen(); return `Team activity: ${listed}`; } },
    );
    await runMultiAgentCycle(await db.folders.get('S') as Folder, settings, true);

    expect(JSON.parse(listed)).toEqual({ count: 0, actions: [] });
    const sThreads = await db.chatThreads.where('folderId').equals('S').toArray();
    for (const needle of [LOCAL, PRIVATE, FIXED]) expect(JSON.stringify(sThreads)).not.toContain(needle);
    expect(await syncQueueContains(LOCAL)).toBe(false);
  });
});

describe('list_agent_activity', () => {
  it('leaves out supervisor and server rows and keeps this investigation\'s agents', async () => {
    await db.agentActions.bulkAdd([
      supervisorRow('sup', 'S', { createdAt: 3 }),
      { id: 'srv:remote-1', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'create_note', toolInput: {}, rationale: 'Server history', status: 'executed', createdAt: 2 },
      { id: 'mine', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'create_note', toolInput: {}, rationale: 'Wrote the summary', status: 'executed', createdAt: 1 },
    ]);
    const result = await execTool({ type: 'tool_use', id: 'c1', name: 'list_agent_activity', input: { limit: 1 } }, 'S', { surface: 'agent', agentContext: { profileId: 'ap-lead-analyst' } });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.result).actions).toEqual([expect.objectContaining({ agentName: 'Threat Hunter', tool: 'create_note', rationale: 'Wrote the summary' })]);
  });
});

describe('the investigation export', () => {
  beforeEach(async () => {
    await db.folders.add({ id: 'SUP', name: 'CaddyAgent Supervisor', order: 9999, createdAt: 1, status: 'active', localOnly: true, agentPolicy: { ...DEFAULT_AGENT_POLICY } });
    await db.agentActions.bulkAdd([
      supervisorRow('old-in-s', 'S'),
      supervisorRow('old-own', 'SUP', { toolName: 'create_note', toolInput: { title: 'Findings' } }),
      { id: 'agent-row', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'create_note', toolInput: {}, rationale: 'Agent reason stays', status: 'executed', createdAt: 1 },
    ]);
  });

  it('drops older supervisor reasoning from another investigation\'s file', async () => {
    const exported = JSON.parse(await exportInvestigationJSON('S')) as { agentActions: AgentAction[] };
    expect(JSON.stringify(exported)).not.toContain(LOCAL);
    expect(JSON.stringify(exported)).not.toContain(PRIVATE);
    expect(exported.agentActions.find(action => action.id === 'old-in-s')?.rationale).toBe(FIXED);
    expect(exported.agentActions.find(action => action.id === 'agent-row')?.rationale).toBe('Agent reason stays');
    // The stored row is not changed.
    expect((await db.agentActions.get('old-in-s'))?.rationale).toContain(LOCAL);
  });

  it('keeps it in the supervisor investigation\'s own file', async () => {
    const exported = JSON.parse(await exportInvestigationJSON('SUP')) as { agentActions: AgentAction[] };
    expect(exported.agentActions.find(action => action.id === 'old-own')?.rationale).toContain(LOCAL);
  });

  it('drops it from an older synced supervisor investigation, which is an ordinary one now', async () => {
    await db.folders.add({ id: 'OLD', name: 'CaddyAgent Supervisor', order: 9999, createdAt: 1, status: 'active' });
    await db.agentActions.add(supervisorRow('old-synced', 'OLD', { toolName: 'create_note', toolInput: { title: 'Findings' } }));
    expect(await exportInvestigationJSON('OLD')).not.toContain(LOCAL);
  });
});

it('the fixed sentence is translated: German differs from English', () => {
  expect(deAgent['supervisor.proposalRationale']).toBeTruthy();
  expect(deAgent['supervisor.proposalRationale']).not.toBe(FIXED);
});
