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
import type { AgentDeployment } from '../types';

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
 * The stub below marks the deployment reconciled and transitions back to
 * 'client'. Once a server-version API exists, replace the body with:
 *   1. Fetch server entity versions for this investigation
 *   2. Diff against local entity versions
 *   3. Apply last-write-wins (or surface conflicts to the user)
 *   4. Only then transition to 'client'
 *
 * Until then: the local store is already being synced by the existing
 * sync-engine, so this hook just seals the state machine. Leaving the
 * hook here keeps the call site stable when the full reconciler lands.
 */
export async function reconcileAfterHandoff(deploymentId: string): Promise<{ ok: boolean; reason?: string }> {
  const d = await db.agentDeployments.get(deploymentId);
  if (!d) return { ok: false, reason: 'deployment not found' };
  if (d.handoffState !== 'reclaim-pending') {
    return { ok: false, reason: `reconcile requested while in state ${d.handoffState || 'client'}` };
  }

  // TODO(phase-5-followup): server-version-diff reconciliation lands here.
  // For now we trust the sync-engine to have brought local state up to date.

  await db.agentDeployments.update(deploymentId, {
    handoffState: 'client',
    lastReconciledAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { ok: true };
}

/** True when the deployment is in a state where a new cycle should not start
 *  (server owns it, or client hasn't finished reconciling yet). */
export function shouldBlockNewCycle(d: AgentDeployment): boolean {
  const s = d.handoffState ?? 'client';
  return s === 'server' || s === 'handoff-pending' || s === 'reclaim-pending';
}
