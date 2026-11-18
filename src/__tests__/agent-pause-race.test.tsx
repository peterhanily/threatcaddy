/**
 * R6U-4 (SEC-3): useServerAgents pauses an agent that was set to run on the
 * server when a 2.0.x team server answers that it cannot run agents. A pause
 * written while a cycle runs outlasts it: the next cycle does not run the agent,
 * and the notice shows only while the agent is paused.
 */
import { useEffect, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentDeployment, Folder, Settings } from '../types';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { useServerAgents } from '../hooks/useServerAgents';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { runMultiAgentCycle } from '../lib/caddy-agent-manager';
import { seedAIWorkspace } from './helpers/ai-workspace';
import enAgent from '../../public/locales/en/agent.json';

/** The model's reply is held until the test releases it, so a cycle stays running. */
const gate = vi.hoisted(() => ({ pending: [] as Array<() => void>, sends: 0, crash: null as null | Promise<never> }));
vi.mock('../lib/llm-router', async orig => {
  const original = await orig<typeof import('../lib/llm-router')>();
  const send = (_request: unknown, callbacks: { onDone: (reason: string, blocks: unknown[], usage?: unknown) => void }) => {
    gate.sends++;
    gate.pending.push(() => callbacks.onDone('end_turn', [{ type: 'text', text: 'Nothing new.' }], { input: 1, output: 1 }));
    return `held-${gate.sends}`;
  };
  return { ...original, sendViaServer: send, sendViaExtension: send, sendDirectToLocal: send };
});
/** An agent cycle that crashes unexpectedly, held until the test rejects it. */
vi.mock('../lib/caddy-agent', async orig => {
  const original = await orig<typeof import('../lib/caddy-agent')>();
  return { ...original, runAgentCycle: (...args: Parameters<typeof original.runAgentCycle>) => gate.crash ?? original.runAgentCycle(...args) };
});
vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: 'https://team.example.invalid', getAccessToken: async () => 'fixture-token' }) }));

/** A local model: one agent at a time. */
const settings = { llmLocalEndpoint: 'http://localhost:11434', llmLocalModelName: 'fixture-local-model', llmDefaultProvider: 'local' } as Settings;
const UNAVAILABLE = { registered: false, serverRunning: false, serverExecutionAvailable: false, reason: 'unavailable', heartbeatStale: false, botCount: 0, lastHeartbeat: null };
const NOTICE = enAgent['panel.serverAgentsPaused_one'].replace('{{count}}', '1');
const serverCopy: AgentDeployment = { id: 'dep-hunter', investigationId: 'S', profileId: 'ap-threat-hunter', status: 'idle', order: 0,
  createdAt: 1, updatedAt: 1, serverSideEnabled: true, handoffState: 'client' };

let reloadDeployments: () => Promise<void> = async () => {};
/** The agent panel with the props App passes from useServerAgents, and the deployment list as it reloads. */
function Panel({ folder }: { folder: Folder }) {
  const [deployments, setDeployments] = useState<AgentDeployment[]>([]);
  useEffect(() => {
    reloadDeployments = async () => setDeployments(await db.agentDeployments.where('investigationId').equals(folder.id).toArray());
    void reloadDeployments();
  }, [folder.id]);
  const serverAgents = useServerAgents({ investigationId: folder.id, deployments, profiles: BUILTIN_AGENT_PROFILES, enabled: true });
  return (
    <AgentPanel folder={folder} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={deployments} agentError={serverAgents.error}
      serverConnected serverExecutionAvailable={serverAgents.serverExecutionAvailable} serverPausedDeploymentIds={serverAgents.pausedDeploymentIds}
      serverRegistered={serverAgents.serverRegistered} serverRunning={serverAgents.serverRunning} />
  );
}

/** The analyst opens the agent panel: the routine status check gets 2.0.x's answer and pauses the server copy. */
async function openPanelAndPause(folder: Folder) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(UNAVAILABLE), { headers: { 'Content-Type': 'application/json' } })));
  render(<Panel folder={folder} />);
  await waitFor(async () => expect((await db.agentDeployments.get('dep-hunter'))?.status).toBe('paused'));
  await act(async () => { await reloadDeployments(); });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(NOTICE));
}

beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); gate.pending = []; gate.sends = 0; gate.crash = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a pause written while a cycle runs', () => {
  it('outlasts the agent\'s own cycle, which still records its run, and the next cycle does not run it', async () => {
    await db.agentDeployments.add(serverCopy);
    const folder = await db.folders.get('S') as Folder;
    const first = runMultiAgentCycle(folder, settings, false);
    await waitFor(() => expect(gate.sends).toBe(1));
    expect((await db.agentDeployments.get('dep-hunter'))?.status).toBe('running');

    await openPanelAndPause(folder);
    await act(async () => { gate.pending.shift()?.(); await first; });
    const after = await db.agentDeployments.get('dep-hunter');
    expect(after).toMatchObject({ status: 'paused', serverSideEnabled: false, handoffState: 'client' });
    expect(after?.metrics?.cyclesRun).toBe(1);
    expect(after?.lastRunAt).toBeGreaterThan(1);

    const second = await runMultiAgentCycle(folder, settings, false);
    expect(gate.sends).toBe(1);
    expect(second.deploymentResults.size).toBe(0);
    await act(async () => { await reloadDeployments(); });
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);
  });

  it('outlasts a cycle that crashes, which still records when it ran', async () => {
    await db.agentDeployments.add(serverCopy);
    const folder = await db.folders.get('S') as Folder;
    let crash: (error: Error) => void = () => {};
    gate.crash = new Promise<never>((_, reject) => { crash = reject; });
    const first = runMultiAgentCycle(folder, settings, false);
    await waitFor(async () => expect((await db.agentDeployments.get('dep-hunter'))?.status).toBe('running'));

    await openPanelAndPause(folder);
    await act(async () => { crash(new Error('Unexpected agent failure')); await first; });
    const after = await db.agentDeployments.get('dep-hunter');
    expect(after?.status).toBe('paused');
    expect(after?.lastRunAt).toBeGreaterThan(1);
  });

  it('before the agent\'s turn in that cycle keeps it from starting', async () => {
    await db.agentDeployments.bulkAdd([
      { ...serverCopy, id: 'dep-first', profileId: 'ap-malware-analyst', serverSideEnabled: false, order: 0 },
      { ...serverCopy, order: 1 },
    ]);
    const folder = await db.folders.get('S') as Folder;
    const cycle = runMultiAgentCycle(folder, settings, false);
    await waitFor(() => expect(gate.sends).toBe(1));
    expect((await db.agentDeployments.get('dep-hunter'))?.status).toBe('idle');

    await openPanelAndPause(folder);
    let settled = false;
    void cycle.then(() => { settled = true; });
    await act(async () => { gate.pending.shift()?.(); });
    // Either the cycle ends, or it starts the paused agent; then let that run end too.
    await waitFor(() => expect(settled || gate.sends > 1).toBe(true));
    while (gate.pending.length) await act(async () => { gate.pending.shift()?.(); });
    const result = await act(async () => await cycle);
    expect(gate.sends).toBe(1);
    expect([...result.deploymentResults.keys()]).toEqual(['dep-first']);
    expect(result.errors).toEqual([]);
    expect(await db.agentDeployments.get('dep-hunter')).toMatchObject({ status: 'paused' });
    expect(await db.agentDeployments.get('dep-first')).toMatchObject({ status: 'idle' });
  });
});

it('the notice shows only for an agent that is paused now', async () => {
  await db.agentDeployments.add(serverCopy);
  await openPanelAndPause(await db.folders.get('S') as Folder);
  // Something else gives the agent another status, as an older end of cycle did.
  await db.agentDeployments.update('dep-hunter', { status: 'idle' });
  await act(async () => { await reloadDeployments(); });
  expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
});
