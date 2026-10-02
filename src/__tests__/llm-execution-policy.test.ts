import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type Folder, type ToolUseBlock } from '../types';
import { getToolActionClass, shouldAutoApprove } from '../lib/caddy-agent-policy';
import { getHostSkillActionClass } from '../lib/agent-hosts';
import { isWriteTool } from '../lib/llm-tool-defs';
import { executeTool } from '../lib/llm-tools';
import { normalizeToolResult } from '../lib/llm-tool-execution';
import { getReadOnlyEntityError } from '../lib/tool-entity-policy';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { executeApprovedAction } from '../lib/caddy-agent';
import { queueAgentAction } from '../lib/agent-action-approval';
import { getSupervisorToolPermission, SUPERVISOR_ACTION_PROFILE, SUPERVISOR_TOOLS, validateSupervisorDispatch } from '../lib/supervisor-tool-policy';

const call = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({ type: 'tool_use', id: 'test-call', name, input });
const folder = (id: string, policy?: Folder['agentPolicy']): Folder => ({ id, name: id, order: 0, createdAt: 1, status: 'active', agentPolicy: policy });

beforeEach(async () => {
  localStorage.removeItem('threatcaddy-settings');
  await Promise.all([db.notes.clear(), db.tasks.clear(), db.standaloneIOCs.clear(), db.folders.clear(), db.agentActions.clear()]);
});

describe('dynamic tool effect classification', () => {
  it.each([undefined, 'unexpected', 'delegate'])('requires write approval for untrusted metadata %s', actionClass => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({
      llmLocalSkills: [{ name: 'summarize', actionClass }],
      agentHosts: [{ name: 'reports', skills: [{ name: 'summarize', actionClass }] }],
    }));
    for (const name of ['local:summarize', 'host:reports:summarize']) {
      expect(getToolActionClass(name)).toBe('modify');
      expect(getHostSkillActionClass(name)).toBe('modify');
      expect(isWriteTool(name)).toBe(true);
      expect(shouldAutoApprove(name, DEFAULT_AGENT_POLICY)).toBe(false);
    }
  });

  it('retains declared read skills and defaults missing skills to modify', () => {
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ llmLocalSkills: [{ name: 'summary', actionClass: 'read' }] }));
    expect(isWriteTool('local:summary')).toBe(false);
    expect(isWriteTool('local:unavailable')).toBe(true);
    localStorage.setItem('threatcaddy-settings', '{');
    expect(isWriteTool('local:summary')).toBe(true);
  });
});

describe('request execution constraints', () => {
  it.each([
    ['generate_report', {}, 'note'], ['update_knowledge', {}, 'note'],
    ['delegate_task', {}, 'task'], ['review_completed_task', {}, 'note'],
    ['enrich_ioc', {}, 'ioc'], ['enrich_ioc', {}, 'note'],
    ['create_in_investigation', { entityType: 'timeline-event' }, 'timeline'],
    ['link_entities', { links: [{ sourceType: 'task', targetType: 'note' }] }, 'task'],
    ['create_note_folder', {}, 'note'], ['run_agent_cycle', {}, 'ioc'],
    ['local:summary', {}, 'ioc'],
  ] as const)('enforces complete effects for %s and read-only %s', (name, input, entityType) => {
    expect(getReadOnlyEntityError(call(name, input), [entityType])).toBeTruthy();
  });

  it('permits read tools and unrelated source-only link updates', () => {
    expect(getReadOnlyEntityError(call('read_note'), ['note'])).toBeUndefined();
    expect(getReadOnlyEntityError(call('link_entities', { links: [{ sourceType: 'task', targetType: 'note' }] }), ['note'])).toBeUndefined();
  });

  it('rechecks persisted profile restrictions at the actual dispatcher', async () => {
    const profile = { ...BUILTIN_AGENT_PROFILES[0], id: 'restricted-profile', readOnlyEntityTypes: ['note'] };
    await db.agentProfiles.put(profile);
    const result = await executeTool(call('create_note', { title: 'Restricted' }), undefined, { profileId: profile.id });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('read-only');
    expect(await db.notes.count()).toBe(0);
    await db.agentProfiles.delete(profile.id);
  });

  it('persists an allowed Act-mode note', async () => {
    const result = await executeTool(call('create_note', { title: 'Approved draft', content: 'Summary' }), undefined, undefined, {
      allowedTools: new Set(['create_note']),
    });
    expect(result.isError).toBe(false);
    expect(await db.notes.count()).toBe(1);
  });

  it('keeps Plan mode read-only at dispatch', async () => {
    const result = await executeTool(call('create_note', { title: 'Draft' }), undefined, undefined, {
      allowedTools: new Set(['create_note']), readOnly: true,
    });
    expect(result.isError).toBe(true);
    expect(await db.notes.count()).toBe(0);
  });

  it('requires membership of the current request tool set', async () => {
    const result = await executeTool(call('create_note', { title: 'Draft' }), undefined, undefined, {
      allowedTools: new Set(['search_notes']),
    });
    expect(result.isError).toBe(true);
    expect(await db.notes.count()).toBe(0);
  });
});

describe('tool outcomes and shared approval queue', () => {
  it.each([
    { error: 'Entity not found' }, { success: false }, { success: true, linked: 1, errors: ['One link could not be saved'] },
  ])('marks unsuccessful and partial outcomes as errors: %j', payload => {
    expect(normalizeToolResult(JSON.stringify(payload)).isError).toBe(true);
  });

  it('preserves successful JSON and plain-text outcomes', () => {
    expect(normalizeToolResult('{"success":true}').isError).toBe(false);
    expect(normalizeToolResult('Report ready').isError).toBe(false);
  });

  it('records a failed approved operation as failed, preserving its diagnostic', async () => {
    const { action } = await queueAgentAction({ investigationId: 'case', threadId: 'thread', toolName: 'update_task', toolInput: { id: 'missing-task' }, rationale: 'Review task status' });
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect(await db.agentActions.get(action.id)).toMatchObject({ status: 'failed' });
  });

  it('queues an identical proposal once across simultaneous callers', async () => {
    const proposal = { investigationId: 'case', threadId: 'thread', toolName: 'create_note', toolInput: { title: 'Summary' }, rationale: 'Summarize findings' };
    const results = await Promise.all([queueAgentAction(proposal), queueAgentAction(proposal)]);
    expect(await db.agentActions.count()).toBe(1);
    expect(results.filter(result => result.alreadyPending)).toHaveLength(1);
  });

  it('retains distinct approval provenance when different agent origins propose the same input', async () => {
    const proposal = { investigationId: 'case', threadId: 'thread', toolName: 'create_note', toolInput: { title: 'Summary' }, rationale: 'Summarize findings' };
    await queueAgentAction(proposal);
    const supervisor = await queueAgentAction({ ...proposal, agentConfigId: SUPERVISOR_ACTION_PROFILE });
    expect(supervisor.alreadyPending).toBe(false);
    expect(supervisor.action.agentConfigId).toBe(SUPERVISOR_ACTION_PROFILE);
    expect(await db.agentActions.count()).toBe(2);
  });
});

describe('supervisor write scopes and investigation policies', () => {
  it('preserves cross-investigation analysis capabilities', async () => {
    await db.folders.add(folder('supervisor'));
    expect(await getSupervisorToolPermission(call('list_investigations'), 'supervisor')).toMatchObject({ kind: 'allowed' });
    expect(SUPERVISOR_TOOLS.size).toBe(11);
    expect(SUPERVISOR_TOOLS.has('create_in_investigation')).toBe(false);
  });

  it('honors disabled automatic reads in supervisor and cross-case policies', async () => {
    await db.folders.bulkAdd([folder('supervisor'), folder('case', { ...DEFAULT_AGENT_POLICY, autoApproveReads: false })]);
    expect(await getSupervisorToolPermission(call('list_investigations'), 'supervisor')).toMatchObject({ kind: 'approval-required' });
    expect(await getSupervisorToolPermission(call('search_notes', { query: 'finding' }), 'supervisor')).toMatchObject({ kind: 'allowed' });
    await db.folders.update('supervisor', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveReads: false } });
    expect(await getSupervisorToolPermission(call('search_notes', { query: 'finding' }), 'supervisor')).toMatchObject({ kind: 'approval-required' });
  });

  it('requires approval for a note under the default investigation policy', async () => {
    await db.folders.add(folder('supervisor'));
    expect(await getSupervisorToolPermission(call('create_note', { title: 'Summary' }), 'supervisor')).toEqual({ kind: 'approval-required', investigationId: 'supervisor' });
  });

  it('executes a supervisor note when its investigation approves creation', async () => {
    await db.folders.add(folder('supervisor', { ...DEFAULT_AGENT_POLICY, autoApproveCreate: true }));
    const result = await executeTool(call('create_note', { title: 'Summary' }), 'supervisor', undefined, {
      allowedTools: SUPERVISOR_TOOLS,
      validateScope: tool => validateSupervisorDispatch(tool, 'supervisor'),
    });
    expect(result.isError).toBe(false);
    expect((await db.notes.toArray())[0].folderId).toBe('supervisor');
  });

  it('accepts an analyst-approved supervisor note under the default policy', async () => {
    await db.folders.add(folder('supervisor'));
    const { action } = await queueAgentAction({ investigationId: 'supervisor', threadId: 'thread', agentConfigId: SUPERVISOR_ACTION_PROFILE, toolName: 'create_note', toolInput: { title: 'Reviewed summary' }, rationale: 'Analyst review' });
    expect((await executeApprovedAction(action)).isError).toBe(false);
    expect((await db.notes.toArray())[0].folderId).toBe('supervisor');
  });

  it('rechecks archived investigation status before applying a reviewed supervisor action', async () => {
    await db.folders.add(folder('supervisor'));
    const { action } = await queueAgentAction({ investigationId: 'supervisor', threadId: 'thread', agentConfigId: SUPERVISOR_ACTION_PROFILE, toolName: 'create_note', toolInput: { title: 'Reviewed summary' }, rationale: 'Analyst review' });
    await db.folders.update('supervisor', { status: 'archived' });
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect(await db.notes.count()).toBe(0);
    expect((await db.agentActions.get(action.id))?.status).toBe('failed');
  });

  it('uses the actual IOC investigation policy for updates', async () => {
    await db.folders.bulkAdd([folder('supervisor', { ...DEFAULT_AGENT_POLICY, autoApproveModify: true }), folder('case')]);
    await db.standaloneIOCs.add({ id: 'indicator', folderId: 'case', type: 'domain', value: 'example.com', confidence: 'medium', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    expect(await getSupervisorToolPermission(call('update_ioc', { id: 'indicator', confidence: 'high' }), 'supervisor')).toEqual({ kind: 'approval-required', investigationId: 'case' });
    const result = await executeTool(call('update_ioc', { id: 'indicator', confidence: 'high' }), 'supervisor', undefined, {
      allowedTools: SUPERVISOR_TOOLS,
      validateScope: tool => validateSupervisorDispatch(tool, 'supervisor'),
    });
    expect(result.isError).toBe(true);
    expect((await db.standaloneIOCs.get('indicator'))?.confidence).toBe('medium');
  });

  it('checks both investigations before creating a cross-case link', async () => {
    await db.folders.bulkAdd([folder('case-a', { ...DEFAULT_AGENT_POLICY, autoApproveCreate: true }), folder('case-b')]);
    await db.notes.bulkAdd(['case-a', 'case-b'].map(id => ({ id, folderId: id, title: 'Finding', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 })));
    const link = call('link_entities', { links: [{ sourceType: 'note', sourceId: 'case-a', targetType: 'note', targetId: 'case-b' }] });
    expect(await getSupervisorToolPermission(link, 'supervisor')).toMatchObject({ kind: 'approval-required' });
    await db.folders.update('case-b', { status: 'archived' });
    expect(await getSupervisorToolPermission(link, 'supervisor')).toMatchObject({ kind: 'denied' });
  });
});
