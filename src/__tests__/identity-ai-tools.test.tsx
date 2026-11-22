/**
 * The AI's identity tools: private details never reach a model (not in results, not through
 * search, not through what a write says), writes stay in their investigation, and agents
 * change identities only with a person's approval.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, type Identity, type ToolUseBlock } from '../types';
import { executeTool } from '../lib/llm-tools';
import { mintHumanApproval } from '../lib/human-approval';
import { classifyToolCall, decideToolCall, type ToolSurface } from '../lib/tool-reach';
import { IDENTITY_TOOLS, shouldAutoApprove } from '../lib/caddy-agent-policy';
import { buildAgentToolset } from '../lib/caddy-agent';
import { getToolActionClass } from '../lib/caddy-agent-policy';
import { TOOL_DEFINITIONS, DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS } from '../lib/llm-tool-defs';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { resolveMentions, searchMentions } from '../lib/chat-mentions';
import { BRIDGE_TOOLS } from '../lib/agent-bridge';
import { executeCreateIdentity } from '../lib/llm-tools-identities';
import { seedAIWorkspace } from './helpers/ai-workspace';
import { ALL_STATIC_TOOLS } from './helpers/tool-exec';

const SECRET_PHONE = '+44 7700 900123';
const SECRET_HOME = '12 Fictional Lane';
const now = Date.now();
const make = (id: string, folderId: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId, type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now, ...extra });

/** The stored identity, which the test expects to exist. */
async function stored(id: string): Promise<Identity> {
  const identity = await db.identities.get(id);
  if (!identity) throw new Error(`No identity ${id}`);
  return identity;
}

let n = 0;
const call = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({ type: 'tool_use', id: `call-${name}-${++n}`, name, input });
/** Runs a call as CaddyAI chat in Act mode, approved by a person when it asks. */
async function run(name: string, input: Record<string, unknown>, folderId = 'S', surface: ToolSurface = 'chat-act') {
  const toolUse = call(name, input);
  const approval = mintHumanApproval(toolUse, folderId, 'chat-card');
  const { result, isError } = await executeTool(toolUse, folderId, undefined, { surface, allowedTools: ALL_STATIC_TOOLS, approval });
  return { ...JSON.parse(result), isError } as Record<string, unknown> & { isError?: boolean };
}

beforeEach(async () => {
  await seedAIWorkspace();
  await db.identities.bulkAdd([
    make('dana', 'S', 'Dana Okafor', { status: 'compromised', aliases: ['D. Okafor'], description: 'Accounts payable',
      details: [{ id: 'e', label: 'Email', value: 'dana@halvorsen.example' }, { id: 'p', label: 'Phone', value: SECRET_PHONE, private: true },
        { id: 'h', label: 'Bank reference', value: SECRET_HOME, private: true }],
      connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'lee', label: 'reports to' }] }),
    make('lee', 'S', 'Lee Park', { description: 'Finance director' }),
    make('org', 'S', 'Halvorsen Shipping', { type: 'organization' }),
    make('twin-a', 'S', 'Sam Lee'), make('twin-b', 'S', 'Sam Lee'),
    make('elsewhere', 'P', 'Private Person', { details: [{ id: 'x', label: 'Email', value: 'private@example.test' }] }),
  ]);
});

describe('private details never reach a model', () => {
  it('reads public details and connections from both sides, never a private value or label', async () => {
    const dana = await run('read_identity', { name: 'd. okafor' });
    expect(dana).toMatchObject({ id: 'dana', name: 'Dana Okafor', status: 'compromised', organization: 'Halvorsen Shipping',
      details: [{ label: 'Email', value: 'dana@halvorsen.example' }] });
    expect(dana.connections).toEqual(expect.arrayContaining([
      { phrase: 'works at', direction: 'out', id: 'org', name: 'Halvorsen Shipping' },
      { phrase: 'reports to', direction: 'out', id: 'lee', name: 'Lee Park' }]));
    const lee = await run('read_identity', { id: 'lee' });
    expect(lee.connections).toEqual([{ phrase: 'reports to', direction: 'in', id: 'dana', name: 'Dana Okafor' }]);
    for (const text of [JSON.stringify(dana), JSON.stringify(lee)]) {
      expect(text).not.toContain('7700');
      expect(text).not.toContain(SECRET_HOME);
      expect(text).not.toContain('Bank reference');
    }
  });

  it('never finds anyone by a private value, so a search cannot confirm a guess', async () => {
    expect(await run('search_identities', { query: '7700 900123' })).toMatchObject({ count: 0, identities: [] });
    expect(await run('search_identities', { query: 'Fictional Lane' })).toMatchObject({ count: 0 });
    const byEmail = await run('search_identities', { query: 'halvorsen.example' });
    expect((byEmail.identities as Array<{ name: string }>).map(identity => identity.name)).toEqual(['Dana Okafor']);
    expect(JSON.stringify(byEmail)).not.toContain('7700');
  });

  it('answers a write the same whether or not its value is already held privately, and keeps such a value private', async () => {
    const guess = await run('update_identity', { id: 'dana', addDetails: [{ label: 'Mobile', value: SECRET_PHONE }] });
    const other = await run('update_identity', { id: 'dana', addDetails: [{ label: 'Mobile', value: '+44 7700 900999' }] });
    expect(Object.keys(guess).sort()).toEqual(Object.keys(other).sort());
    expect(guess.detailsAdded).toBe(1);
    const details = (await stored('dana')).details;
    expect(details.find(detail => detail.value === SECRET_PHONE && detail.label === 'Mobile')?.private).toBe(true);
    // A phone number given under a label private by default is stored as private too.
    await run('update_identity', { id: 'lee', addDetails: [{ label: 'Phone', value: '+1 555 0100' }, { label: 'Email', value: 'lee@halvorsen.example' }] });
    expect((await stored('lee')).details.map(({ label, private: hidden }) => [label, !!hidden])).toEqual([['Phone', true], ['Email', false]]);
    expect(JSON.stringify(await run('read_identity', { id: 'lee' }))).not.toContain('555 0100');
  });

  it('gives a chat @identity: mention only public fields, and searches names only', async () => {
    const { contextBlock, displayText } = await resolveMentions('What about @identity:dana ?', 'S');
    expect(displayText).toBe('What about @Dana Okafor ?');
    expect(contextBlock).toContain('Email: dana@halvorsen.example');
    expect(contextBlock).toContain('Organization: Halvorsen Shipping');
    expect(contextBlock).not.toContain('7700');
    expect(contextBlock).not.toContain(SECRET_HOME);
    expect(await searchMentions('identity', '7700', 'S')).toEqual([]);
    expect((await searchMentions('identity', 'okaf', 'S')).map(item => item.label)).toEqual(['Dana Okafor']);
  });
});

describe('writes', () => {
  it('creates an identity once, in the investigation, with its organisation and the folder\'s classification', async () => {
    await db.folders.update('S', { clsLevel: 'TLP:AMBER' });
    const created = await run('create_identity', { name: 'Ana Silva', type: 'Person', organization: 'Halvorsen Shipping', otherNames: ['A. Silva', 'Lee Park'],
      details: [{ label: 'Email', value: 'ana@halvorsen.example' }, { label: 'Home address', value: '1 Fictional Road' }] });
    expect(created).toMatchObject({ success: true, name: 'Ana Silva', type: 'person', detailsAdded: 2, otherNamesSkipped: ['Lee Park'] });
    const ana = await stored(created.id as string);
    expect(ana).toMatchObject({ folderId: 'S', clsLevel: 'TLP:AMBER', aliases: ['A. Silva'], connections: [{ targetId: 'org', label: 'works at' }] });
    expect(ana.details.find(detail => detail.label === 'Home address')?.private).toBe(true);
    expect((await run('create_identity', { name: 'a. silva' })).error).toMatch(/already an identity/);
    expect((await run('create_identity', { name: 'Ben', organization: 'Lee Park' })).error).toMatch(/not one organization/);
  });

  it('refuses a name two identities share, connects with reverse wording, and stays in one investigation', async () => {
    expect((await run('read_identity', { name: 'Sam Lee' })).error).toMatch(/names 2 identities/);
    expect(await run('connect_identities', { fromName: 'Lee Park', phrase: 'manages', toName: 'Sam Lee' })).toMatchObject({ error: expect.stringMatching(/to: "Sam Lee" names 2/) });
    const connected = await run('connect_identities', { fromName: 'Lee Park', phrase: 'manages', toId: 'twin-a' });
    expect(connected).toMatchObject({ success: true, id: 'twin-a', connection: 'Sam Lee reports to Lee Park' });
    expect((await stored('twin-a')).connections).toEqual([{ targetId: 'lee', label: 'reports to' }]);
    expect((await run('connect_identities', { fromName: 'Lee Park', phrase: 'works at', toName: 'Dana Okafor' })).error).toMatch(/not one/);
    // A name in another investigation is not found from here.
    expect((await run('connect_identities', { fromName: 'Lee Park', phrase: 'paid', toName: 'Private Person' })).error).toMatch(/No identity named/);
  });

  it('needs an investigation to create in, and tags what an agent creates', async () => {
    const orphan = call('create_identity', { name: 'Nobody' });
    const { result } = await executeTool(orphan, undefined, undefined, { surface: 'chat-yolo', allowedTools: ALL_STATIC_TOOLS });
    expect(JSON.parse(result).error).toMatch(/Open an investigation/);
     const byAgent = JSON.parse(await executeCreateIdentity({ name: 'Agent Found' }, 'S', 'agent:ap-timeline-builder'));
    expect((await db.identities.get(byAgent.id))).toMatchObject({ createdBy: 'agent:ap-timeline-builder', tags: ['ai-generated'] });
  });
});

describe('who may use them', () => {
  it('never auto-approves an agent\'s identity write, whatever the policy', async () => {
    const open = { ...DEFAULT_AGENT_POLICY, autoApproveCreate: true, autoApproveModify: true, autoApproveReads: true };
    for (const name of ['create_identity', 'update_identity', 'connect_identities']) {
      expect(shouldAutoApprove(name, open)).toBe(false);
      const reach = await classifyToolCall(call(name, { id: 'dana', name: 'X', phrase: 'paid', fromId: 'dana', toId: 'lee' }), { homeFolderId: 'S', settings: {} as never });
      expect(decideToolCall(reach, { surface: 'agent', policy: open })).toEqual({ kind: 'ask', reason: 'policy' });
    }
    expect(shouldAutoApprove('search_identities', open)).toBe(true);
  });

  it('treats reading or changing an identity in another investigation like any other entity', async () => {
    const read = await classifyToolCall(call('read_identity', { id: 'elsewhere' }), { homeFolderId: 'S', settings: {} as never });
    expect(read.crossRead).toBe(true);
    const write = await classifyToolCall(call('update_identity', { id: 'elsewhere' }), { homeFolderId: 'S', settings: {} as never });
    expect(write.crossWrite).toBe(true);
    expect(decideToolCall(write, { surface: 'agent', policy: DEFAULT_AGENT_POLICY })).toMatchObject({ kind: 'deny' });
  });

  it('keeps identity tools off the agent bridge, and gives stakeholders names and statuses only', () => {
    for (const name of IDENTITY_TOOLS) expect(BRIDGE_TOOLS.has(name)).toBe(false);
    const toolsOf = (id: string) => buildAgentToolset({
      profile: BUILTIN_AGENT_PROFILES.find(profile => profile.id === id), baseTools: TOOL_DEFINITIONS, delegationTools: DELEGATION_TOOL_DEFINITIONS,
      executiveTools: EXECUTIVE_TOOL_DEFINITIONS, hostTools: [], getActionClass: getToolActionClass, homeShareable: true,
    }).effectiveAllowedTools;
    for (const id of ['ap-legal-counsel', 'ap-compliance-officer', 'ap-comms-lead']) {
      expect([...toolsOf(id)].filter(name => IDENTITY_TOOLS.has(name))).toEqual(['search_identities']);
    }
    expect([...toolsOf('ap-timeline-builder')].filter(name => IDENTITY_TOOLS.has(name)).sort()).toEqual([...IDENTITY_TOOLS].sort());
    expect([...toolsOf('ap-business-continuity')].filter(name => IDENTITY_TOOLS.has(name))).toEqual([]);
  });

  it('runs identity reads in Plan mode and refuses its writes', async () => {
    const plan = (name: string) => classifyToolCall(call(name, { id: 'dana' }), { homeFolderId: 'S', settings: {} as never })
      .then(reach => decideToolCall(reach, { surface: 'chat-plan' }));
    expect(await plan('read_identity')).toEqual({ kind: 'run' });
    expect(await plan('update_identity')).toMatchObject({ kind: 'deny' });
  });
});

describe('chat links to identities', () => {
  it('turns [identity:ID:Name] into a link, and lists identities read by tools as sources', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const { ChatMessageBubble } = await import('../components/Chat/ChatMessage');
    const onEntityClick = vi.fn();
    const toolCalls = [{ id: 't1', name: 'search_identities', input: {}, result: JSON.stringify({ count: 1, identities: [{ id: 'lee', name: 'Lee Park' }] }), isError: false }];
    const { container } = render(<ChatMessageBubble role="assistant" content="Dana is [identity:dana:Dana Okafor]." toolCalls={toolCalls} onEntityClick={onEntityClick} />);
    const link = container.querySelector('[data-entity-type="identity"]') as HTMLElement;
    expect(link.getAttribute('data-entity-id')).toBe('dana');
    expect(link.textContent).toContain('Dana Okafor');
    fireEvent.click(link);
    expect(onEntityClick).toHaveBeenCalledWith('identity', 'dana');
    fireEvent.click(screen.getByRole('button', { name: /Lee Park/ }));
    expect(onEntityClick).toHaveBeenLastCalledWith('identity', 'lee');
  });
});

