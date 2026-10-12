import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  principal: { adminId: 'admin', tokenFingerprint: 'session', sessionVersion: '', credentialVersion: 'fixture', expiresAt: Date.now() + 3_600_000 },
  assert: vi.fn(), execute: vi.fn(),
}));
vi.mock('../middleware/admin-auth.js', () => ({
  requireAdminAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  getAdminAiPrincipal: () => state.principal,
  AdminAuthorizationError: class extends Error {},
}));
vi.mock('../services/admin-ai-service.js', () => ({ assertCurrentAdminAiSession: state.assert, executeApprovedAdminAiTool: state.execute }));
import router from '../routes/admin/ai-approvals.js';
import { adminAiApprovals } from '../services/admin-ai-approvals.js';
const app = new Hono().route('/', router);

beforeEach(() => { vi.clearAllMocks(); state.assert.mockResolvedValue(undefined); state.execute.mockResolvedValue({ ok: true }); });
function propose() { return adminAiApprovals.issue(state.principal, 'toggle_user_active', { userId: 'synthetic', active: false }); }
function decide(id: string, body: unknown, signal?: AbortSignal) {
  return app.request(`/api/ai/approvals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
}

describe('approval endpoint accepts only the explicit stored action decision', () => {
  it('returns a no-store committed receipt and safely replays it', async () => {
    const proposal = propose();
    const response = await decide(proposal.approvalId, { decision: 'approve' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'completed', name: 'toggle_user_active' });
    expect(state.execute).toHaveBeenCalledExactlyOnceWith('toggle_user_active', { userId: 'synthetic', active: false }, expect.objectContaining({ principal: state.principal }));
    await decide(proposal.approvalId, { decision: 'approve' });
    expect(state.execute).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], {}, { decision: 'yes' }, { decision: 'approve', input: { active: true } }, { decision: 'approve', tool: 'another' }])('rejects malformed or substituted decisions (%j)', async body => {
    const response = await decide(propose().approvalId, body);
    expect(response.status).toBe(400);
    expect(state.execute).not.toHaveBeenCalled();
  });
  it('rejects an oversized body and pre-aborted request before dispatch', async () => {
    expect((await decide(propose().approvalId, { decision: 'x'.repeat(300) })).status).toBe(400);
    const controller = new AbortController(); controller.abort();
    expect((await decide(propose().approvalId, { decision: 'approve' }, controller.signal)).status).toBe(408);
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.assert).not.toHaveBeenCalled();
  });
  it('does not consume a decision when current-session authorization fails', async () => {
    const proposal = propose();
    state.assert.mockRejectedValueOnce(new Error('Synthetic unavailable authority lookup'));
    expect((await decide(proposal.approvalId, { decision: 'approve' })).status).toBe(503);
    expect(state.execute).not.toHaveBeenCalled();
    expect(await (await decide(proposal.approvalId, { decision: 'approve' })).json()).toMatchObject({ status: 'completed' });
  });
});
