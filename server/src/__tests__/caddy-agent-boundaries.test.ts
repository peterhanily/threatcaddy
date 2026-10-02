import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][], writes: [] as Array<{ kind: string; values: Record<string, unknown> }>,
  access: vi.fn(), unload: vi.fn(), execute: vi.fn(), locks: vi.fn(),
}));
vi.mock('../middleware/auth.js', () => ({ requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => { c.set('user', { id: 'owner-a' }); await next(); } }));
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: mocks.access }));
vi.mock('../bots/bot-manager.js', () => ({ botManager: { unloadBot: mocks.unload, executeBot: mocks.execute } }));
vi.mock('../db/index.js', () => {
  const database = {
    select: vi.fn(() => {
      const rows = mocks.selectResults.shift() ?? [];
      const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => Promise.resolve(rows), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    }),
    execute: mocks.locks,
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>) => { mocks.writes.push({ kind: 'insert', values }); } })),
    update: vi.fn(() => ({ set: (values: Record<string, unknown>) => ({ where: async () => { mocks.writes.push({ kind: 'update', values }); } }) })),
    delete: vi.fn(() => ({ where: async () => { mocks.writes.push({ kind: 'delete', values: {} }); } })),
    transaction: async (callback: (tx: unknown) => unknown): Promise<unknown> => callback(database),
  };
  return { db: database };
});

import caddyAgents from '../routes/caddy-agents.js';
import { HANDOFF_UNAVAILABLE } from '../bots/handoff-policy.js';
const app = new Hono().route('/agents', caddyAgents);
const request = (path: string, body: unknown) => app.request(`/agents/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const deployment = (id = 'deployment-a') => ({ deploymentId: id, order: 0, profile: { id: 'profile-a', name: 'Synthetic analyst', role: 'observer', systemPrompt: 'Synthetic test', allowedTools: ['read_note'], readOnlyEntityTypes: ['note'], policy: { autoApproveReads: false, intervalMinutes: 5 } }, policyOverrides: { autoApproveCreate: false } });
const stored = (overrides = {}) => ({ id: 'bot-a', sourceDeploymentId: 'deployment-a', sourceType: 'caddy-agent', createdBy: 'owner-a', userId: 'owner-a', scopeType: 'investigation', scopeFolderIds: ['folder-a'], config: {}, ...overrides });

beforeEach(() => { mocks.selectResults.length = 0; mocks.writes.length = 0; vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.unload.mockResolvedValue(undefined); });

describe('deployment ownership and unsupported handoff containment', () => {
  it('denies another creator before any mutation even when the incoming folder is accessible', async () => {
    mocks.selectResults.push([stored({ createdBy: 'owner-b', userId: 'owner-b' })]);
    const response = await request('register', { investigationId: 'folder-a', deployments: [deployment()] });
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
    expect(mocks.unload).not.toHaveBeenCalled();
  });

  it('checks old investigation access before moving an existing deployment', async () => {
    mocks.access.mockImplementation(async (_user, folder) => folder !== 'old-private-folder');
    mocks.selectResults.push([stored({ scopeFolderIds: ['old-private-folder'] })]);
    const response = await request('register', { investigationId: 'folder-a', deployments: [deployment()] });
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });

  it('validates the entire batch before changing an earlier authorized deployment', async () => {
    mocks.selectResults.push([stored()], [stored({ id: 'bot-b', createdBy: 'owner-b' })]);
    const response = await request('register', { investigationId: 'folder-a', deployments: [deployment(), deployment('deployment-b')] });
    expect(response.status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });

  it('refuses duplicate input or ambiguous stored deployment identities', async () => {
    expect((await request('register', { investigationId: 'folder-a', deployments: [deployment(), deployment()] })).status).toBe(400);
    mocks.selectResults.push([stored(), stored({ id: 'duplicate' })]);
    expect((await request('register', { investigationId: 'folder-a', deployments: [deployment()] })).status).toBe(409);
    expect(mocks.writes).toEqual([]);
  });

  it('preserves restrictive policy overrides only as disabled metadata and unloads previous runtime state', async () => {
    mocks.selectResults.push([stored()]);
    const response = await request('register', { investigationId: 'folder-a', deployments: [deployment()] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ serverExecutionAvailable: false });
    expect(mocks.locks).toHaveBeenCalledOnce();
    expect(mocks.writes[0].values).toMatchObject({ enabled: false, capabilities: [], config: { allowedTools: ['read_note'], readOnlyEntityTypes: ['note'], agentPolicy: { autoApproveReads: false, autoApproveCreate: false } } });
    expect(mocks.unload).toHaveBeenCalledWith('bot-a');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not advertise or start execution through heartbeat or manual trigger', async () => {
    const heartbeat = await request('heartbeat', { investigationId: 'folder-a' });
    expect(heartbeat.status).toBe(503);
    expect(await heartbeat.json()).toEqual({ error: HANDOFF_UNAVAILABLE, serverExecutionAvailable: false });
    const response = await request('trigger/folder-a', { context: 'synthetic' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: HANDOFF_UNAVAILABLE, triggered: 0, serverExecutionAvailable: false });
    expect(mocks.writes).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports a persisted deployment and stale heartbeat without claiming a running server agent', async () => {
    mocks.selectResults.push([stored()], [{ lastBeat: new Date(0), serverTakeoverAt: new Date(0) }]);
    const response = await app.request('/agents/status/folder-a');
    expect(await response.json()).toMatchObject({ registered: true, serverRunning: false,
      serverExecutionAvailable: false, reason: HANDOFF_UNAVAILABLE, heartbeatStale: true });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('denies unregistering another creator deployment without deleting or unloading it', async () => {
    mocks.selectResults.push([stored({ createdBy: 'owner-b' })], [stored({ createdBy: 'owner-b' })]);
    expect((await request('unregister', { deploymentIds: ['deployment-a'] })).status).toBe(403);
    expect(mocks.writes).toEqual([]);
    expect(mocks.unload).not.toHaveBeenCalled();
  });
});
