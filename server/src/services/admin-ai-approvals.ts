import { randomUUID } from 'node:crypto';
import type { AdminAiPrincipal } from '../middleware/admin-auth.js';

export interface AdminAiApproval {
  approvalId: string;
  name: string;
  input: Record<string, unknown>;
  expiresAt: number;
}

export interface AdminAiApprovalReceipt {
  approvalId: string;
  name: string;
  status: 'executing' | 'completed' | 'rejected' | 'failed';
  result?: unknown;
  error?: string;
  completedAt?: number;
}

export class AdminAiApprovalError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429, readonly code: string) { super(message); }
}

type Entry = {
  approval: AdminAiApproval;
  adminId: string;
  tokenFingerprint: string;
  receipt?: AdminAiApprovalReceipt;
  retainUntil: number;
};

const TTL_MS = 5 * 60_000;
const MAX_INPUT_BYTES = 4096;
const MAX_RESULT_BYTES = 16_384;

/** Process-local like admin sessions: a restart invalidates pending approvals, never replays them. */
export class AdminAiApprovalRegistry {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 200, private readonly maxPerSession = 20) {}

  private prune(): void {
    for (const [id, entry] of this.entries) {
      if (entry.receipt?.status !== 'executing' && entry.retainUntil <= this.now()) this.entries.delete(id);
    }
  }

  issue(principal: AdminAiPrincipal, name: string, input: Record<string, unknown>): AdminAiApproval {
    this.prune();
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw new AdminAiApprovalError('Action input is too large.', 400, 'INVALID_ACTION');
    if (this.entries.size >= this.maxEntries || [...this.entries.values()].filter(entry => entry.tokenFingerprint === principal.tokenFingerprint).length >= this.maxPerSession) {
      throw new AdminAiApprovalError('Too many pending or recent approvals. Wait before requesting another action.', 429, 'APPROVAL_CAPACITY');
    }
    const approval = { approvalId: randomUUID(), name, input: JSON.parse(serialized) as Record<string, unknown>, expiresAt: Math.min(this.now() + TTL_MS, principal.expiresAt) };
    this.entries.set(approval.approvalId, { approval, adminId: principal.adminId, tokenFingerprint: principal.tokenFingerprint, retainUntil: approval.expiresAt });
    return structuredClone(approval);
  }

  async decide(id: string, decision: 'approve' | 'reject', principal: AdminAiPrincipal,
    execute: (name: string, input: Record<string, unknown>) => Promise<unknown>): Promise<AdminAiApprovalReceipt> {
    const entry = this.entries.get(id);
    if (!entry || entry.adminId !== principal.adminId || entry.tokenFingerprint !== principal.tokenFingerprint) {
      throw new AdminAiApprovalError('Approval was not found for this administrator session. Request a new proposal.', 404, 'APPROVAL_NOT_FOUND');
    }
    if (entry.receipt) {
      if (entry.receipt.status !== 'executing' && entry.retainUntil <= this.now()) {
        this.entries.delete(id);
        throw new AdminAiApprovalError('Approval receipt expired. Check the current state before requesting another action.', 410, 'APPROVAL_EXPIRED');
      }
      return structuredClone(entry.receipt);
    }
    if (entry.approval.expiresAt <= this.now()) {
      this.entries.delete(id);
      throw new AdminAiApprovalError('Approval expired. Request a new proposal.', 410, 'APPROVAL_EXPIRED');
    }
    const base = { approvalId: id, name: entry.approval.name };
    if (decision === 'reject') {
      entry.receipt = { ...base, status: 'rejected', completedAt: this.now() };
      entry.retainUntil = this.now() + TTL_MS;
      return structuredClone(entry.receipt);
    }
    // Consume before the first await. A concurrent request can inspect, but cannot execute again.
    entry.receipt = { ...base, status: 'executing' };
    try {
      const result = await execute(entry.approval.name, structuredClone(entry.approval.input));
      // The executor only resolves after commit. Never reinterpret a later disconnect as rollback.
      let retained: unknown = { ok: true, notice: 'Action completed; its full result could not be retained. Check the current state.' };
      try {
        const serialized = JSON.stringify(result ?? null);
        if (serialized !== undefined && Buffer.byteLength(serialized) <= MAX_RESULT_BYTES) retained = JSON.parse(serialized);
      } catch { /* A result-formatting failure after commit must not become a failed action. */ }
      entry.receipt = { ...base, status: 'completed', completedAt: this.now(), result: retained };
    } catch (error) {
      const known = error instanceof AdminAiApprovalError || (error instanceof Error && error.name === 'AbortError');
      entry.receipt = { ...base, status: 'failed', completedAt: this.now(), error: known
        ? (error.name === 'AbortError' ? 'Action cancelled before commit.' : error.message.slice(0, 512))
        : 'The action could not be completed. Check the current state before requesting a new proposal.' };
    }
    entry.retainUntil = this.now() + TTL_MS;
    return structuredClone(entry.receipt);
  }
}

export const adminAiApprovals = new AdminAiApprovalRegistry();
