import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn(), select: vi.fn(), execute: vi.fn(), rows: [] as unknown[], afterRead: undefined as (() => void) | undefined }));
vi.mock('../db/index.js', () => {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => { state.afterRead?.(); return Promise.resolve(state.rows).then(resolve); };
  const database = { select: (...args: unknown[]) => { state.select(...args); return chain; }, execute: state.execute };
  return { db: { ...database, transaction: (...args: unknown[]) => { state.transaction(); return (args[0] as (tx: unknown) => unknown)(database); } } };
});
vi.mock('../middleware/admin-auth.js', () => ({ assertAdminAiPrincipal: state.guard, AdminAuthorizationError: class extends Error {} }));
vi.mock('../services/session-service.js', () => ({ updateUsersAndRevokeSessions: vi.fn() }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn() }));
import { dispatchAdminAiTool, executeApprovedAdminAiTool, validateAdminAiToolInput } from '../services/admin-ai-service.js';
const context = { principal: { adminId: 'fixture-admin', tokenFingerprint: 'fixture-session', sessionVersion: '', credentialVersion: 'fixture', expiresAt: Date.now() + 3_600_000 } };
beforeEach(() => { vi.clearAllMocks(); state.execute.mockResolvedValue([{ id: 1 }]); state.guard.mockResolvedValue(undefined); state.rows = []; state.afterRead = undefined; });

describe('validated administrator AI dispatch', () => {
  it.each([
    ['set_user_role', { userId: 'person', role: 'owner' }], ['toggle_user_active', { userId: 'person', active: 'false' }],
    ['toggle_bot', { botId: 'bot', enabled: true, extra: 'ignored-before' }], ['list_bots', { limit: 101 }],
    ['list_users', { limit: 1.5 }], ['get_recent_audit_log', { limit: 51 }], ['unknown', {}], ['get_server_stats', []],
  ])('rejects unsupported arguments without a query (%s)', async (name, input) => {
    await expect(dispatchAdminAiTool(name as string, input, context)).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it('does not coerce or lose supported explicit false values', () => {
    expect(validateAdminAiToolInput('toggle_user_active', { userId: 'person', active: false })).toEqual({ userId: 'person', active: false });
  });
  it('only proposes writes after current authority checks', async () => {
    const result = await dispatchAdminAiTool('toggle_user_active', { userId: 'person', active: false }, context);
    expect(result).toMatchObject({ kind: 'approval', approval: { name: 'toggle_user_active', input: { userId: 'person', active: false } } });
    expect(state.guard).toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
  });
  it('projects session metadata without credential identifiers', async () => {
    await dispatchAdminAiTool('get_active_sessions', {}, context);
    expect(Object.keys(state.select.mock.calls[0][0]).sort()).toEqual(['createdAt', 'displayName', 'expiresAt', 'userEmail', 'userId']);
    expect(state.guard).toHaveBeenCalledTimes(2);
  });
  it('rejects pre-aborted calls and drops a cancelled read before returning its result', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(dispatchAdminAiTool('list_users', {}, { ...context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(executeApprovedAdminAiTool('toggle_user_active', { userId: 'person', active: false }, { ...context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.transaction).not.toHaveBeenCalled();
    const inFlight = new AbortController(); state.afterRead = () => inFlight.abort();
    await expect(dispatchAdminAiTool('list_users', {}, { ...context, signal: inFlight.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
