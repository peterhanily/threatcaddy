import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentDeployment, type AgentProfile, type Folder } from '../types';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { buildFullBackupPayload } from '../lib/backup-data';

const router = vi.hoisted(() => ({ usage: undefined as unknown }));
vi.mock('../lib/llm-router', () => ({
  hasServerSession: () => true,
  resolveRoute: () => ({ route: 'server' }),
  sendViaServer: (_request: unknown, callbacks: { onChunk: (text: string) => void; onDone: (reason: string, blocks: unknown[], usage?: unknown) => void }) => {
    callbacks.onChunk('Reviewed the case.');
    callbacks.onDone('end_turn', [{ type: 'text', text: 'Reviewed the case.' }], router.usage);
  },
  sendViaExtension: vi.fn(),
  sendDirectToLocal: vi.fn(),
}));
vi.mock('../lib/llm-tools', () => ({ executeTool: vi.fn(), buildSystemPrompt: async () => 'Synthetic context' }));

const investigation: Folder = { id: 'case', name: 'Synthetic case', order: 0, createdAt: 1, status: 'active' };
const settings = { ...DEFAULT_SETTINGS, serverUrl: 'https://team.example' };
const profile: AgentProfile = { id: 'profile', name: 'Analyst', role: 'specialist', systemPrompt: 'Review notes.', policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 };
const deployment: AgentDeployment = { id: 'deployment', investigationId: investigation.id, profileId: profile.id, status: 'idle', order: 0, createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  await db.folders.add(investigation);
  await db.agentProfiles.add(profile);
});

describe('agent token usage accounting', () => {
  it('stores finite counters for malformed usage and for poisoned previous metrics, so backups still succeed', async () => {
    await db.agentDeployments.add({ ...deployment, metrics: {
      cyclesRun: 1, toolCallsExecuted: 0, toolCallsProposed: 0, tasksCompleted: 0, tasksRejected: 0,
      tokensUsed: { input: NaN, output: NaN }, lastCycleAt: 1, costUSD: NaN,
    } });
    router.usage = { input: undefined, output: 'many' };
    const result = await runMultiAgentCycle(investigation, settings, false);
    expect(result.errors).toEqual([]);
    const metrics = (await db.agentDeployments.get('deployment'))?.metrics;
    expect(metrics?.tokensUsed).toEqual({ input: 0, output: 0 });
    expect(Number.isFinite(metrics?.costUSD)).toBe(true);
    const thread = (await db.chatThreads.where('folderId').equals('case').toArray())[0];
    const summary = thread.messages.find(message => message.agentCycleSummary)?.agentCycleSummary;
    expect(summary?.tokens).toEqual({ input: 0, output: 0 });
    expect(Number.isFinite(summary?.costUSD)).toBe(true);
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
  });

  it('accumulates valid usage', async () => {
    await db.agentDeployments.add(deployment);
    router.usage = { input: 10, output: 4 };
    await runMultiAgentCycle(investigation, settings, false);
    expect((await db.agentDeployments.get('deployment'))?.metrics?.tokensUsed).toEqual({ input: 10, output: 4 });
  });
});
