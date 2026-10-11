import { describe, expect, it, vi } from 'vitest';
import { AdminAiApprovalRegistry } from '../services/admin-ai-approvals.js';
import type { AdminAiPrincipal } from '../middleware/admin-auth.js';

const principal: AdminAiPrincipal = { adminId: 'admin', tokenFingerprint: 'session-one', sessionVersion: 'epoch', credentialVersion: 'credential', expiresAt: 10_000_000 };
const input = { userId: 'fictional-user', active: false };

describe('exact-action administrator approval registry', () => {
  it('executes the stored independent input once and retains the receipt for a lost acknowledgement', async () => {
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const supplied = { ...input };
    const proposal = registry.issue(principal, 'toggle_user_active', supplied);
    supplied.active = true;
    proposal.input.active = true;
    const execute = vi.fn(async () => ({ ok: true }));
    const first = await registry.decide(proposal.approvalId, 'approve', principal, execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith('toggle_user_active', input);
    expect(first).toMatchObject({ status: 'completed', result: { ok: true } });
    expect(await registry.decide(proposal.approvalId, 'approve', principal, execute)).toEqual(first);
    expect(await registry.decide(proposal.approvalId, 'reject', principal, execute)).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('consumes synchronously before concurrent confirmation can execute', async () => {
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const proposal = registry.issue(principal, 'toggle_user_active', input);
    let finish!: (value: unknown) => void;
    const execute = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const first = registry.decide(proposal.approvalId, 'approve', principal, execute);
    expect(await registry.decide(proposal.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'executing' });
    finish({ ok: true });
    expect(await first).toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([{ ...principal, adminId: 'other' }, { ...principal, tokenFingerprint: 'another-login' }])('does not disclose or consume another identity/session approval', async foreign => {
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const proposal = registry.issue(principal, 'toggle_user_active', input);
    const execute = vi.fn(async () => ({ ok: true }));
    await expect(registry.decide(proposal.approvalId, 'approve', foreign, execute)).rejects.toMatchObject({ status: 404 });
    expect(execute).not.toHaveBeenCalled();
    expect(await registry.decide(proposal.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'completed' });
  });

  it('rejects expired and restart-lost approvals without execution', async () => {
    let now = 1000;
    const registry = new AdminAiApprovalRegistry(() => now);
    const proposal = registry.issue(principal, 'toggle_user_active', input);
    const execute = vi.fn();
    now = proposal.expiresAt;
    await expect(registry.decide(proposal.approvalId, 'approve', principal, execute)).rejects.toMatchObject({ status: 410 });
    await expect(new AdminAiApprovalRegistry().decide(proposal.approvalId, 'approve', principal, execute)).rejects.toMatchObject({ status: 404 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('retains rejected and failed terminal decisions without rerunning', async () => {
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const rejected = registry.issue(principal, 'toggle_user_active', input);
    const execute = vi.fn(async () => { throw new DOMException('Synthetic cancellation', 'AbortError'); });
    expect(await registry.decide(rejected.approvalId, 'reject', principal, execute)).toMatchObject({ status: 'rejected' });
    expect(await registry.decide(rejected.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'rejected' });
    expect(execute).not.toHaveBeenCalled();
    const failed = registry.issue(principal, 'toggle_user_active', input);
    expect(await registry.decide(failed.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'failed', error: 'Action cancelled before commit.' });
    expect(await registry.decide(failed.approvalId, 'approve', principal, execute)).toMatchObject({ status: 'failed' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports a resolved commit truthfully even if cancellation arrives before the receipt is retained', async () => {
    const controller = new AbortController();
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const proposal = registry.issue(principal, 'toggle_user_active', input);
    const receipt = await registry.decide(proposal.approvalId, 'approve', principal, async () => {
      controller.abort(); return { ok: true, committed: true };
    });
    expect(controller.signal.aborted).toBe(true);
    expect(receipt).toMatchObject({ status: 'completed', result: { committed: true } });
  });

  it('bounds capacity, input and retained output without evicting an executing action', async () => {
    let now = 1000;
    const registry = new AdminAiApprovalRegistry(() => now, 1, 1);
    expect(() => registry.issue(principal, 'tool', { text: 'x'.repeat(4097) })).toThrow('too large');
    const proposal = registry.issue(principal, 'toggle_user_active', input);
    let finish!: (value: unknown) => void;
    const waiting = registry.decide(proposal.approvalId, 'approve', principal, () => new Promise(resolve => { finish = resolve; }));
    now = proposal.expiresAt + 1;
    expect(() => registry.issue(principal, 'toggle_user_active', input)).toThrow('Too many');
    finish({ text: 'x'.repeat(20_000) });
    expect(await waiting).toMatchObject({ status: 'completed', result: { ok: true, notice: expect.any(String) } });
    now += 300_001;
    expect(registry.issue(principal, 'toggle_user_active', input).approvalId).not.toBe(proposal.approvalId);
  });

  it('keeps a commit successful when result formatting fails and does not expose arbitrary coded transport errors', async () => {
    const registry = new AdminAiApprovalRegistry(() => 1000);
    const committed = registry.issue(principal, 'toggle_user_active', input);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(await registry.decide(committed.approvalId, 'approve', principal, async () => circular)).toMatchObject({ status: 'completed', result: { ok: true } });
    const failed = registry.issue(principal, 'toggle_user_active', input);
    const receipt = await registry.decide(failed.approvalId, 'approve', principal, async () => {
      throw Object.assign(new Error('Synthetic internal transport detail'), { code: 'ECONNRESET' });
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.error).not.toContain('Synthetic internal transport detail');
  });
});
