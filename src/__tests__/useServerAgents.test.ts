import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '../db';
import type { AgentDeployment } from '../types';
import { validatePortableRow } from '../lib/backup-records';

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
    expect(result.current.serverExecutionAvailable).toBe(false);
    // The server's English reason is not an error; the panel names the paused deployment in the analyst's language.
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.pausedDeploymentIds).toEqual(['server-owned']));
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

  it('the routine status check of a 2.0.x server pauses nothing and reports no error', async () => {
    const deployments = [deployment('browser-only', { serverSideEnabled: false, handoffState: 'client', status: 'idle' })];
    await db.agentDeployments.bulkAdd(deployments);
    // What every 2.0.x server answers to GET /status/:investigationId.
    const fetch = vi.fn().mockImplementation(() => new Response(JSON.stringify({ registered: false, serverRunning: false, serverExecutionAvailable: false,
      reason: 'Server-side AgentCaddy execution is unavailable until tool restrictions, read-only policies and durable approvals are enforced.',
      heartbeatStale: false, botCount: 0, lastHeartbeat: null }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useServerAgents({ investigationId: 'case-one', deployments, profiles: [], enabled: false }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current).toMatchObject({ serverExecutionAvailable: false, error: null, pausedDeploymentIds: [] });
    expect(await db.agentDeployments.get('browser-only')).toEqual(deployments[0]);
  });

  it('only a server that reports execution available offers server-side mode', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => json({ registered: false, serverRunning: false, serverExecutionAvailable: true })));
    const { result } = renderHook(() => useServerAgents({ investigationId: 'case-one', deployments: [], profiles: [], enabled: false }));
    await waitFor(() => expect(result.current.serverExecutionAvailable).toBe(true));
    // A server that does not say so is not assumed to run agents.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => json({ registered: true, serverRunning: false })));
    const silent = renderHook(() => useServerAgents({ investigationId: 'case-two', deployments: [], profiles: [], enabled: false }));
    await waitFor(() => expect(silent.result.current.serverRegistered).toBe(true));
    expect(silent.result.current.serverExecutionAvailable).toBe(false);
  });
});

describe('server action reconciliation (compatible servers)', () => {
  it('stores nullable server action columns as absent fields so backups stay valid', async () => {
    await db.agentActions.clear();
    const deployments = [deployment('server-owned')];
    await db.agentDeployments.bulkAdd(deployments);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('/status/') ? json({ registered: true, serverRunning: false })
      : url.includes('/heartbeat') ? json({ serverWasRunning: true })
      : url.includes('/actions/') ? json({ actions: [{ id: 'server-action', investigationId: 'case-one', threadId: null, botConfigId: null, toolName: 'create_note',
        toolInput: { title: 'Draft' }, rationale: 'Server cycle', status: 'executed', resultSummary: null, severity: null,
        createdAt: '2026-11-01T00:00:00.000Z', executedAt: null, reviewedAt: null }] })
      : json({})));
    renderHook(() => useServerAgents({ investigationId: 'case-one', deployments, profiles: [], enabled: true }));
    await waitFor(async () => expect(await db.agentActions.get('srv:server-action')).toBeDefined());
    const stored = await db.agentActions.get('srv:server-action');
    expect(() => validatePortableRow('agentActions', stored)).not.toThrow();
    expect(stored).toMatchObject({ threadId: '', status: 'executed' });
  });

  it('B-SRV-1 stores server rows as terminal history under the requested investigation', async () => {
    await db.agentActions.clear();
    mocks.reclaim.mockResolvedValue(undefined); mocks.reconcile.mockResolvedValue(undefined);
    const deployments = [deployment('server-owned')];
    await db.agentDeployments.bulkAdd(deployments);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    const row =(id: string, values: Record<string, unknown>) => ({ id, investigationId: 'case-one', threadId: null, botConfigId: null, toolName: 'create_note',
      toolInput: {}, rationale: 'Server cycle', status: 'executed', resultSummary: null, severity: null, createdAt: '2026-11-01T00:00:00.000Z', executedAt: null, reviewedAt: null, ...values });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('/status/') ? json({ registered: true, serverRunning: false })
      : url.includes('/heartbeat') ? json({ serverWasRunning: true })
      : url.includes('/actions/') ? json({ actions: [
        row('proposal', { status: 'pending', investigationId: 'other', toolName: 'fetch_url', toolInput: { url: 'https://collector.example/' } }),
        row('dynamic', { toolName: 'host:remote:run' }),
        row('undated', { createdAt: 'not a date' }),
        row('done', { status: 'failed', investigationId: 'other' }),
      ] })
      : json({})));
    renderHook(() => useServerAgents({ investigationId: 'case-one', deployments, profiles: [], enabled: true }));
    await waitFor(async () => expect(await db.agentActions.get('srv:done')).toBeDefined());
    expect(await db.agentActions.get('srv:proposal')).toMatchObject({ investigationId: 'case-one', toolName: 'fetch_url', status: 'rejected', resultSummary: 'Server proposal not imported' });
    expect(await db.agentActions.get('srv:done')).toMatchObject({ investigationId: 'case-one', status: 'failed' });
    expect((await db.agentActions.toArray()).map(action => action.id).sort()).toEqual(['srv:done', 'srv:proposal']);
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith('server-owned', { serverActionIds: ['srv:proposal', 'srv:done'] }));
  });
});
