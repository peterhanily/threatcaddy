/** A-BRIDGE-1 through the real dispatcher: the bridge only works inside the selected investigation. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { installAgentBridge, syncBridgeFolderId } from '../lib/agent-bridge';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { AGENT_NEVER_TOOLS, EXPLICIT_ONLY_TOOLS, isEgressToolName } from '../lib/caddy-agent-policy';
import { canary, ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';

vi.mock('../lib/workspace-initialization', () => ({ isWorkspaceInitialized: () => true }));

type Bridge = { exec(nonce: string, name: string, input: Record<string, unknown>): Promise<string>; tools(): string[]; setFolderId(nonce: string, id: string): void; investigations(nonce: string): Promise<string> };
const bridge = () => (window as unknown as { threatcaddy: Bridge }).threatcaddy;

let egress: EgressSpy;
let nonce: string;
beforeEach(async () => {
  await seedAIWorkspace();
  egress = installEgressSpy();
  localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ agentBridgeEnabled: true }));
  nonce = installAgentBridge();
  syncBridgeFolderId('S');
});
afterEach(() => { egress.restore(); localStorage.clear(); });

describe('A-BRIDGE-1 with the bridge on and the shared investigation selected', () => {
  it('lists no agent lifecycle, cross-case, SIEM or ticket tools', () => {
    const tools = bridge().tools();
    expect(tools).toContain('create_note');
    for (const name of [...AGENT_NEVER_TOOLS, ...EXPLICIT_ONLY_TOOLS]) expect(tools).not.toContain(name);
  });

  it('lists no tool that reaches the network, since the bridge refuses every one', () => {
    const tools = bridge().tools();
    expect(tools.filter(isEgressToolName)).toEqual([]);
    expect(tools).not.toContain('fetch_url');
    expect(tools).not.toContain('enrich_ioc');
  });

  it('the Claude Code skill documents exactly the tools the bridge lists', () => {
    const skill = readFileSync(join(process.cwd(), 'agents', 'claude-code', 'SKILL.md'), 'utf8');
    const documented = [...skill.matchAll(/^- \*\*([a-z_]+)\*\*/gm)].map(match => match[1]);
    expect([...documented].sort()).toEqual([...bridge().tools()].sort());
    expect(skill).toContain(`## Available Tools (${bridge().tools().length})`);
  });

  it('refuses web fetch and cross-investigation search', async () => {
    await expect(bridge().exec(nonce, 'fetch_url', { url: 'https://collector.example/' })).rejects.toThrow();
    await expect(bridge().exec(nonce, 'search_across_investigations', { query: 'CANARY' })).rejects.toThrow();
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('does not allow agent lifecycle tools or writes into other investigations', async () => {
    await expect(bridge().exec(nonce, 'spawn_agent', { profileName: 'Threat Hunter', reason: 'x' })).rejects.toThrow('not allowed');
    await expect(bridge().exec(nonce, 'create_in_investigation', { investigationId: 'P', entityType: 'note', data: { title: 'x' } })).rejects.toThrow('not allowed');
    await expect(bridge().exec(nonce, 'update_note', { id: ids('P').note, content: 'x' })).rejects.toThrow();
    expect((await db.notes.get(ids('P').note))?.content).toContain(canary('P'));
    expect(await db.agentDeployments.count()).toBe(0);
  });

  it('cannot see local-only investigations', async () => {
    await expect(bridge().exec(nonce, 'read_note', { id: ids('L').note })).rejects.toThrow(/not found/i);
    await expect(bridge().exec(nonce, 'read_note', { id: [ids('L').note] })).rejects.toThrow(/not found/i);
    const listed = JSON.parse(await bridge().investigations(nonce)) as Array<{ id: string }>;
    expect(listed.map(folder => folder.id).sort()).toEqual(['P', 'S']);
  });

  it('hides local-only investigations while a team investigation with no local row is selected (remote mode)', async () => {
    syncBridgeFolderId('team-remote');
    const listed = JSON.parse(await bridge().investigations(nonce)) as Array<{ id: string; name: string }>;
    expect(listed.map(folder => folder.id).sort()).toEqual(['P', 'S']);
    expect(JSON.stringify(listed)).not.toMatch(/Local case|Hunting case/);
  });

  it('lists every investigation from a local-only one, and none while the bridge is off', async () => {
    syncBridgeFolderId('L2');
    const listed = JSON.parse(await bridge().investigations(nonce)) as Array<{ id: string }>;
    expect(listed.map(folder => folder.id).sort()).toEqual(['L', 'L2', 'P', 'S']);
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ agentBridgeEnabled: false }));
    await expect(bridge().investigations(nonce)).rejects.toThrow('Turn on the agent bridge');
  });

  it('runs in-scope work and cannot be re-scoped', async () => {
    const result = JSON.parse(await bridge().exec(nonce, 'create_note', { title: 'Bridge note', content: 'From the bridge' }));
    expect((await db.notes.get(result.id))?.folderId).toBe('S');
    expect(() => bridge().setFolderId(nonce, 'L')).toThrow('follows the investigation selected');
  });

  it('reads the caller\'s input once, so an id that changes after the check reaches no other investigation', async () => {
    /** An id that is in scope on its first read and another investigation's row afterwards. */
    const swapping = (first: string, then: string) => { let reads = 0; return { get id() { return reads++ === 0 ? first : then; } }; };
    const read = await bridge().exec(nonce, 'read_note', swapping(ids('S').note, ids('L').note));
    expect(read).not.toContain(canary('L'));
    expect(read).toContain(canary('S'));
    await bridge().exec(nonce, 'update_note', Object.assign(swapping(ids('S').note, ids('P').note), { content: 'Overwritten from the bridge' }));
    expect((await db.notes.get(ids('P').note))?.content).toContain(canary('P'));
    expect((await db.notes.get(ids('S').note))?.content).toBe('Overwritten from the bridge');
  });

  it('refuses input that is not plain JSON', async () => {
    const cyclic: Record<string, unknown> = { title: 'Cyclic' };
    cyclic.self = cyclic;
    await expect(bridge().exec(nonce, 'create_note', cyclic)).rejects.toThrow('plain JSON');
    await expect(bridge().exec(nonce, 'create_note', { title: 'Big', size: BigInt(1) })).rejects.toThrow('plain JSON');
    expect(await db.notes.filter(note => ['Cyclic', 'Big'].includes(note.title)).count()).toBe(0);
  });

  it('cannot change an escalated task, as agents cannot', async () => {
    await db.tasks.update(ids('S').task, { escalated: true, rejectionCount: 3 });
    await expect(bridge().exec(nonce, 'update_task', { id: ids('S').task, status: 'done' })).rejects.toThrow(/escalated to a human/);
    expect(await db.tasks.get(ids('S').task)).toMatchObject({ status: 'todo', escalated: true });
  });

  it('marks what it creates as AI-made, for the operator', async () => {
    const note = JSON.parse(await bridge().exec(nonce, 'create_note', { title: 'Bridge note' }));
    const folder = JSON.parse(await bridge().exec(nonce, 'create_note_folder', { name: 'Bridge folder' }));
    for (const id of [note.id, folder.folderId]) {
      expect(await db.notes.get(id)).toMatchObject({ createdBy: 'agent:🔌 Agent bridge (Analyst)', tags: expect.arrayContaining(['ai-generated']) });
    }
  });
});
