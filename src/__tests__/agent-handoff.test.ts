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
  acknowledgeReconciliation,
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

describe('reconcileAfterHandoff summary', () => {
  beforeEach(async () => {
    await db.agentDeployments.clear();
    await db.agentActions.clear();
  });

  async function seedAction(id: string, toolName: string, createdAt: number) {
    await db.agentActions.add({
      id,
      investigationId: 'inv-1',
      threadId: 't1',
      toolName,
      toolInput: {},
      rationale: '',
      status: 'executed',
      createdAt,
      executedAt: createdAt,
    });
  }

  it('records a HandoffReconciliation with tool histogram from explicit server action IDs', async () => {
    await seed(fixture({ handoffState: 'reclaim-pending' }));
    await seedAction('a1', 'create_note', 1000);
    await seedAction('a2', 'create_note', 2000);
    await seedAction('a3', 'enrich_ioc', 3000);

    const result = await reconcileAfterHandoff('dep-1', { serverActionIds: ['a1', 'a2', 'a3'] });
    expect(result.ok).toBe(true);
    expect(result.reconciliation).toBeDefined();
    expect(result.reconciliation!.serverActionCount).toBe(3);
    expect(result.reconciliation!.toolHistogram).toEqual({ create_note: 2, enrich_ioc: 1 });
    expect(result.reconciliation!.acknowledged).toBe(false);

    const d = await db.agentDeployments.get('dep-1');
    expect(d?.handoffState).toBe('client');
    expect(d?.lastHandoffReconciliation?.serverActionCount).toBe(3);
  });

  it('falls back to time-window scan when serverActionIds is not supplied', async () => {
    await seed(fixture({ handoffState: 'reclaim-pending', lastReconciledAt: 1500 }));
    await seedAction('old', 'create_note', 1000);   // before lastReconciledAt — should be excluded
    await seedAction('new1', 'update_ioc', 2000);   // after — should be included
    await seedAction('new2', 'create_note', 2500);  // after — included

    const result = await reconcileAfterHandoff('dep-1');
    expect(result.ok).toBe(true);
    expect(result.reconciliation!.serverActionCount).toBe(2);
    expect(result.reconciliation!.toolHistogram).toEqual({ update_ioc: 1, create_note: 1 });
  });

  it('handles empty action set without erroring', async () => {
    await seed(fixture({ handoffState: 'reclaim-pending' }));
    const result = await reconcileAfterHandoff('dep-1', { serverActionIds: [] });
    expect(result.ok).toBe(true);
    expect(result.reconciliation!.serverActionCount).toBe(0);
    expect(result.reconciliation!.toolHistogram).toEqual({});
  });

  it('acknowledgeReconciliation flips the acknowledged flag', async () => {
    await seed(fixture({
      handoffState: 'client',
      lastHandoffReconciliation: {
        at: 1000, serverActionCount: 2, serverActionIds: ['x', 'y'],
        toolHistogram: { create_note: 2 }, acknowledged: false,
      },
    }));
    expect(await acknowledgeReconciliation('dep-1')).toBe(true);
    const d = await db.agentDeployments.get('dep-1');
    expect(d?.lastHandoffReconciliation?.acknowledged).toBe(true);
  });

  it('acknowledgeReconciliation returns false when no reconciliation exists', async () => {
    await seed(fixture());
    expect(await acknowledgeReconciliation('dep-1')).toBe(false);
  });
});

describe('handoff state machine — end-to-end sequences', () => {
  beforeEach(async () => {
    await db.agentDeployments.clear();
    await db.agentActions.clear();
  });

  async function seedAction(id: string, toolName: string, createdAt: number) {
    await db.agentActions.add({
      id,
      investigationId: 'inv-1',
      threadId: 't1',
      toolName,
      toolInput: {},
      rationale: '',
      status: 'executed',
      createdAt,
      executedAt: createdAt,
    });
  }

  /** Simulates the full happy-path heartbeat-failure → server-takeover →
   *  client-resume → reconcile cycle in the order useServerAgents drives it. */
  it('full takeover-and-resume sequence produces a valid acknowledged reconciliation', async () => {
    await seed(fixture());
    expect(shouldBlockNewCycle((await db.agentDeployments.get('dep-1'))!)).toBe(false);

    // Heartbeat fails twice — useServerAgents flips deployment to handoff-pending.
    expect(await markHandoffPending('dep-1')).toBe(true);
    expect(shouldBlockNewCycle((await db.agentDeployments.get('dep-1'))!)).toBe(true);

    // Server accepts ownership and runs some actions.
    expect(await markServerOwned('dep-1')).toBe(true);
    await seedAction('s1', 'enrich_ioc', 1000);
    await seedAction('s2', 'create_note', 2000);
    await seedAction('s3', 'create_note', 3000);

    // Client heartbeat resumes — useServerAgents pulls actions, transitions
    // through reclaim-pending, then calls reconcile with the pulled IDs.
    expect(await markReclaimPending('dep-1')).toBe(true);
    const result = await reconcileAfterHandoff('dep-1', { serverActionIds: ['s1', 's2', 's3'] });
    expect(result.ok).toBe(true);

    // Final state: client owns it, banner is unacknowledged, summary is correct.
    let d = await db.agentDeployments.get('dep-1');
    expect(d?.handoffState).toBe('client');
    expect(shouldBlockNewCycle(d!)).toBe(false);
    expect(d?.lastHandoffReconciliation?.serverActionCount).toBe(3);
    expect(d?.lastHandoffReconciliation?.toolHistogram).toEqual({ enrich_ioc: 1, create_note: 2 });
    expect(d?.lastHandoffReconciliation?.acknowledged).toBe(false);
    expect(d?.lastReconciledAt).toBeGreaterThan(0);

    // Analyst dismisses the banner.
    expect(await acknowledgeReconciliation('dep-1')).toBe(true);
    d = await db.agentDeployments.get('dep-1');
    expect(d?.lastHandoffReconciliation?.acknowledged).toBe(true);
  });

  /** The recovery edge: heartbeat lapses but resumes before the server takes
   *  over. No reconciliation should be recorded. */
  it('client-recovers-before-server-takeover sequence skips reconciliation', async () => {
    await seed(fixture());

    expect(await markHandoffPending('dep-1')).toBe(true);
    expect(shouldBlockNewCycle((await db.agentDeployments.get('dep-1'))!)).toBe(true);

    expect(await markClientRecovered('dep-1')).toBe(true);
    const d = await db.agentDeployments.get('dep-1');
    expect(d?.handoffState).toBe('client');
    expect(shouldBlockNewCycle(d!)).toBe(false);
    expect(d?.lastHandoffReconciliation).toBeUndefined();
    expect(d?.lastReconciledAt).toBeUndefined();
  });

  /** Two takeovers in a row: each one should overwrite the previous
   *  reconciliation, and the banner should re-appear unacknowledged. */
  it('a second takeover overwrites the previous reconciliation summary', async () => {
    await seed(fixture());
    await markHandoffPending('dep-1');
    await markServerOwned('dep-1');
    await seedAction('first', 'create_note', 1000);
    await markReclaimPending('dep-1');
    await reconcileAfterHandoff('dep-1', { serverActionIds: ['first'] });
    await acknowledgeReconciliation('dep-1');
    expect((await db.agentDeployments.get('dep-1'))?.lastHandoffReconciliation?.acknowledged).toBe(true);

    // Second takeover with different actions
    await markHandoffPending('dep-1');
    await markServerOwned('dep-1');
    await seedAction('second-a', 'update_ioc', 4000);
    await seedAction('second-b', 'update_ioc', 5000);
    await markReclaimPending('dep-1');
    await reconcileAfterHandoff('dep-1', { serverActionIds: ['second-a', 'second-b'] });

    const d = await db.agentDeployments.get('dep-1');
    expect(d?.lastHandoffReconciliation?.serverActionCount).toBe(2);
    expect(d?.lastHandoffReconciliation?.toolHistogram).toEqual({ update_ioc: 2 });
    expect(d?.lastHandoffReconciliation?.acknowledged).toBe(false); // re-banner
    expect(d?.lastHandoffReconciliation?.serverActionIds).toEqual(['second-a', 'second-b']);
  });

  /** The cycle gate stays engaged at every blocking state and disengages
   *  exactly when the deployment returns to client. Walks every state. */
  it('shouldBlockNewCycle flips at the right edges through the full cycle', async () => {
    await seed(fixture());
    const at = async (state: string) => {
      const d = await db.agentDeployments.get('dep-1');
      expect(d?.handoffState ?? 'client').toBe(state);
      return d!;
    };

    expect(shouldBlockNewCycle(await at('client'))).toBe(false);
    await markHandoffPending('dep-1');
    expect(shouldBlockNewCycle(await at('handoff-pending'))).toBe(true);
    await markServerOwned('dep-1');
    expect(shouldBlockNewCycle(await at('server'))).toBe(true);
    await markReclaimPending('dep-1');
    expect(shouldBlockNewCycle(await at('reclaim-pending'))).toBe(true);
    await reconcileAfterHandoff('dep-1', { serverActionIds: [] });
    expect(shouldBlockNewCycle(await at('client'))).toBe(false);
  });
});
