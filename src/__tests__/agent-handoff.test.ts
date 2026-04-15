import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db';
import type { AgentDeployment } from '../types';
import {
  markHandoffPending,
  markServerOwned,
  markReclaimPending,
  markClientRecovered,
  reconcileAfterHandoff,
  shouldBlockNewCycle,
} from '../lib/agent-handoff';

function fixture(overrides: Partial<AgentDeployment> = {}): AgentDeployment {
  return {
    id: 'dep-1',
    investigationId: 'inv-1',
    profileId: 'prof-1',
    status: 'idle',
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function seed(d: AgentDeployment) {
  await db.agentDeployments.clear();
  await db.agentDeployments.add(d);
}

describe('agent-handoff state machine', () => {
  beforeEach(async () => {
    await db.agentDeployments.clear();
  });

  it('defaults to implicit client state when unset', () => {
    const d = fixture();
    expect(shouldBlockNewCycle(d)).toBe(false);
  });

  it('blocks new cycles while server owns the deployment', () => {
    expect(shouldBlockNewCycle(fixture({ handoffState: 'server' }))).toBe(true);
    expect(shouldBlockNewCycle(fixture({ handoffState: 'handoff-pending' }))).toBe(true);
    expect(shouldBlockNewCycle(fixture({ handoffState: 'reclaim-pending' }))).toBe(true);
    expect(shouldBlockNewCycle(fixture({ handoffState: 'client' }))).toBe(false);
  });

  it('follows the happy-path transition: client → handoff-pending → server → reclaim-pending → client', async () => {
    await seed(fixture());

    expect(await markHandoffPending('dep-1')).toBe(true);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('handoff-pending');

    expect(await markServerOwned('dep-1')).toBe(true);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('server');

    expect(await markReclaimPending('dep-1')).toBe(true);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('reclaim-pending');

    const result = await reconcileAfterHandoff('dep-1');
    expect(result.ok).toBe(true);
    const d = await db.agentDeployments.get('dep-1');
    expect(d?.handoffState).toBe('client');
    expect(d?.lastReconciledAt).toBeGreaterThan(0);
  });

  it('refuses illegal transitions without mutating state', async () => {
    await seed(fixture({ handoffState: 'client' }));

    // client → server is not allowed (must go through handoff-pending)
    expect(await markServerOwned('dep-1')).toBe(false);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('client');

    // client → reclaim-pending also not allowed
    expect(await markReclaimPending('dep-1')).toBe(false);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('client');
  });

  it('refuses to reconcile when not in reclaim-pending', async () => {
    await seed(fixture({ handoffState: 'server' }));
    const r = await reconcileAfterHandoff('dep-1');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('server');
  });

  it('allows the rollback edge handoff-pending → client (client recovers before takeover)', async () => {
    await seed(fixture({ handoffState: 'handoff-pending' }));
    expect(shouldBlockNewCycle((await db.agentDeployments.get('dep-1'))!)).toBe(true);
    expect(await markClientRecovered('dep-1')).toBe(true);
    const d = await db.agentDeployments.get('dep-1');
    expect(d?.handoffState).toBe('client');
    expect(shouldBlockNewCycle(d!)).toBe(false);
  });

  it('markClientRecovered is idempotent from client state', async () => {
    await seed(fixture({ handoffState: 'client' }));
    expect(await markClientRecovered('dep-1')).toBe(true);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('client');
  });

  it('markClientRecovered refuses illegal source states (server, reclaim-pending)', async () => {
    await seed(fixture({ handoffState: 'server' }));
    expect(await markClientRecovered('dep-1')).toBe(false);
    expect((await db.agentDeployments.get('dep-1'))?.handoffState).toBe('server');
  });
});
