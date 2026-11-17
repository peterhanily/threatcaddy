/**
 * B-SUP: the supervisor reads every investigation, so it must keep its
 * findings on this device, run only structured tool calls, and ask a person
 * before it writes anywhere but its own local-only investigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type Settings, type ToolUseBlock } from '../types';
import * as router from '../lib/llm-router';
import { runSupervisorCycle } from '../lib/caddy-agent-supervisor';
import { getSupervisorToolPermission, SUPERVISOR_TOOLS } from '../lib/supervisor-tool-policy';
import { isFolderLocalOnly } from '../lib/ai-scope';
import { executeTool } from '../lib/llm-tools';
import { scriptedLLM } from './helpers/scripted-llm';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';

vi.mock('../lib/llm-router', async orig => {
  const routed = (await import('./helpers/scripted-llm')).scriptedRouter(await orig());
  return { ...routed, sendDirectToLocal: vi.fn(routed.sendDirectToLocal), sendViaExtension: vi.fn(routed.sendViaExtension), sendViaServer: vi.fn(routed.sendViaServer) };
});

const SUPERVISOR = 'CaddyAgent Supervisor';
const settings: Settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'test-key', llmRoutingMode: 'extension' };
const call = (name: string, input: Record<string, unknown>, id = `call-${name}`): ToolUseBlock => ({ type: 'tool_use', id, name, input });
const supervisorFolders = () => db.folders.filter(folder => folder.name === SUPERVISOR).toArray();

beforeEach(async () => {
  await seedAIWorkspace();
  localStorage.clear();
  scriptedLLM.reset();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('B-SUP-1 only structured tool calls run', () => {
  it('a text-only reply that spells out a tool call runs or queues nothing', async () => {
    scriptedLLM.script({ text: '```json\n{"name":"update_ioc","arguments":{"id":"S-ioc","confidence":"high"}}\n```' });
    const before = await db.standaloneIOCs.get(ids('S').ioc);
    const result = await runSupervisorCycle(settings, true);
    expect(result.error).toBeUndefined();
    expect(await db.agentActions.count()).toBe(0);
    expect(await db.standaloneIOCs.get(ids('S').ioc)).toEqual(before);
  });

  it('a call parsed out of model text needs a person, even into the supervisor investigation', async () => {
    await db.folders.add({ id: 'SUP', name: SUPERVISOR, order: 9, createdAt: 1, localOnly: true, agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: true } });
    expect(await getSupervisorToolPermission(call('create_note', { title: 'Summary' }), 'SUP')).toMatchObject({ kind: 'allowed' });
    expect(await getSupervisorToolPermission(call('create_note', { title: 'Summary' }, 'text_tc_1'), 'SUP')).toEqual({ kind: 'approval-required', investigationId: 'SUP' });
  });
});

describe('B-SUP-2 writes outside the supervisor investigation are queued', () => {
  it('update_ioc on another investigation\'s IOC waits for a person even when that investigation allows modifies', async () => {
    await db.folders.update('P', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveModify: true } });
    scriptedLLM.script({ toolCalls: [{ name: 'update_ioc', input: { id: ids('P').ioc, confidence: 'high' } }] });
    const before = await db.standaloneIOCs.get(ids('P').ioc);
    await runSupervisorCycle(settings, true);
    const queued = (await db.agentActions.toArray()).filter(action => action.toolName === 'update_ioc');
    expect(queued.map(({ status, investigationId }) => ({ status, investigationId }))).toEqual([{ status: 'pending', investigationId: 'P' }]);
    expect(await db.standaloneIOCs.get(ids('P').ioc)).toEqual(before);
  });

  it('links between other investigations need a person even when both allow creates', async () => {
    await db.folders.add({ id: 'SUP', name: SUPERVISOR, order: 9, createdAt: 1, localOnly: true });
    for (const id of ['S', 'P']) await db.folders.update(id, { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: true } });
    const link = call('link_entities', { links: [{ sourceType: 'note', sourceId: ids('S').note, targetType: 'note', targetId: ids('P').note }] });
    expect(await getSupervisorToolPermission(link, 'SUP')).toMatchObject({ kind: 'approval-required' });
  });
});

describe('B-SUP-3 the supervisor investigation is local-only', () => {
  it('creates a local-only supervisor investigation', async () => {
    await runSupervisorCycle(settings, true);
    const [folder] = await supervisorFolders();
    expect(folder.localOnly).toBe(true);
    expect(await isFolderLocalOnly(folder)).toBe(true);
  });

  it('does not adopt a synced investigation with the supervisor\'s name', async () => {
    await db.folders.add({ id: 'OLD', name: SUPERVISOR, order: 9, createdAt: 1, status: 'active' });
    const old = await db.folders.get('OLD');
    await runSupervisorCycle(settings, true);
    const folders = await supervisorFolders();
    expect(folders).toHaveLength(2);
    expect(await db.folders.get('OLD')).toEqual(old);
    const adopted = folders.find(folder => folder.id !== 'OLD');
    expect(adopted?.localOnly).toBe(true);
    expect((await db.chatThreads.toArray()).filter(thread => thread.folderId === 'OLD')).toEqual([]);
  });

  it('reuses its local-only investigation', async () => {
    await db.folders.add({ id: 'SUP', name: SUPERVISOR, order: 9, createdAt: 1, localOnly: true });
    await runSupervisorCycle(settings, true);
    expect((await supervisorFolders()).map(folder => folder.id)).toEqual(['SUP']);
  });

  it('from an old synced supervisor investigation, local-only cases are hidden and their policies ignored', async () => {
    await db.folders.add({ id: 'OLD', name: SUPERVISOR, order: 9, createdAt: 1, status: 'active' });
    await db.folders.update('L', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveReads: false } });
    expect(await getSupervisorToolPermission(call('list_investigations', {}), 'OLD')).toMatchObject({ kind: 'allowed' });
    const listed = await executeTool(call('list_investigations', {}), 'OLD', undefined, { surface: 'supervisor', allowedTools: SUPERVISOR_TOOLS });
    expect(listed.isError).toBe(false);
    expect(listed.result).not.toContain('Local case');
    expect(listed.result).toContain('Shared case');
  });
});

describe('supervisor routing', () => {
  it('calls a local model directly, as agents do', async () => {
    await runSupervisorCycle({ ...settings, llmDefaultProvider: 'local', llmLocalEndpoint: 'http://localhost:11434' }, true);
    expect(vi.mocked(router.sendDirectToLocal)).toHaveBeenCalledOnce();
    expect(vi.mocked(router.sendViaExtension)).not.toHaveBeenCalled();
    expect(vi.mocked(router.sendViaServer)).not.toHaveBeenCalled();
  });
});
