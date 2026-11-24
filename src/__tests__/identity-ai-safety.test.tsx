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

  it('cuts a long JSON tool result to valid JSON that says it was cut; text keeps its marker', () => {
    const json = JSON.stringify({ rows: Array.from({ length: 5000 }, (_, i) => ({ id: i, text: 'quote " and \\\\ backslash' })) });
    const cut = truncateToolResult(json, 50_000);
    expect(cut.length).toBeLessThan(50_500);
    expect(JSON.parse(cut)).toMatchObject({ truncated: true });
    expect(truncateToolResult('x'.repeat(60_000), 50_000)).toContain('[TRUNCATED');
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
  });
});
