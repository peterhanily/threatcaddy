import { waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_SETTINGS, DEFAULT_AGENT_POLICY, type AgentDeployment, type AgentProfile, type Folder } from '../types';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { runSupervisorCycle } from '../lib/caddy-agent-supervisor';
import * as supervisorPolicy from '../lib/supervisor-tool-policy';
import * as approval from '../lib/agent-action-approval';

const mocks = vi.hoisted(() => ({ run: vi.fn(), route: vi.fn(), execute: vi.fn() }));
vi.mock('../lib/caddy-agent', () => ({ runAgentCycle: mocks.run, parseToolCallsFromText: () => [] }));
vi.mock('../lib/llm-tools', () => ({ executeTool: mocks.execute, buildSystemPrompt: async () => 'Synthetic investigation context' }));
vi.mock('../lib/llm-router', () => ({ resolveRoutingMode: () => 'extension', sendViaExtension: mocks.route, sendViaServer: mocks.route }));

const investigation: Folder = { id: 'case', name: 'Synthetic case', order: 0, createdAt: 1, status: 'active' };
const settings = { ...DEFAULT_SETTINGS, llmDefaultProvider: 'local' as const, llmLocalEndpoint: 'http://localhost:11434', agentSupervisorEnabled: true };
const outcome = { autoExecuted: [], proposed: [], threadId: 'audit' };
const profile: AgentProfile = { id: 'profile', name: 'Synthetic summary', role: 'specialist', systemPrompt: 'Summarize permitted local notes.', policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 };
const deployment = (id: string, order: number): AgentDeployment => ({ id, investigationId: investigation.id, profileId: profile.id, status: 'idle', order, createdAt: 1, updatedAt: 1 });
beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([db.folders.clear(), db.agentDeployments.clear(), db.agentProfiles.clear(), db.chatThreads.clear(), db.agentActions.clear(), db.notes.clear()]);
  mocks.run.mockResolvedValue(outcome);
  mocks.execute.mockResolvedValue({ result: '[]', isError: false });
});
afterEach(() => vi.restoreAllMocks());

describe('existing runner cancellation contracts', () => {
  it('rejects already-cancelled runners without creating any audit or deployment state', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runMultiAgentCycle(investigation, settings, false, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runSupervisorCycle(settings, false, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(await db.folders.count()).toBe(0);
    expect(await db.chatThreads.count()).toBe(0);
  });

  it('forwards cancellation to a deployed agent and never starts a later serial chunk', async () => {
    await db.agentProfiles.add(profile);
    await db.agentDeployments.bulkAdd([deployment('first', 0), deployment('second', 1)]);
    const controller = new AbortController();
    mocks.run.mockImplementationOnce(async (...args: unknown[]) => {
      const signal = args[7] as AbortSignal;
      expect(signal.aborted).toBe(false);
      controller.abort();
      expect(signal.aborted).toBe(true);
      return outcome;
    });
    await expect(runMultiAgentCycle(investigation, settings, false, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect((await db.agentDeployments.get('first'))?.status).toBe('idle');
    expect((await db.agentDeployments.get('first'))?.metrics).toBeUndefined();
    expect((await db.agentDeployments.get('second'))?.status).toBe('idle');
    expect((await db.agentDeployments.get('second'))?.lastRunAt).toBeUndefined();
  });

  it('preserves a newer pause while settling a cancelled attempt', async () => {
    await db.agentProfiles.add(profile); await db.agentDeployments.add(deployment('first', 0));
    const controller = new AbortController();
    mocks.run.mockImplementationOnce(async () => {
      await db.agentDeployments.update('first', { status: 'paused' });
      controller.abort();
      throw new DOMException('Cancelled', 'AbortError');
    });
    await expect(runMultiAgentCycle(investigation, settings, false, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await db.agentDeployments.get('first'))?.status).toBe('paused');
  });

  it('retains normal completion and metrics for a permitted, uncancelled cycle', async () => {
    await db.agentProfiles.add(profile); await db.agentDeployments.add(deployment('first', 0));
    const result = await runMultiAgentCycle(investigation, settings, false);
    expect(result.errors).toEqual([]);
    expect(result.deploymentResults.has('first')).toBe(true);
    expect((await db.agentDeployments.get('first'))?.metrics?.cyclesRun).toBe(1);
  });

  it('aborts the supervisor provider request and ignores late completion without tools or audit content', async () => {
    await db.folders.bulkAdd([investigation, { ...investigation, id: 'other', name: 'Other synthetic case' }]);
    const controller = new AbortController();
    const result = runSupervisorCycle(settings, true, undefined, controller.signal);
    await waitFor(() => expect(mocks.route).toHaveBeenCalledOnce());
    const callbacks = mocks.route.mock.calls[0][1] as { onChunk: (text: string) => void; onDone: (reason: string, blocks: unknown[]) => void };
    const providerSignal = mocks.route.mock.calls[0][2] as AbortSignal;
    controller.abort();
    expect(providerSignal.aborted).toBe(true);
    callbacks.onChunk('Late synthetic summary');
    callbacks.onDone('end_turn', []);
    expect((await result).error).toMatch(/cancelled/);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect((await db.chatThreads.toArray()).every(thread => thread.messages.length === 0)).toBe(true);
  });

  it('rolls back a new supervisor audit thread and folder attachment together on cancellation', async () => {
    await db.folders.bulkAdd([investigation, { ...investigation, id: 'other', name: 'Other synthetic case' }]);
    const controller = new AbortController();
    const cancelCreation = () => { controller.abort(); };
    db.chatThreads.hook('creating', cancelCreation);
    try {
      await expect(runSupervisorCycle(settings, true, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      db.chatThreads.hook('creating').unsubscribe(cancelCreation);
    }
    expect(await db.chatThreads.count()).toBe(0);
    const supervisor = await db.folders.filter(folder => folder.name === 'CaddyAgent Supervisor').first();
    expect(supervisor?.agentThreadId).toBeUndefined();
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it('does not queue a proposal when cancellation occurs during its policy check', async () => {
    await db.folders.bulkAdd([investigation, { ...investigation, id: 'other', name: 'Other synthetic case' }]);
    const controller = new AbortController();
    vi.spyOn(supervisorPolicy, 'getSupervisorToolPermission').mockImplementationOnce(async () => {
      controller.abort();
      return { kind: 'approval-required', investigationId: investigation.id };
    });
    mocks.route.mockImplementationOnce((_request, callbacks) => {
      callbacks.onDone('tool_use', [{ type: 'tool_use', id: 'summary', name: 'create_note', input: { title: 'Synthetic summary', content: 'For analyst review.' } }]);
      return 'request';
    });
    const result = await runSupervisorCycle(settings, true, undefined, controller.signal);
    expect(result.error).toBeTruthy();
    expect(await db.agentActions.count()).toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rolls back a proposal if cancellation occurs before its queue transaction commits', async () => {
    await db.folders.bulkAdd([investigation, { ...investigation, id: 'other', name: 'Other synthetic case' }]);
    const controller = new AbortController();
    vi.spyOn(supervisorPolicy, 'getSupervisorToolPermission').mockResolvedValueOnce({ kind: 'approval-required', investigationId: investigation.id });
    const originalQueue = approval.queueAgentAction;
    vi.spyOn(approval, 'queueAgentAction').mockImplementationOnce(async proposal => {
      const queued = await originalQueue(proposal);
      controller.abort();
      return queued;
    });
    mocks.route.mockImplementationOnce((_request, callbacks) => {
      callbacks.onDone('tool_use', [{ type: 'tool_use', id: 'summary', name: 'create_note', input: { title: 'Synthetic summary', content: 'For analyst review.' } }]);
      return 'request';
    });
    const result = await runSupervisorCycle(settings, true, undefined, controller.signal);
    expect(result.error).toBeTruthy();
    expect(await db.agentActions.count()).toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
