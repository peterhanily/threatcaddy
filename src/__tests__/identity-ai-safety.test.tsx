/**
 * F4: AI safety and cost for identities.
 * - AI-2: what identity tools and mentions send to the model is bounded, and paged where it is a list;
 *   tool results that are cut stay valid JSON.
 * - AI-3: approval cards name what a write changes, by its stored name, and how.
 * - AI-4: a tool that refuses keeps its own message (not the transaction's).
 * - AI-5: stakeholder agents find identities by name only and never read one in full.
 * - AI-6: identity writes ask on the agent surface and are refused on the bridge and supervisor.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentAction, AgentProfile, Identity, ToolUseBlock } from '../types';
import { executeTool } from '../lib/llm-tools';
import { truncateToolResult } from '../lib/llm-tool-execution';
import { resolveMentions } from '../lib/chat-mentions';
import { sanitizeIdentity } from '../lib/export';
import { classifyToolCall, decideToolCall } from '../lib/tool-reach';
import { AgentActionCard } from '../components/Agent/AgentActionCard';
import { ChatApprovalCard } from '../components/Chat/ChatApprovalCard';
import type { ApprovalItem } from '../lib/chat-tool-executor';
import { buildAgentToolset } from '../lib/caddy-agent';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { getToolActionClass } from '../lib/caddy-agent-policy';
import { seedAIWorkspace } from './helpers/ai-workspace';
import { summarizeToolChange } from '../lib/tool-change-summary';
import i18n from '../i18n';
import { ALL_STATIC_TOOLS } from './helpers/tool-exec';

const now = Date.now();
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'S', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now, ...extra });
let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: `f4-${++n}`, name, input });
const chat = async (name: string, input: Record<string, unknown>) =>
  (await executeTool(call(name, input), 'S', undefined, { surface: 'chat-plan', allowedTools: ALL_STATIC_TOOLS })).result;

beforeEach(seedAIWorkspace);
afterEach(() => cleanup());

describe('AI-2: what reaches the model is bounded', () => {
  it('shows a mentioned name as stored, though it holds "$\'" or "$&"', async () => {
    await db.identities.add(make('cash', "Cash$'Co $& Sons"));
    expect((await resolveMentions('Ask @identity:cash about it', 'S')).displayText).toBe("Ask @Cash$'Co $& Sons about it");
  });

  it('refuses more details with a message that matches what the agent sees', async () => {
    const details = (count: number, hidden: boolean) => Array.from({ length: count }, (_, i) => ({ id: `${hidden}-${i}`, label: hidden ? 'Phone' : 'Note', value: `${i}`, ...(hidden ? { private: true } : {}) }));
    await db.identities.bulkAdd([make('full', 'Full', { details: details(200, false) }), make('hidden', 'Hidden', { details: [...details(50, false), ...details(350, true)] })]);
    const write = async (id: string) => (await executeTool(call('update_identity', { id, addDetails: [{ label: 'Note', value: 'one more' }] }), 'S', undefined,
      { surface: 'chat-yolo', allowedTools: ALL_STATIC_TOOLS, signal: new AbortController().signal })).result;
    expect(await write('full')).toContain('An identity holds at most 200 details.');
    // 50 public details shown: no number the agent could not reconcile with them.
    const refused = await write('hidden');
    expect(refused).toContain('This identity cannot hold more details.');
    expect(refused).not.toContain('200');
  });

  it('reads a 3,000-person organisation a page at a time, with totals', async () => {
    const staff = Array.from({ length: 3000 }, (_, i) => make(`p${i}`, `Employee Number ${i}`, { connections: [{ targetId: 'acme', label: 'works at' }] }));
    await db.identities.bulkAdd([make('acme', 'Acme Shipping', { type: 'organization' }), ...staff]);
    const first = await chat('read_identity', { id: 'acme' });
    expect(first.length).toBeLessThan(10_000);
    const page = JSON.parse(first);
    expect(page.connections).toHaveLength(50);
    expect([page.connectionsTotal, page.nextOffset]).toEqual([3000, 50]);
    const last = JSON.parse(await chat('read_identity', { id: 'acme', offset: 2950 }));
    expect(last.connections).toHaveLength(50);
    expect(last.nextOffset).toBeUndefined();
    expect(new Set([...page.connections, ...last.connections].map((edge: { id: string }) => edge.id)).size).toBe(100);
  });

  it('searches with snippets and a few other names, and reads long text as read_note does', async () => {
    await db.identities.bulkAdd(Array.from({ length: 50 }, (_, i) => make(`d${i}`, `Person ${i}`, {
      description: 'x'.repeat(2000), aliases: Array.from({ length: 100 }, (_, j) => `alias-${i}-${j}`) })));
    const search = await chat('search_identities', { limit: 50 });
    expect(search.length).toBeLessThan(40_000);
    const one = JSON.parse(search).identities[0];
    expect([one.description.length, one.otherNames.length, one.otherNamesTotal]).toEqual([201, 10, 100]);
    await db.identities.add(sanitizeIdentity({ ...make('big', 'Big Text'), description: 'z'.repeat(500_000),
      details: Array.from({ length: 150 }, (_, i) => ({ id: `b${i}`, label: 'Note', value: 'q'.repeat(5000) })) }) as Identity);
    const read = await chat('read_identity', { id: 'big' });
    expect(read.length).toBeLessThan(40_000);
    expect(JSON.parse(read)).toMatchObject({ detailsTotal: 150, nextOffset: 50 });
  });

  it('caps an @identity: mention as an @note: mention is capped', async () => {
    await db.identities.add(make('many', 'Many Details', {
      details: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, label: 'Note', value: `${i} ${'w'.repeat(1990)}` })) }));
    expect((await resolveMentions('@identity:many', 'S')).contextBlock.length).toBeLessThan(4_400);
  });

  it('never ends a cut on half a character', async () => {
    // A lone half as a character, or as the escape JSON.stringify writes for one (what a provider rejects).
    const lone = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text) || /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/.test(text);
    await db.identities.add(make('emoji', 'Emoji Person', { description: 'a'.repeat(199) + '😀'.repeat(5000),
      details: Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, label: 'Note', value: 'b'.repeat(i % 2) + '😀'.repeat(300) })) }));
    for (const result of [await chat('read_identity', { id: 'emoji' }), await chat('search_identities', { query: 'emoji' }),
      (await resolveMentions('@identity:emoji', 'S')).contextBlock, truncateToolResult('c' + '😀'.repeat(40_000), 50_001)]) {
      expect(lone(result)).toBe(false);
    }
  });

  it('keeps a page under the tool-result cap however long its items, and reads every item once', async () => {
    const long = (prefix: string, i: number) => `${prefix} ${i} ${'y'.repeat(600)}`;
    const members = Array.from({ length: 120 }, (_, i) => make(`m${i}`, long('Member', i), { connections: [{ targetId: 'org', label: long('works at', i) }] }));
    await db.identities.bulkAdd([make('org', 'Org', { type: 'organization', description: 'd'.repeat(9000),
      aliases: Array.from({ length: 120 }, (_, i) => long('Alias', i)),
      details: Array.from({ length: 120 }, (_, i) => ({ id: `x${i}`, label: long('Label', i), value: long('Value', i) })) }), ...members]);
    const seen = new Set<string>();
    let offset: number | undefined = 0;
    for (let reads = 0; offset !== undefined && reads < 200; reads++) {
      const result = await chat('read_identity', { id: 'org', offset });
      expect(result.length).toBeLessThan(50_000);
      const page = JSON.parse(result);
      for (const edge of page.connections) { expect(seen.has(edge.id)).toBe(false); seen.add(edge.id); }
      offset = page.nextOffset;
    }
    expect(seen.size).toBe(120);
  });

  it('pages tags too', async () => {
    await db.identities.add(make('tagged', 'Tagged', { tags: Array.from({ length: 400 }, (_, i) => `tag-${i}-${'t'.repeat(300)}`) }));
    const read = await chat('read_identity', { id: 'tagged' });
    expect(read.length).toBeLessThan(15_000);
    expect(JSON.parse(read)).toMatchObject({ tagsTotal: 400, nextOffset: 50 });
  });

  it('cuts a long JSON tool result to valid JSON that says it was cut; text keeps its marker', () => {
    const json = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, i) => ({ id: i, text: 'quote " and \\\\ backslash' })) });
    const cut = truncateToolResult(json, 50_000);
    expect(cut.length).toBeLessThan(50_500);
    expect(JSON.parse(cut)).toMatchObject({ truncated: true });
    expect(truncateToolResult('x'.repeat(60_000), 50_000)).toContain('[TRUNCATED');
    // Never a lone half of a surrogate pair at the cut.
    const emoji = JSON.stringify({ text: 'a'.repeat(49_999) + '😀'.repeat(100) });
    const partial = JSON.parse(truncateToolResult(emoji, 50_000)).partial as string;
    expect(/[\uD800-\uDBFF]$/.test(partial)).toBe(false);
  });
});

describe('AI-3: approval cards say what changes, by name', () => {
  beforeEach(async () => {
    await db.identities.bulkAdd([make('Xq7_dana', 'Dana Okafor', { status: 'compromised' }), make('Lk2_lee', 'Lee Park')]);
  });
  const chatCard = async (name: string, input: Record<string, unknown>) => {
    const toolUse = call(name, input);
    const reach = await classifyToolCall(toolUse, { homeFolderId: 'S', settings: {} as never });
    const item: ApprovalItem = { toolUse, reach, reason: 'write', readForeignThisRequest: false };
    const { container } = render(<ChatApprovalCard item={item} index={1} total={1} onApprove={vi.fn()} onReject={vi.fn()} />);
    await screen.findByTestId('tool-change-summary');
    return container;
  };

  it('names the identity an agent proposal changes, whatever the rationale says', async () => {
    const action: AgentAction = { id: 'a1', investigationId: 'S', threadId: 't', agentConfigId: 'ap-timeline-builder', toolName: 'update_identity',
      toolInput: { id: 'Xq7_dana', status: 'cleared', addDetails: [{ label: 'Mobile phone', value: '+1 555 0100' }, { label: 'Email', value: 'dana@example.invalid' }] },
      rationale: 'Lee Park was confirmed clean by IT; clearing Lee Park.', status: 'pending', createdAt: 1 };
    const { container } = render(<AgentActionCard action={action} onApprove={vi.fn()} onReject={vi.fn()} />);
    const summary = await screen.findByTestId('tool-change-summary');
    expect(summary.textContent).toContain('Changes Dana Okafor');
    expect(summary.textContent).toContain('status: compromised → cleared');
    expect(summary.textContent).toContain('addDetails: Mobile phone (private), Email');
    // Never a private value on the card's summary.
    expect(summary.textContent).not.toContain('+1 555 0100');
    expect(container.textContent).toContain('Lee Park');
  });

  it('names both ends of a connection, and a new identity, in chat', async () => {
    expect((await chatCard('connect_identities', { fromId: 'Lk2_lee', phrase: 'reports to', toName: 'Dana Okafor' })).textContent).toContain('Lee Park reports to Dana Okafor');
    cleanup();
    const created = await chatCard('create_identity', { name: 'Ana Silva', type: 'person', details: [{ label: 'Home address', value: '1 Fictional Way' }] });
    await waitFor(() => expect(created.textContent).toContain('Creates Ana Silva'));
    const summary = screen.getByTestId('tool-change-summary').textContent;
    expect(summary).toContain('details: Home address (private)');
    // The summary never shows a private value (the raw input stays under Details, as before).
    expect(summary).not.toContain('1 Fictional Way');
  });

  it('agrees with the tool: contact only as a boolean, at most 30 items, other names it will add, ends found as it finds them', async () => {
    await db.identities.update('Xq7_dana', { aliases: ['The CEO'] });
    const update = await summarizeToolChange('update_identity', { id: 'Lk2_lee', contact: 'false',
      addOtherNames: ['L. Park', 'the ceo'], addDetails: Array.from({ length: 45 }, (_, i) => ({ label: `Label ${i}`, value: 'v' })) }, 'S');
    expect(update?.fields.map(field => field.field)).toEqual(['addOtherNames', 'addDetails']);
    expect(update?.fields[0].items?.map(item => item.text)).toEqual(['L. Park']);
    expect(update?.fields[1].items).toHaveLength(30);
    const created = await summarizeToolChange('create_identity', { name: 'Ana Silva', type: 'person', contact: 'yes' }, 'S');
    expect(created?.fields.map(field => field.field)).toEqual(['type']);
    expect(await summarizeToolChange('connect_identities', { fromName: 'Lee Park', phrase: 'reports to', toName: 'the ceo' }, 'S'))
      .toMatchObject({ kind: 'connects', from: 'Lee Park', to: 'Dana Okafor' });
    expect(await summarizeToolChange('connect_identities', { fromName: 'Lee Park', phrase: 'reports to', toName: 'Nobody' }, 'S')).toMatchObject({ kind: 'missing' });
  });

  it('strips direction controls from names, ignores empty values, and follows a rename', async () => {
    await db.identities.update('Lk2_lee', { name: 'Lee \u202EkraP' });
    const connect = await summarizeToolChange('connect_identities', { fromId: 'Lk2_lee', phrase: 'reports to', toId: 'Xq7_dana' }, 'S');
    expect(JSON.stringify(connect)).not.toMatch(/\u202E|\\u202e/i);
    await db.standaloneIOCs.add({ id: 'f4-ioc2', folderId: 'S', type: 'domain', value: 'bad.example', confidence: 'low', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now } as never);
    expect((await summarizeToolChange('update_ioc', { id: 'f4-ioc2', type: '', confidence: 'high' }, 'S'))?.fields.map(field => field.field)).toEqual(['confidence']);
    // Where the tool stores an empty value, the card shows it: the IOC's value and attribution wiped.
    expect((await summarizeToolChange('update_ioc', { id: 'f4-ioc2', value: '', attribution: '' }, 'S'))?.fields)
      .toEqual([{ field: 'value', from: 'bad.example', to: '—' }, { field: 'attribution', from: '—', to: '—' }]);
    const action: AgentAction = { id: 'a2', investigationId: 'S', threadId: 't', agentConfigId: 'ap-timeline-builder', toolName: 'update_identity',
      toolInput: { id: 'Xq7_dana', status: 'cleared' }, rationale: 'r', status: 'pending', createdAt: 1 };
    render(<AgentActionCard action={action} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect((await screen.findByTestId('tool-change-summary')).textContent).toContain('Changes Dana Okafor');
    // The name is isolated in a sentence that follows the interface's direction (a right-to-left name
    // cannot swap the sides of "X reports to Y").
    const summary = screen.getByTestId('tool-change-summary');
    expect(summary.querySelector('p')?.hasAttribute('dir')).toBe(false);
    expect([...summary.querySelectorAll('p bdi')].map(element => element.textContent)).toEqual(['Dana Okafor']);
    await db.identities.update('Xq7_dana', { name: 'Dana Okafor-Reyes' });
    await waitFor(() => expect(screen.getByTestId('tool-change-summary').textContent).toContain('Changes Dana Okafor-Reyes'));
  });

  it('marks a detail private by the interface language\'s labels, loading them first as the tool does', async () => {
    const language = i18n.language;
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    await i18n.changeLanguage('de');
    i18n.removeResourceBundle('de', 'identities');
    const english = i18n.getResourceBundle('en', 'identities') as Record<string, string>;
    const load = vi.spyOn(i18n, 'loadNamespaces').mockImplementation(async () => { i18n.addResourceBundle('de', 'identities', { ...english, 'detailLabel.phone': 'Telefon' }); });
    try {
      const summary = await summarizeToolChange('update_identity', { id: 'Lk2_lee', addDetails: [{ label: 'Telefon', value: '+49 30 1234567' }] }, 'S');
      expect(load).toHaveBeenCalledWith('identities');
      expect(summary?.fields[0].items).toEqual([{ text: 'Telefon', private: true }]);
    } finally {
      load.mockRestore();
      await i18n.changeLanguage(language);
      for (const namespace of Object.keys(i18n.getDataByLanguage('de') ?? {})) i18n.removeResourceBundle('de', namespace);
    }
  });

  it('names the note, task and IOC an update changes (the same gap since 2.0.4)', async () => {
    const title = (await db.notes.get('S-note'))?.title ?? '';
    expect(title).not.toBe('');
    expect((await chatCard('update_note', { id: 'S-note', title: 'Renamed', content: 'New body' })).textContent)
      .toMatch(new RegExp(`Changes ${title}.*title: ${title} → Renamed.*content: changed`));
    cleanup();
    await db.tasks.add({ id: 'f4-task', folderId: 'S', title: 'Rotate keys', completed: false, priority: 'high', status: 'todo', order: 0, tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now } as never);
    expect((await chatCard('update_task', { id: 'f4-task', status: 'done' })).textContent).toContain('status: todo → done');
    cleanup();
    await db.standaloneIOCs.add({ id: 'f4-ioc', folderId: 'S', type: 'domain', value: 'bad.example', confidence: 'low', tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now } as never);
    const ioc = await chatCard('update_ioc', { id: 'f4-ioc', confidence: 'high' });
    await waitFor(() => expect(ioc.textContent).toContain('Changes domain: bad.example'));
    expect(ioc.textContent).toContain('confidence: low → high');
  });
});

describe('AI-4: a refusing tool keeps its own message', () => {
  it('returns the duplicate-name guidance, not the rolled-back transaction\'s error', async () => {
    await db.identities.add(make('Xq7_dana', 'Dana Okafor'));
    const result = await executeTool(call('create_identity', { name: 'Dana Okafor', type: 'person' }), 'S', undefined,
      { surface: 'chat-yolo', allowedTools: ALL_STATIC_TOOLS, signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.result).toMatch(/Dana Okafor/);
    expect(result.result).not.toMatch(/committed too early|PrematureCommit/i);
    expect(await db.identities.count()).toBe(1);
  });
});

describe('AI-5 and AI-6: stakeholder agents, and surfaces without a person', () => {
  const observer = { id: 'obs', name: 'Observer', role: 'observer', source: 'user', systemPrompt: '', allowedTools: undefined, createdAt: 1, updatedAt: 1 } as unknown as AgentProfile;

  it('never offers or runs read_identity for a stakeholder, even with no tool list, and finds names only', async () => {
    for (const homeShareable of [false, true]) {
      const names = buildAgentToolset({ profile: observer, baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS,
        executiveTools: EXECUTIVE_TOOL_DEFINITIONS, hostTools: [], getActionClass: getToolActionClass, homeShareable }).availableTools.map(tool => tool.name);
      expect(names).toContain('search_identities');
      expect(names).not.toContain('read_identity');
    }
    await db.agentProfiles.add(observer);
    await db.identities.add(make('Xq7_dana', 'Dana Okafor', { aliases: ['Secret Alias'] }));
    const run = (name: string, input: Record<string, unknown>) => executeTool(call(name, input), 'S', { profileId: 'obs' }, { surface: 'agent', allowedTools: ALL_STATIC_TOOLS });
    expect((await run('read_identity', { id: 'Xq7_dana' })).isError).toBe(true);
    expect(JSON.parse((await run('search_identities', { query: 'secret' })).result).count).toBe(0);
    expect(JSON.parse((await run('search_identities', { query: 'dana' })).result).count).toBe(1);
  });

  it('asks for identity writes on the agent surface and refuses them on the bridge and supervisor, whatever the policy', async () => {
    const settings = { agentPolicy: { autoApproveCreate: true, autoApproveModify: true } } as never;
    for (const name of ['create_identity', 'update_identity', 'connect_identities']) {
      const reach = await classifyToolCall(call(name, { id: 'x', name: 'X', type: 'person', fromId: 'x', toId: 'y', phrase: 'reports to' }), { homeFolderId: 'S', settings });
      const policy = { autoApproveReads: true, autoApproveEnrich: true, autoApproveFetch: true, autoApproveCreate: true, autoApproveModify: true, autoApproveDelegate: true };
      expect(decideToolCall(reach, { surface: 'agent', policy } as never)).toEqual({ kind: 'ask', reason: 'policy' });
      expect(decideToolCall(reach, { surface: 'bridge' }).kind).toBe('deny');
      expect(decideToolCall(reach, { surface: 'supervisor' }).kind).toBe('deny');
    }
    // Before the rows that would only ask: an identity in another investigation, or a harvested call.
    await db.folders.add({ id: 'O', name: 'Other case', order: 9, createdAt: now, updatedAt: now } as never);
    await db.identities.add({ ...make('other-id', 'Elsewhere'), folderId: 'O' });
    const cross = await classifyToolCall(call('update_identity', { id: 'other-id', status: 'cleared' }), { homeFolderId: 'S', settings });
    expect(cross.crossWrite).toBe(true);
    for (const surface of ['supervisor', 'bridge'] as const) {
      expect(decideToolCall(cross, { surface }).kind).toBe('deny');
      expect(decideToolCall({ ...cross, crossWrite: false, harvested: true }, { surface }).kind).toBe('deny');
    }
  });
});
