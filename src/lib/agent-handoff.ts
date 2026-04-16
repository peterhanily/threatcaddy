/**
 * Client-side agent handoff state machine.
 *
 * Explicit state transitions for the client↔server handoff boundary.
 * Replaces the implicit timestamp-only signal in HeartbeatManager with
 * a typed state field on each deployment, so the UI and the cycle loop
 * can reason about "who owns this agent right now" without racing.
 *
 * State transitions:
 *
 *   client ──heartbeat lapse──▶ handoff-pending ──server accepts──▶ server
 *     ▲                                                                │
 *     │                                                                │
 *     └────── reclaim-pending ◀──client heartbeat resumes──────────────┘
 *
 * Phase 5 scope is intentionally conservative: the functions here manage
 * local state only. The server-side reconciliation (entity version diff,
 * conflict resolution) is a follow-up — the hooks below are the landing
 * pad when that work lands.
 */

import { db } from '../db';
import type { AgentAction, AgentDeployment, HandoffReconciliation } from '../types';

type HandoffState = NonNullable<AgentDeployment['handoffState']>;

/** Safe transition table — attempted transitions outside these edges are logged and no-op'd. */
const LEGAL_TRANSITIONS: Record<HandoffState, HandoffState[]> = {
  'client':           ['handoff-pending'],
  'handoff-pending':  ['server', 'client'],              // server-accept or client-recovers-before-takeover
  'server':           ['reclaim-pending'],
  'reclaim-pending':  ['client', 'server'],              // reconcile succeeds or fails back
};

async function transition(deploymentId: string, to: HandoffState, reason: string): Promise<boolean> {
  const d = await db.agentDeployments.get(deploymentId);
  if (!d) {
    console.warn(`[agent-handoff] no deployment ${deploymentId}`);
    return false;
  }
  const from: HandoffState = d.handoffState ?? 'client';
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    console.warn(`[agent-handoff] illegal transition ${from} → ${to} on ${deploymentId} (${reason})`);
    return false;
  }
  await db.agentDeployments.update(deploymentId, {
    handoffState: to,
    updatedAt: Date.now(),
  });
  return true;
}

/** Called when the client-side heartbeat monitor observes a missed beat. */
export function markHandoffPending(deploymentId: string): Promise<boolean> {
  return transition(deploymentId, 'handoff-pending', 'client heartbeat lapsed');
}

/** Called when the server confirms takeover of a deployment. */
export function markServerOwned(deploymentId: string): Promise<boolean> {
  return transition(deploymentId, 'server', 'server accepted ownership');
}

/** Called when the client resumes sending heartbeats after a server-owned window. */
export function markReclaimPending(deploymentId: string): Promise<boolean> {
  return transition(deploymentId, 'reclaim-pending', 'client heartbeat resumed');
}

/** Called when the client's heartbeat recovers before the server took over —
 *  handoff-pending → client. Idempotent: already-client is fine. */
export async function markClientRecovered(deploymentId: string): Promise<boolean> {
  const d = await db.agentDeployments.get(deploymentId);
  if (!d) return false;
  const s = d.handoffState ?? 'client';
  if (s === 'client') return true;
  if (s === 'handoff-pending') return transition(deploymentId, 'client', 'heartbeat recovered before server takeover');
  return false;
}

/**
 * Reconciliation hook — called once during the 'reclaim-pending' state.
 *
 * Summarizes what the server did while it owned the deployment and stores it
 * as a `HandoffReconciliation` on the deployment so the UI can surface a
 * "here's what happened while you were away" banner until the analyst
 * acknowledges it.
 *
 * The server-side entity-version diff (conflict detection, last-write-wins)
 * is still a TODO — it needs a server-side version API. When that lands, it
 * replaces or augments the summary here. Until then we rely on the existing
 * sync-engine to have brought local state up to date; this hook turns the
 * state machine into user-visible signal, not just internal bookkeeping.
 */
export async function reconcileAfterHandoff(
  deploymentId: string,
  opts: { serverActionIds?: string[] } = {},
): Promise<{ ok: boolean; reason?: string; reconciliation?: HandoffReconciliation }> {
  const d = await db.agentDeployments.get(deploymentId);
  if (!d) return { ok: false, reason: 'deployment not found' };
  if (d.handoffState !== 'reclaim-pending') {
    return { ok: false, reason: `reconcile requested while in state ${d.handoffState || 'client'}` };
  }

  // Build the summary from whatever server actions were passed in, or from
  // any agentActions on this investigation created after the last reconcile
  // marker (fallback path for heartbeats that didn't pull explicit IDs).
  const ids = opts.serverActionIds ?? [];
  let actions: AgentAction[] = [];
  if (ids.length > 0) {
    actions = (await Promise.all(ids.map(id => db.agentActions.get(id))))
      .filter((a): a is AgentAction => !!a);
  } else {
    const since = d.lastReconciledAt ?? 0;
    actions = await db.agentActions
      .where('[investigationId+createdAt]')
      .between([d.investigationId, since], [d.investigationId, Infinity])
      .filter(a => a.status === 'executed')
      .toArray();
  }

  const toolHistogram: Record<string, number> = {};
  for (const a of actions) {
    toolHistogram[a.toolName] = (toolHistogram[a.toolName] || 0) + 1;
  }

  const reconciliation: HandoffReconciliation = {
    at: Date.now(),
    serverActionCount: actions.length,
    serverActionIds: actions.map(a => a.id),
    toolHistogram,
    acknowledged: false,
  };

  await db.agentDeployments.update(deploymentId, {
    handoffState: 'client',
    lastReconciledAt: Date.now(),
    lastHandoffReconciliation: reconciliation,
    updatedAt: Date.now(),
  });
  return { ok: true, reconciliation };
}

/** Mark the most recent HandoffReconciliation on a deployment as acknowledged,
 *  which clears the banner. Called from the AgentPanel dismiss action. */
export async function acknowledgeReconciliation(deploymentId: string): Promise<boolean> {
  const d = await db.agentDeployments.get(deploymentId);
  if (!d?.lastHandoffReconciliation) return false;
  await db.agentDeployments.update(deploymentId, {
    lastHandoffReconciliation: { ...d.lastHandoffReconciliation, acknowledged: true },
    updatedAt: Date.now(),
  });
  return true;
}

/** True when the deployment is in a state where a new cycle should not start
 *  (server owns it, or client hasn't finished reconciling yet). */
export function shouldBlockNewCycle(d: AgentDeployment): boolean {
  const s = d.handoffState ?? 'client';
  return s === 'server' || s === 'handoff-pending' || s === 'reclaim-pending';
}
