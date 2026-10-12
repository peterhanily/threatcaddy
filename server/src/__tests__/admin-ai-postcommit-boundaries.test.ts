import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ audit: vi.fn(), updateAccount: vi.fn(), reload: vi.fn(), unload: vi.fn(),
  transaction: vi.fn(), rollback: vi.fn(), execute: vi.fn(), writeBot: vi.fn() }));
vi.mock('../db/index.js', () => {
  const select = { from: () => select, where: () => select, for: async () => [{ id: 'synthetic-bot', name: 'Synthetic bot', type: 'monitor', sourceType: null, config: {} }] };
  const tx = { execute: state.execute, select: () => select,
    update: () => ({ set: (values: unknown) => { state.writeBot(values); return { where: () => ({ returning: async () => [{ name: 'Synthetic bot' }] }) }; } }) };
  return { db: { transaction: (callback: (tx: unknown) => Promise<unknown>) => state.transaction(() => callback(tx)) } };
});
vi.mock('../middleware/admin-auth.js', () => ({ assertAdminAiPrincipal: vi.fn(), AdminAuthorizationError: class extends Error {} }));
vi.mock('../services/session-service.js', () => ({ updateUsersAndRevokeSessions: state.updateAccount }));
vi.mock('../services/audit-service.js', () => ({ logActivity: state.audit }));
vi.mock('../bots/bot-manager.js', () => ({ botManager: { reloadBot: state.reload, unloadBot: state.unload }, validateCronExpression: vi.fn() }));
import { executeApprovedAdminAiTool } from '../services/admin-ai-service.js';
import { setBotEnabled } from '../services/bot-service.js';
const context = { principal: { adminId: 'admin', tokenFingerprint: 'session', credentialVersion: 'fixture', sessionVersion: '', expiresAt: Date.now() + 3_600_000 } };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.execute.mockResolvedValue([{ id: 1 }]);
  state.updateAccount.mockResolvedValue([{ id: 'person' }]); state.audit.mockResolvedValue(undefined);
  state.transaction.mockImplementation(async callback => { try { return await callback(); } catch (error) { state.rollback(); throw error; } });
  state.reload.mockResolvedValue(undefined); state.unload.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('bounded auxiliary work after an approved action commits', () => {
  it('returns committed with warning when the audit connection is late and prevents a later INSERT', async () => {
    let acquire!: () => void;
    state.transaction.mockImplementation(callback => new Promise((resolve, reject) => { acquire = () => { void callback().then(resolve, reject); }; }));
    const action = executeApprovedAdminAiTool('toggle_user_active', { userId: 'person', active: false }, context);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await action).toMatchObject({ ok: true, warnings: [expect.any(String)] });
    expect(state.updateAccount).toHaveBeenCalledTimes(1);
    acquire(); await Promise.resolve(); await Promise.resolve();
    expect(state.audit).not.toHaveBeenCalled();
  });
  it('rolls back an auxiliary audit which settles after its deadline while retaining the committed action receipt', async () => {
    let settle!: () => void;
    state.audit.mockReturnValue(new Promise<void>(resolve => { settle = resolve; }));
    const action = executeApprovedAdminAiTool('set_user_role', { userId: 'person', role: 'viewer' }, context);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await action).toMatchObject({ ok: true, newRole: 'viewer', warnings: [expect.any(String)] });
    settle(); await vi.advanceTimersByTimeAsync(0);
    expect(state.rollback).toHaveBeenCalledOnce();
  });
  it.each([true, false])('bounds a stalled runtime refresh after enabled=%s is persisted', async enabled => {
    const runtime = enabled ? state.reload : state.unload;
    runtime.mockReturnValue(new Promise(() => {}));
    const action = setBotEnabled('synthetic-bot', enabled);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await action).toMatchObject({ name: 'Synthetic bot', warnings: [expect.any(String)] });
    expect(state.writeBot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ enabled }));
    const options = runtime.mock.calls[0][enabled ? 2 : 1];
    expect(options.signal.aborted).toBe(true);
  });
});
