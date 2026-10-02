import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import type { AgentDeployment } from '../types';

const mocks = vi.hoisted(() => ({ token: vi.fn(), recover: vi.fn(), handoff: vi.fn(), reclaim: vi.fn(), reconcile: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: 'https://team.example.invalid', getAccessToken: mocks.token }) }));
vi.mock('../lib/agent-handoff', () => ({
  markClientRecovered: mocks.recover, markHandoffPending: mocks.handoff,
  markReclaimPending: mocks.reclaim, reconcileAfterHandoff: mocks.reconcile,
}));
import { useServerAgents } from '../hooks/useServerAgents';

const deployment = (id: string, values: Partial<AgentDeployment> = {}): AgentDeployment => ({
  id, investigationId: 'case-one', profileId: 'profile-one', status: 'running',
  order: 0, createdAt: 1, updatedAt: 1, serverSideEnabled: true, handoffState: 'server',
  ...values,
} as AgentDeployment);
const unavailable = () => new Response(JSON.stringify({ serverExecutionAvailable: false, reason: 'Server execution is unavailable.' }),
  { status: 503, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue('fixture-token');
  await db.agentDeployments.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('unavailable server agent execution', () => {
  it('pauses server-owned work without reclaiming it and leaves browser-only work unchanged', async () => {
    const deployments = [deployment('server-owned'), deployment('browser-only', { serverSideEnabled: false, handoffState: 'client' }),
      deployment('already-paused', { serverSideEnabled: false, status: 'paused' })];
    await db.agentDeployments.bulkAdd(deployments);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(unavailable));
    const update = vi.spyOn(db.agentDeployments, 'update');
    const { result } = renderHook(() => useServerAgents({ investigationId: 'case-one', deployments, profiles: [], enabled: true }));
    await waitFor(async () => expect((await db.agentDeployments.get('server-owned'))?.status).toBe('paused'));
    expect(result.current.serverRegistered).toBe(false);
    expect(result.current.serverRunning).toBe(false);
    expect(result.current.error).toBe('Server execution is unavailable.');
    expect(await db.agentDeployments.get('server-owned')).toMatchObject({ handoffState: 'server', serverSideEnabled: false });
    expect(await db.agentDeployments.get('browser-only')).toEqual(deployments[1]);
    expect(await db.agentDeployments.get('already-paused')).toEqual(deployments[2]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('does not repeat writes or status requests when deployment props refresh, even with a stale registration closure', async () => {
    const deployments = [deployment('server-owned')];
    await db.agentDeployments.bulkAdd(deployments);
    const fetch = vi.fn().mockImplementation(unavailable);
    vi.stubGlobal('fetch', fetch);
    const update = vi.spyOn(db.agentDeployments, 'update');
    const { result, rerender } = renderHook(({ rows }) => useServerAgents({ investigationId: 'case-one', deployments: rows, profiles: [], enabled: true }),
      { initialProps: { rows: deployments } });
    const staleRegister = result.current.registerServerAgents;
    await waitFor(async () => expect((await db.agentDeployments.get('server-owned'))?.status).toBe('paused'));
    const paused = await db.agentDeployments.toArray();
    await act(async () => { rerender({ rows: paused }); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await staleRegister(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(await db.agentDeployments.toArray()).toEqual(paused);
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('stops the heartbeat on an explicit unavailable response without entering failure-based handoff', async () => {
    const deployments = [deployment('server-owned')];
    await db.agentDeployments.bulkAdd(deployments);
    const fetch = vi.fn().mockImplementation((url: string) => url.includes('/status/')
      ? new Response(JSON.stringify({ registered: true, serverRunning: true }), { headers: { 'Content-Type': 'application/json' } })
      : unavailable());
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useServerAgents({ investigationId: 'case-one', deployments, profiles: [], enabled: true }));
    await waitFor(async () => expect((await db.agentDeployments.get('server-owned'))?.status).toBe('paused'));
    expect(result.current.serverRegistered).toBe(false);
    expect(result.current.serverRunning).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/heartbeat'))).toHaveLength(1);
    expect(mocks.handoff).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.reclaim).not.toHaveBeenCalled();
  });
});
