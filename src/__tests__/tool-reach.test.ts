import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { DEFAULT_SETTINGS, type Settings, type ToolUseBlock } from '../types';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { classifyToolCall } from '../lib/tool-reach';
import { isTrustedFetchUrl } from '../lib/caddy-agent-policy';
import { isFolderLocalOnly, isShareableFolder } from '../lib/ai-scope';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';

const call = (name: string, input: Record<string, unknown> = {}, id = 'call-1'): ToolUseBlock => ({ type: 'tool_use', id, name, input });
const reach = (name: string, input: Record<string, unknown> = {}, homeFolderId?: string, settings: Settings = DEFAULT_SETTINGS, id?: string) =>
  classifyToolCall(call(name, input, id), { homeFolderId, settings });

const STATIC_TOOLS = [...TOOL_DEFINITIONS, ...DELEGATION_TOOL_DEFINITIONS, ...EXECUTIVE_TOOL_DEFINITIONS].map(tool => tool.name);
const READ_ONLY = new Set(['search_notes', 'search_all', 'read_note', 'list_tasks', 'list_iocs', 'list_timeline_events', 'read_task',
  'read_ioc', 'read_timeline_event', 'get_investigation_summary', 'analyze_graph', 'fetch_url', 'extract_iocs', 'list_investigations',
  'get_investigation_details', 'search_across_investigations', 'compare_investigations', 'list_integrations', 'forensicate_scan',
  'recall_knowledge', 'query_siem', 'list_folders', 'list_deployed_agents', 'list_agent_activity', 'read_soul']);
const EGRESS: Record<string, string> = { fetch_url: 'open-fetch', enrich_ioc: 'vendor', query_siem: 'configured' };
const NEVER = new Set(['deploy_agent', 'stop_agent', 'run_agent_cycle', 'create_in_investigation', 'run_remote_command']);
const CONTROL = new Set(['spawn_agent', 'define_specialist', 'dismiss_agent', 'reflect_on_performance']);
const CROSS_CASE = new Set(['list_investigations', 'get_investigation_details', 'search_across_investigations', 'compare_investigations']);
const INPUT: Record<string, Record<string, unknown>> = { fetch_url: { url: 'https://collector.example/c' } };

beforeEach(seedAIWorkspace);

describe('A-REACH-1 static classification of every tool', () => {
  it('covers all 46 + 7 + 5 static tools', () => {
    expect(STATIC_TOOLS).toHaveLength(58);
  });

  it.each(STATIC_TOOLS)('%s: write, egress, agent control and cross-case reading', async name => {
    const result = await reach(name, INPUT[name] ?? {}, 'S');
    expect(result.write).toBe(!READ_ONLY.has(name));
    expect(result.egress).toBe(EGRESS[name] ?? 'none');
    expect(result.agentControl).toBe(NEVER.has(name) ? 'never' : CONTROL.has(name) ? 'ask' : undefined);
    if (CROSS_CASE.has(name)) expect(result.crossRead).toBe(true);
    expect(result.harvested).toBe(false);
    expect(result.homeShareable).toBe(true);
  });

  it('classifies create_ticket as configured egress only when a ticket endpoint is set', async () => {
    expect((await reach('create_ticket', { title: 't', description: 'd' }, 'S')).egress).toBe('none');
    const configured = { ...DEFAULT_SETTINGS, ticketEndpoint: 'https://tickets.example/api' } as Settings;
    const result = await reach('create_ticket', { title: 't', description: 'd' }, 'S', configured);
    expect(result).toMatchObject({ egress: 'configured', destinations: ['tickets.example'] });
  });

  it('names the vendors an enrichment would contact', async () => {
    await db.installedIntegrations.add({ id: 'vt', templateId: 'vt-ip-lookup', name: 'VT', enabled: true, config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    await db.standaloneIOCs.update(ids('S').ioc, { type: 'ipv4', value: '203.0.113.7' });
    const result = await reach('enrich_ioc', { iocId: ids('S').ioc }, 'S');
    expect(result.egress).toBe('vendor');
    expect(result.destinations.join(' ')).toContain('www.virustotal.com');
  });
});

describe('A-REACH-2 by-id scope', () => {
  it('reads in the home investigation stay in scope', async () => {
    expect(await reach('read_note', { id: ids('S').note }, 'S')).toMatchObject({ crossRead: false, crossWrite: false, hidden: false, targetFolderIds: [] });
  });

  it('reads of another synced investigation are cross reads naming the target', async () => {
    const result = await reach('read_note', { id: ids('P').note }, 'S');
    expect(result).toMatchObject({ crossRead: true, crossWrite: false, hidden: false, targetFolderIds: ['P'] });
    expect(result.flags).toContain('target-synced');
  });

  it.each(['read_note', 'read_task', 'read_ioc'] as const)('%s of a local-only row from a shared home is hidden', async name => {
    const id = name === 'read_note' ? ids('L').note : name === 'read_task' ? ids('L').task : ids('L').ioc;
    expect((await reach(name, { id }, 'S')).hidden).toBe(true);
  });

  it('a local-only home may read another local-only investigation', async () => {
    expect(await reach('read_note', { id: ids('L').note }, 'L2')).toMatchObject({ hidden: false, crossRead: true, homeShareable: false });
  });

  it('by-id reads of a trashed row are hidden on every home', async () => {
    await db.notes.update(ids('S').note, { trashed: true });
    expect((await reach('read_note', { id: ids('S').note }, 'S')).hidden).toBe(true);
    expect((await reach('read_note', { id: ids('S').note })).hidden).toBe(true);
  });

  it('writes resolve the entity investigation', async () => {
    expect(await reach('update_note', { id: ids('P').note }, 'S')).toMatchObject({ crossWrite: true, crossRead: false, targetFolderIds: ['P'] });
    expect(await reach('update_note', { id: ids('S').note }, 'S')).toMatchObject({ crossWrite: false });
    expect(await reach('review_completed_task', { taskId: ids('P').task }, 'S')).toMatchObject({ crossWrite: true });
    expect(await reach('enrich_ioc', { iocId: ids('P').ioc }, 'S')).toMatchObject({ crossWrite: true });
    expect(await reach('create_note', { title: 'x' }, 'S')).toMatchObject({ crossWrite: false, targetFolderIds: [] });
    expect((await reach('update_note', { id: ids('L').note }, 'S')).hidden).toBe(true);
  });

  it('without a home, reads are never cross reads and writes to a filed row are cross writes', async () => {
    expect(await reach('read_note', { id: ids('P').note })).toMatchObject({ crossRead: false, homeShareable: false });
    expect(await reach('update_note', { id: ids('S').note })).toMatchObject({ crossWrite: true });
    expect(await reach('create_note', { title: 'x' })).toMatchObject({ crossWrite: false });
  });

  it('an unresolved id gives no target', async () => {
    expect(await reach('update_note', { id: 'missing' }, 'S')).toMatchObject({ crossWrite: false, hidden: false, targetFolderIds: [] });
  });
});

describe('A-REACH-3 dynamic tools', () => {
  it('a host skill declared read is still configured egress', async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, agentHosts: [{ id: 'h', name: 'x', displayName: 'X', url: 'https://skills.example', enabled: true, skills: [{ name: 'y', description: 'Read', parameters: { type: 'object', properties: {} }, actionClass: 'read' }] }] };
    expect(await reach('host:x:y', {}, 'S', settings)).toMatchObject({ egress: 'configured', destinations: ['skills.example'] });
    expect((await reach('local:summary', {}, 'S')).egress).toBe('configured');
  });
});

describe('A-REACH-4 harvested calls', () => {
  it('marks calls parsed out of model text', async () => {
    expect((await reach('create_note', {}, 'S', DEFAULT_SETTINGS, 'text_tc_1')).harvested).toBe(true);
    expect((await reach('create_note', {}, 'S', DEFAULT_SETTINGS, 'toolu_1')).harvested).toBe(false);
  });
});

describe('A-REACH-5 local-only facts, links and named investigations', () => {
  it('reads local-only from the folder flag or the persisted privacy marker', async () => {
    await db.folders.add({ id: 'M', name: 'Marked', order: 9, createdAt: 1 });
    expect(await isFolderLocalOnly('M')).toBe(false);
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'M']), value: true });
    expect(await isFolderLocalOnly('M')).toBe(true);
    expect(await isShareableFolder('M')).toBe(false);
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'M']), value: false });
    expect(await isShareableFolder('M')).toBe(true);
    expect(await isFolderLocalOnly('L')).toBe(true);
    expect(await isShareableFolder(undefined)).toBe(false);
    expect(await isShareableFolder('missing')).toBe(false);
  });

  it('a marker-only local-only row is hidden from a shared home', async () => {
    await db.folders.add({ id: 'M', name: 'Marked', order: 9, createdAt: 1 });
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'M']), value: true });
    await db.notes.add({ id: 'M-note', folderId: 'M', title: 'm', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
    expect((await reach('read_note', { id: 'M-note' }, 'S')).hidden).toBe(true);
  });

  it('checks both ends of every link', async () => {
    const link = (target: string) => ({ links: [{ sourceType: 'note', sourceId: ids('S').note, targetType: 'note', targetId: target }] });
    expect(await reach('link_entities', link(ids('P').note), 'S')).toMatchObject({ crossWrite: true, targetFolderIds: ['P'] });
    expect((await reach('link_entities', link(ids('L').note), 'S')).hidden).toBe(true);
    expect(await reach('link_entities', link(ids('S').note), 'S')).toMatchObject({ crossWrite: false });
  });

  it('create_in_investigation resolves an exact name only', async () => {
    expect(await reach('create_in_investigation', { investigationName: 'Priv', entityType: 'note', data: {} }, 'S')).toMatchObject({ crossWrite: false, targetFolderIds: [] });
    expect(await reach('create_in_investigation', { investigationName: 'private CASE', entityType: 'note', data: {} }, 'S')).toMatchObject({ crossWrite: true, targetFolderIds: ['P'] });
    expect((await reach('create_in_investigation', { investigationId: 'L', entityType: 'note', data: {} }, 'S')).hidden).toBe(true);
  });

  it('a by-id lookup of a local-only investigation is hidden from a shared home', async () => {
    expect((await reach('get_investigation_details', { id: 'L' }, 'S')).hidden).toBe(true);
    expect((await reach('compare_investigations', { investigationIds: ['P', 'L'] }, 'S')).hidden).toBe(true);
    expect((await reach('get_investigation_details', { id: 'L' }, 'L2')).hidden).toBe(false);
  });
});

describe('A-REACH-6 web fetch', () => {
  it.each([
    ['https://nvd.nist.gov/vuln/detail/CVE-2024-0001', true],
    ['https://attack.mitre.org/techniques/T1059/', true],
    ['https://nvd.nist.gov:443/vuln', true],
    ['http://nvd.nist.gov/vuln', false],
    ['https://user:pass@nvd.nist.gov/', false],
    ['https://nvd.nist.gov:8443/', false],
    ['https://nvd.nist.gov./', false],
    ['https://evil-nvd.nist.gov.example/', false],
    ['https://collector.example/c', false],
    [`https://nvd.nist.gov/${'a'.repeat(2050)}`, false],
    ['not a url', false],
  ])('isTrustedFetchUrl(%s) is %s', (url, trusted) => {
    expect(isTrustedFetchUrl(url)).toBe(trusted);
  });

  it('separates trusted reference sites from open fetches', async () => {
    expect(await reach('fetch_url', { url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001' }, 'S')).toMatchObject({ egress: 'trusted-fetch', destinations: ['nvd.nist.gov'], flags: [] });
    const open = await reach('fetch_url', { url: 'https://collector.example/c?d=1' }, 'S');
    expect(open).toMatchObject({ egress: 'open-fetch', destinations: ['collector.example'] });
    expect(open.flags).toContain('untrusted-host');
  });

  it('flags long data-carrying URLs and hosts that are IOCs of the case', async () => {
    const long = await reach('fetch_url', { url: `https://collector.example/c?d=${encodeURIComponent('x'.repeat(300))}` }, 'S');
    expect(long.flags).toContain('url-carries-data');
    expect((await reach('fetch_url', { url: 'https://collector.example/c?d=short' }, 'S')).flags).not.toContain('url-carries-data');
    const ioc = await reach('fetch_url', { url: 'https://canary-s.example/' }, 'S');
    expect(ioc.flags).toContain('host-is-ioc');
    expect((await reach('fetch_url', { url: 'https://canary-p.example/' }, 'S')).flags).not.toContain('host-is-ioc');
  });
});
