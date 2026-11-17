/**
 * A-APPR: approving a queued agent action re-derives what that agent may do
 * today instead of trusting the stored row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type AgentAction } from '../types';
import { executeApprovedAction } from '../lib/agent-action-approval';
import { queueAgentAction } from '../lib/agent-action-queue';
import { executeTool } from '../lib/llm-tools';
import { SUPERVISOR_ACTION_PROFILE, SUPERVISOR_TOOLS, validateSupervisorDispatch } from '../lib/supervisor-tool-policy';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';

const queue = (proposal: Partial<AgentAction> & Pick<AgentAction, 'toolName' | 'toolInput'>) =>
  queueAgentAction({ investigationId: 'S', threadId: 'thread', rationale: 'Proposed by an agent', ...proposal }).then(({ action }) => action);

let egress: EgressSpy;
beforeEach(async () => { await seedAIWorkspace(); egress = installEgressSpy(); });
afterEach(() => egress.restore());

describe('A-APPR re-derivation on approval', () => {
  it('A-APPR-1 refuses a server-ingested row without dispatching it', async () => {
    const action: AgentAction = { id: 'srv:remote-1', investigationId: 'S', threadId: 'thread', toolName: 'fetch_url', toolInput: { url: 'https://collector.example/' }, rationale: 'server', status: 'pending', createdAt: 1 };
    await db.agentActions.add(action);
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect(await db.agentActions.get(action.id)).toMatchObject({ status: 'failed' });
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('A-APPR-2 refuses a legacy spawn_agent row, which no legacy toolset offers', async () => {
    const action = await queue({ toolName: 'spawn_agent', toolInput: { profileName: 'Threat Hunter', reason: 'More hands' } });
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect(await db.agentDeployments.count()).toBe(0);
    expect(await db.agentActions.get(action.id)).toMatchObject({ status: 'failed' });
  });

  it('A-APPR-3 refuses a Threat Hunter create_in_investigation row', async () => {
    const action = await queue({ agentConfigId: 'ap-threat-hunter', toolName: 'create_in_investigation', toolInput: { investigationId: 'P', entityType: 'note', data: { title: 'x' } } });
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect(await db.notes.where('folderId').equals('P').count()).toBe(1);
  });

  it('A-APPR-4 executes a row once when approved twice at the same time', async () => {
    const action = await queue({ toolName: 'create_note', toolInput: { title: 'Approved summary' } });
    const before = await db.notes.count();
    await Promise.all([executeApprovedAction(action), executeApprovedAction(action)]);
    expect(await db.notes.count()).toBe(before + 1);
  });

  it('runs an approved Threat Hunter fetch once', async () => {
    await db.agentDeployments.add({ id: 'dep-hunter', investigationId: 'S', profileId: 'ap-threat-hunter', status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
    const action = await queue({ agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url', toolInput: { url: 'https://collector.example/c' } });
    expect((await executeApprovedAction(action)).isError).toBe(false);
    expect(egress.fetchUrlPosts()).toEqual(['https://collector.example/c']);
  });

  it('applies the analyst edit that was approved', async () => {
    const action = await queue({ toolName: 'create_note', toolInput: { title: 'Draft' } });
    await executeApprovedAction({ ...action, toolInput: { title: 'Edited by analyst' } });
    expect(await db.notes.where('title').equals('Edited by analyst').count()).toBe(1);
    expect(await db.notes.where('title').equals('Draft').count()).toBe(0);
  });

  it('refuses rows for a missing or archived investigation and a deleted profile', async () => {
    const gone = await queue({ investigationId: 'gone', toolName: 'create_note', toolInput: { title: 'x' } });
    expect((await executeApprovedAction(gone)).isError).toBe(true);
    await db.folders.update('P', { status: 'archived' });
    const archived = await queue({ investigationId: 'P', toolName: 'create_note', toolInput: { title: 'x' } });
    expect((await executeApprovedAction(archived)).isError).toBe(true);
    const orphan = await queue({ agentConfigId: 'deleted-profile', toolName: 'create_note', toolInput: { title: 'x' } });
    expect((await executeApprovedAction(orphan)).isError).toBe(true);
    expect(await db.notes.where('title').equals('x').count()).toBe(0);
  });

  it('approving an agent question acknowledges it without asking again', async () => {
    // The row executeAskHuman queues: no agentConfigId, nothing to run.
    const question: AgentAction = { id: 'question-1', investigationId: 'S', threadId: '', toolName: 'ask_human', toolInput: { question: 'Isolate the host?', context: '', options: '' },
      rationale: 'Agent needs human input: Isolate the host?', status: 'pending', severity: 'warning', createdAt: 1 };
    await db.agentActions.add(question);
    const notes = await db.notes.count();
    expect((await executeApprovedAction(question)).isError).toBe(false);
    expect(await db.agentActions.get(question.id)).toMatchObject({ status: 'executed' });
    expect(await db.agentActions.filter(action => action.toolName === 'ask_human').count()).toBe(1);
    expect(await db.notes.count()).toBe(notes);
  });

  it('a supervisor update in another investigation runs only through approval', async () => {
    await db.folders.add({ id: 'SUP', name: 'CaddyAgent Supervisor', order: 9, createdAt: 1 });
    await db.folders.update('P', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveModify: true } });
    const update = { type: 'tool_use' as const, id: 'sup-1', name: 'update_ioc', input: { id: ids('P').ioc, confidence: 'high' } };
    const direct = await executeTool(update, 'SUP', undefined, { surface: 'supervisor', allowedTools: SUPERVISOR_TOOLS, validateScope: call => validateSupervisorDispatch(call, 'SUP') });
    expect(direct.isError).toBe(true);
    expect((await db.standaloneIOCs.get(ids('P').ioc))?.confidence).toBe('medium');
    const action = await queue({ investigationId: 'P', agentConfigId: SUPERVISOR_ACTION_PROFILE, toolName: 'update_ioc', toolInput: update.input });
    expect((await executeApprovedAction(action)).isError).toBe(false);
    expect((await db.standaloneIOCs.get(ids('P').ioc))?.confidence).toBe('high');
  });
});
