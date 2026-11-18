/**
 * A-APPR: approving a queued agent action re-derives what that agent may do
 * today instead of trusting the stored row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentAction } from '../types';
import { executeApprovedAction } from '../lib/agent-action-approval';
import { queueAgentAction } from '../lib/agent-action-queue';
import { executeTool } from '../lib/llm-tools';
import { SUPERVISOR_ACTION_PROFILE, SUPERVISOR_TOOLS, validateSupervisorDispatch } from '../lib/supervisor-tool-policy';
import { getToolBinding } from '../lib/tool-binding';
import { workspaceStorageKey } from '../lib/workspace-profiles';
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

  it('says in the analyst’s language why the dispatcher refused an approved proposal', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    const tool = 'host:reports:summary';
    const host = { id: 'reports-id', name: 'reports', displayName: 'Reports', url: 'https://reports.example', enabled: true,
      skills: [{ name: 'summary', description: 'Read a prepared report', parameters: { type: 'object', properties: { document: { type: 'string' } } }, actionClass: 'read' as const }] };
    const saveSettings = (url: string) => localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ ...DEFAULT_SETTINGS, agentHosts: [{ ...host, url }] }));
    try {
      // The decision table: an Enricher update of an IOC filed in P, and legacy reads of a note in P and in the local-only L.
      await deploy('ap-ioc-enricher');
      const crossWrite = await queue({ agentConfigId: 'ap-ioc-enricher', toolName: 'update_ioc', toolInput: { id: ids('P').ioc, confidence: 'high' } });
      expect(errorOf(await executeApprovedAction(crossWrite))).toBe(deAgent['refusal.otherInvestigationChange']);
      const crossRead = await queue({ toolName: 'read_note', toolInput: { id: ids('P').note } });
      expect(errorOf(await executeApprovedAction(crossRead))).toBe(deAgent['refusal.otherInvestigationRead']);
      const hidden = await queue({ toolName: 'read_note', toolInput: { id: ids('L').note } });
      expect(errorOf(await executeApprovedAction(hidden))).toBe(deAgent['refusal.notInInvestigation']);

      // The dispatcher: a host skill whose endpoint changed, a profile made read-only for tasks and a task escalated after the proposal.
      saveSettings('https://reports.example');
      const input = { document: 'fixture' };
      const changed = await queue({ toolName: tool, toolInput: input, toolBinding: await getToolBinding({ type: 'tool_use', id: 'c', name: tool, input }, 'S') });
      saveSettings('https://moved-reports.example');
      expect(errorOf(await executeApprovedAction(changed))).toBe(deAgent['refusal.toolChanged'].replace('{{tool}}', tool));
      await db.agentProfiles.add({ id: 'up-scribe', name: 'Scribe', role: 'specialist', systemPrompt: 'Takes notes.', allowedTools: ['create_task'],
        readOnlyEntityTypes: ['task'], policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 });
      await deploy('up-scribe');
      const readOnly = await queue({ agentConfigId: 'up-scribe', toolName: 'create_task', toolInput: { title: 'From a read-only agent' } });
      expect(errorOf(await executeApprovedAction(readOnly))).toBe(deAgent['refusal.readOnlyEntity']);
      await db.tasks.update(ids('S').task, { escalated: true, rejectionCount: 3 });
      const escalated = await queue({ toolName: 'update_task', toolInput: { id: ids('S').task, status: 'done' } });
      expect(errorOf(await executeApprovedAction(escalated))).toBe(deAgent['refusal.taskEscalated']);

      for (const row of [crossWrite, crossRead, hidden, changed, readOnly, escalated]) expect(await db.agentActions.get(row.id)).toMatchObject({ status: 'failed' });
      expect((await db.standaloneIOCs.get(ids('P').ioc))?.confidence).toBe('medium');
      expect((await db.tasks.get(ids('S').task))?.status).toBe('todo');
      expect(await db.tasks.where('title').equals('From a read-only agent').count()).toBe(0);
      expect(egress.fetches).toEqual([]);
    } finally {
      localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
      await i18n.changeLanguage('en');
    }
  });

  it('says in German that a read-only agent may not run a host skill or a call it cannot bound', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    const tool = 'host:reports:summary';
    const host = { id: 'reports-id', name: 'reports', displayName: 'Reports', url: 'https://reports.example', enabled: true,
      skills: [{ name: 'summary', description: 'Read a prepared report', parameters: { type: 'object', properties: { document: { type: 'string' } } }, actionClass: 'read' as const }] };
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ ...DEFAULT_SETTINGS, agentHosts: [host] }));
    try {
      await db.agentProfiles.add({ id: 'up-reader', name: 'Reader', role: 'specialist', systemPrompt: 'Reads reports.', allowedTools: [tool, 'link_entities'],
        readOnlyEntityTypes: ['task'], policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 });
      await deploy('up-reader');
      const input = { document: 'fixture' };
      const remote = await queue({ agentConfigId: 'up-reader', toolName: tool, toolInput: input, toolBinding: await getToolBinding({ type: 'tool_use', id: 'c', name: tool, input }, 'S') });
      // Links given as anything but a list could touch any entity type.
      const unbounded = await queue({ agentConfigId: 'up-reader', toolName: 'link_entities', toolInput: { links: 'every note' } });
      for (const row of [remote, unbounded]) expect(errorOf(await executeApprovedAction(row))).toBe(deAgent['refusal.readOnlyEntity']);
      expect(egress.fetches).toEqual([]);
    } finally {
      localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
      await i18n.changeLanguage('en');
    }
  });

  it('stores what a host or a SIEM answered as it came, even an answer that reads like a refusal', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    const tool = 'host:reports:summary';
    const host = { id: 'reports-id', name: 'reports', displayName: 'Reports', url: 'https://reports.example', enabled: true,
      skills: [{ name: 'summary', description: 'Read a prepared report', parameters: { type: 'object', properties: { document: { type: 'string' } } }, actionClass: 'read' as const }] };
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ ...DEFAULT_SETTINGS, agentHosts: [host], siemEndpoint: 'https://siem.example/search' }));
    try {
      await db.agentProfiles.add({ id: 'up-siem', name: 'SIEM reader', role: 'specialist', systemPrompt: 'Queries the SIEM.', allowedTools: ['query_siem'],
        policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 });
      await deploy('up-siem');
      const input = { document: 'fixture' };
      const toolBinding = await getToolBinding({ type: 'tool_use', id: 'c', name: tool, input }, 'S');
      // The request left this device, so the inbox must not say in ThreatCaddy's voice that nothing ran.
      const bodies = [{ error: 'remote said no', escalated: true }, { error: 'Not found in this investigation.' }, { error: 'Agents cannot change another investigation.' }]
        .map(body => JSON.stringify(body));
      for (const body of bodies) {
        vi.mocked(fetch).mockImplementation(async url => { egress.fetches.push(String(url)); return new Response(body, { status: 200 }); });
        const remote = await queue({ toolName: tool, toolInput: input, toolBinding });
        const siem = await queue({ agentConfigId: 'up-siem', toolName: 'query_siem', toolInput: { query: 'dns canary' } });
        for (const row of [remote, siem]) {
          expect((await executeApprovedAction(row)).result).toBe(body);
          expect(await db.agentActions.get(row.id)).toMatchObject({ status: 'failed', resultSummary: body });
        }
      }
      expect(egress.fetches).toEqual(bodies.flatMap(() => ['https://reports.example/execute', 'https://siem.example/search']));
    } finally {
      localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
      await i18n.changeLanguage('en');
    }
  });

  it('keeps a refusal it cannot name, and an executor’s own error, as the dispatcher wrote them', async () => {
    const untranslated = await queue({ toolName: 'read_note', toolInput: [] as unknown as Record<string, unknown> });
    expect(errorOf(await executeApprovedAction(untranslated))).toBe('Tool input must be an object.');
    const missing = await queue({ toolName: 'update_note', toolInput: { id: 'no-such-note', title: 'x' } });
    expect((await executeApprovedAction(missing)).isError).toBe(true);
    expect((await db.agentActions.get(missing.id))?.resultSummary).not.toMatch(/nothing ran/);
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
