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
import i18n from '../i18n';
import deAgent from '../../public/locales/de/agent.json';

const queue = (proposal: Partial<AgentAction> & Pick<AgentAction, 'toolName' | 'toolInput'>) =>
  queueAgentAction({ investigationId: 'S', threadId: 'thread', rationale: 'Proposed by an agent', ...proposal }).then(({ action }) => action);
const errorOf = (result: { result: string }) => String(JSON.parse(result.result).error ?? '');
/** The proposer stays deployed, so approval reaches the profile and toolset checks. */
const deploy = (profileId: string) =>
  db.agentDeployments.add({ id: `dep-${profileId}`, investigationId: 'S', profileId, status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });

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
    await deploy('ap-threat-hunter');
    const action = await queue({ agentConfigId: 'ap-threat-hunter', toolName: 'create_in_investigation', toolInput: { investigationId: 'P', entityType: 'note', data: { title: 'x' } } });
    const result = await executeApprovedAction(action);
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toBe('This agent can no longer use create_in_investigation, so nothing ran.');
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
    // A deployment of a deleted profile can arrive by restore or sync.
    await deploy('deleted-profile');
    const orphan = await queue({ agentConfigId: 'deleted-profile', toolName: 'create_note', toolInput: { title: 'x' } });
    const refused = await executeApprovedAction(orphan);
    expect(refused.isError).toBe(true);
    expect(errorOf(refused)).toBe('The agent that proposed this no longer exists, so nothing ran.');
    expect(await db.notes.where('title').equals('x').count()).toBe(0);
  });

  it('says in the analyst’s language why a refused proposal did not run', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    try {
      const server: AgentAction = { id: 'srv:remote-2', investigationId: 'S', threadId: 'thread', toolName: 'create_note', toolInput: { title: 'x' }, rationale: 'server', status: 'pending', createdAt: 1 };
      await db.agentActions.add(server);
      expect(errorOf(await executeApprovedAction(server))).toBe(deAgent['refusal.serverProposal']);
      const gone = await queue({ investigationId: 'gone', toolName: 'create_note', toolInput: { title: 'x' } });
      expect(errorOf(await executeApprovedAction(gone))).toBe(deAgent['refusal.investigationUnavailable']);
      await db.folders.update('P', { status: 'archived' });
      const archived = await queue({ investigationId: 'P', toolName: 'create_note', toolInput: { title: 'x' } });
      expect(errorOf(await executeApprovedAction(archived))).toBe(deAgent['refusal.investigationUnavailable']);
      await deploy('deleted-profile');
      const orphan = await queue({ agentConfigId: 'deleted-profile', toolName: 'create_note', toolInput: { title: 'x' } });
      expect(errorOf(await executeApprovedAction(orphan))).toBe(deAgent['refusal.profileGone']);
      await deploy('ap-threat-hunter');
      const crossWrite = await queue({ agentConfigId: 'ap-threat-hunter', toolName: 'create_in_investigation', toolInput: { investigationId: 'L', entityType: 'note', data: { title: 'x' } } });
      expect(errorOf(await executeApprovedAction(crossWrite))).toBe(deAgent['refusal.toolNotAllowed'].replace('{{tool}}', 'create_in_investigation'));
      // A supervisor update filed under L whose IOC lives in S.
      const moved = await queue({ investigationId: 'L', agentConfigId: SUPERVISOR_ACTION_PROFILE, toolName: 'update_ioc', toolInput: { id: ids('S').ioc, confidence: 'high' } });
      expect(errorOf(await executeApprovedAction(moved))).toBe(deAgent['refusal.targetMoved']);
      expect(await db.notes.where('title').equals('x').count()).toBe(0);
      expect((await db.standaloneIOCs.get(ids('S').ioc))?.confidence).toBe('medium');

      const question = await queue({ toolName: 'ask_human', toolInput: { question: 'Isolate the host?' } });
      await executeApprovedAction(question);
      expect(await db.agentActions.get(question.id)).toMatchObject({ status: 'executed', resultSummary: deAgent['action.questionAcknowledged'] });
    } finally { await i18n.changeLanguage('en'); }
  });

  it('says in the analyst’s language that a dismissed agent’s proposal cannot run', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    try {
      // Threat Hunter has no deployment in S: it was dismissed after proposing.
      const action = await queue({ agentConfigId: 'ap-threat-hunter', toolName: 'create_note', toolInput: { title: 'From a dismissed agent' } });
      const refused = await executeApprovedAction(action);
      expect(refused.isError).toBe(true);
      expect(errorOf(refused)).toBe(deAgent['refusal.proposerRemoved']);
      expect(await db.agentActions.get(action.id)).toMatchObject({ status: 'failed' });
      expect(await db.notes.where('title').equals('From a dismissed agent').count()).toBe(0);
    } finally { await i18n.changeLanguage('en'); }
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
