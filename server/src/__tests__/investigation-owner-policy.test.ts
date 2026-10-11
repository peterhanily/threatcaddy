import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  selections: [] as unknown[], updateResults: [] as unknown[], trace: [] as string[],
  committed: false, failCommit: false,
}));
vi.mock('../db/index.js', () => {
  function chain(kind: string) {
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'innerJoin', 'limit', 'for', 'orderBy', 'values', 'set', 'returning']) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      state.trace.push(kind);
      const result = kind === 'select' ? state.selections.shift() : kind === 'update' ? state.updateResults.shift() : [];
      return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result ?? [])).then(resolve, reject);
    };
    return query;
  }
  const tx = {
    execute: vi.fn(async () => { state.trace.push('clock'); return [{ id: 1 }]; }),
    select: () => chain('select'), insert: () => chain('insert'), update: () => chain('update'), delete: () => chain('delete'),
  };
  return { db: { ...tx, transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
    const result = await callback(tx);
    if (state.failCommit) throw new Error('Synthetic commit failure');
    state.committed = true;
    return result;
  } } };
});
vi.mock('../middleware/auth.js', () => ({ signAccessToken: vi.fn() }));
vi.mock('../services/admin-secret.js', () => ({ getSessionSettings: vi.fn() }));
vi.mock('../services/session-events.js', () => ({ notifySessionRevocation: vi.fn(() => { expect(state.committed).toBe(true); }) }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn(() => { expect(state.committed).toBe(true); }) }));

import { isEligibleInvestigationOwner, mutateInvestigationMember, InvestigationPolicyError } from '../services/investigation-policy.js';
import { updateUsersAndRevokeSessions } from '../services/session-service.js';
import { notifySessionRevocation } from '../services/session-events.js';
import { getToolByName } from '../services/admin-ai-service.js';
import { logActivity } from '../services/audit-service.js';

const human = { id: 'person', email: 'person@example.test', active: true, role: 'analyst' };
const folder = { id: 'case', name: 'Synthetic case', deletedAt: null };
const adminActor = { kind: 'admin' as const, userId: 'administrator' };

beforeEach(() => {
  vi.clearAllMocks(); state.selections.length = 0; state.updateResults.length = 0; state.trace.length = 0;
  state.committed = false; state.failCommit = false;
});

describe('current eligible owner policy', () => {
  it.each([
    [human, true], [{ ...human, role: 'admin' }, true], [{ ...human, active: false }, false],
    [{ ...human, role: 'viewer' }, false], [{ ...human, email: 'bot@THREATCADDY.INTERNAL' }, false], [undefined, false],
  ])('classifies only active human admin/analyst owners (%j)', (user, eligible) => {
    expect(isEligibleInvestigationOwner(user)).toBe(eligible);
  });

  it('checks the current actor under the clock before any membership write', async () => {
    state.selections.push([folder], [folder], []);
    await expect(mutateInvestigationMember({ actor: { kind: 'user', userId: 'former-owner' }, folderId: folder.id, targetUserId: human.id, operation: 'add', role: 'editor' }))
      .rejects.toMatchObject({ status: 403, code: 'OWNER_REQUIRED' });
    expect(state.trace).toEqual(['clock', 'select', 'select', 'select']);
    expect(state.committed).toBe(false);
  });

  it.each(['remove', 'update'] as const)('rejects %s of the last eligible owner after the prospective write', async operation => {
    state.selections.push([folder], [{ active: true }], [human], [{ id: 'member', role: 'owner' }], []);
    await expect(mutateInvestigationMember({ actor: adminActor, folderId: folder.id, targetUserId: human.id, operation, role: operation === 'update' ? 'viewer' : undefined }))
      .rejects.toMatchObject({ status: 409, code: 'LAST_ELIGIBLE_OWNER' });
    expect(state.trace[0]).toBe('clock');
    expect(state.trace).toContain(operation === 'remove' ? 'delete' : 'update');
    expect(state.committed).toBe(false);
  });

  it('allows an owner change when another eligible owner remains', async () => {
    state.selections.push([folder], [{ active: true }], [human], [{ id: 'member', role: 'owner' }], [{ folderId: folder.id }]);
    await expect(mutateInvestigationMember({ actor: adminActor, folderId: folder.id, targetUserId: human.id, operation: 'remove' })).resolves.toMatchObject({ changed: true });
    expect(state.committed).toBe(true);
  });

  it.each([{ ...human, active: false }, { ...human, role: 'viewer' }, { ...human, email: 'bot@threatcaddy.internal' }])('rejects ineligible owner assignments before insertion', async user => {
    state.selections.push([folder], [{ active: true }], [user]);
    await expect(mutateInvestigationMember({ actor: adminActor, folderId: folder.id, targetUserId: human.id, operation: 'add', role: 'owner' }))
      .rejects.toMatchObject({ status: 400, code: 'INELIGIBLE_OWNER' });
    expect(state.trace).not.toContain('insert');
  });

  it('supports explicit admin recovery without inferring a former creator', async () => {
    state.selections.push([{ ...folder, deletedAt: new Date() }], [{ active: true }], [human], []);
    await expect(mutateInvestigationMember({ actor: adminActor, folderId: folder.id, targetUserId: human.id, operation: 'add', role: 'owner' })).resolves.toMatchObject({ user: human, changed: true });
    expect(state.trace.filter(value => value === 'insert')).toHaveLength(1);
  });
});

describe('account eligibility changes and session revocation', () => {
  it.each([{ active: false }, { role: 'analyst' as const }])('protects the last active human app administrator for %j', async change => {
    state.selections.push([{ ...human, role: 'admin' }], [], []);
    state.updateResults.push([{ id: human.id }]);
    await expect(updateUsersAndRevokeSessions([human.id], change)).rejects.toMatchObject({ status: 409, code: 'LAST_ACTIVE_ADMIN' });
    expect(state.committed).toBe(false); expect(notifySessionRevocation).not.toHaveBeenCalled();
  });

  it('allows an admin change when another active human admin remains', async () => {
    state.selections.push([{ ...human, role: 'admin' }], [], [{ id: 'other-human-admin' }]);
    state.updateResults.push([{ id: human.id }]);
    await expect(updateUsersAndRevokeSessions([human.id], { role: 'analyst' })).resolves.toEqual([{ id: human.id }]);
    expect(notifySessionRevocation).toHaveBeenCalledExactlyOnceWith({ userId: human.id });
  });

  it('does not block unrelated changes to an already admin-less legacy installation', async () => {
    state.selections.push([human], []); state.updateResults.push([{ id: human.id }]);
    await expect(updateUsersAndRevokeSessions([human.id], { role: 'viewer' })).resolves.toEqual([{ id: human.id }]);
    expect(state.selections).toHaveLength(0); expect(state.trace.filter(value => value === 'select')).toHaveLength(2);
  });

  it('rejects a bulk change that leaves any protected investigation ownerless without revocation', async () => {
    state.selections.push([human, { ...human, id: 'other' }], [{ folderId: 'case' }, { folderId: 'second-case' }], [{ folderId: 'second-case' }]);
    state.updateResults.push([{ id: human.id }, { id: 'other' }]);
    await expect(updateUsersAndRevokeSessions([human.id, 'other'], { active: false })).rejects.toBeInstanceOf(InvestigationPolicyError);
    expect(state.trace[0]).toBe('clock'); expect(state.committed).toBe(false);
    expect(state.trace).not.toContain('delete'); expect(notifySessionRevocation).not.toHaveBeenCalled();
  });

  it('revokes only changed accounts and only after a successful commit', async () => {
    state.selections.push([{ active: true }], [human], [{ folderId: 'case' }], [{ folderId: 'case' }]);
    state.updateResults.push([{ id: human.id }]);
    expect(await updateUsersAndRevokeSessions([human.id, 'missing'], { role: 'viewer' }, undefined, adminActor)).toEqual([{ id: human.id }]);
    expect(notifySessionRevocation).toHaveBeenCalledExactlyOnceWith({ userId: human.id });
    expect(state.trace[0]).toBe('clock'); expect(state.trace.at(-1)).toBe('delete');
  });

  it('rejects an account administrator whose authority changed while waiting', async () => {
    state.selections.push([{ ...human, role: 'viewer' }]);
    await expect(updateUsersAndRevokeSessions(['other'], { active: false }, undefined, { kind: 'user', userId: human.id })).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
    expect(state.trace).toEqual(['clock', 'select']); expect(notifySessionRevocation).not.toHaveBeenCalled();
  });

  it('does not notify revocation if the database commit fails', async () => {
    state.selections.push([human], []); state.updateResults.push([{ id: human.id }]); state.failCommit = true;
    await expect(updateUsersAndRevokeSessions([human.id], { active: false })).rejects.toThrow('Synthetic commit failure');
    expect(notifySessionRevocation).not.toHaveBeenCalled();
  });

  it.each([['set_user_role', { role: 'viewer' }], ['toggle_user_active', { active: false }]] as const)('admin AI %s uses the same transactional policy and session lifecycle', async (name, change) => {
    state.selections.push([human], [{ active: true }], [human], []);
    state.updateResults.push([{ id: human.id }]);
    const result = await getToolByName(name)!.execute({ userId: human.id, ...change }, adminActor.userId);
    expect(result).toMatchObject({ ok: true, user: { id: human.id } });
    expect(notifySessionRevocation).toHaveBeenCalledExactlyOnceWith({ userId: human.id });
    expect(logActivity).toHaveBeenCalledOnce();
  });

  it('does not audit a rejected admin AI owner-demotion as success', async () => {
    state.selections.push([human], [{ active: true }], [human], [{ folderId: 'case' }], []);
    state.updateResults.push([{ id: human.id }]);
    await expect(getToolByName('set_user_role')!.execute({ userId: human.id, role: 'viewer' }, adminActor.userId)).rejects.toMatchObject({ code: 'LAST_ELIGIBLE_OWNER' });
    expect(logActivity).not.toHaveBeenCalled(); expect(notifySessionRevocation).not.toHaveBeenCalled();
  });
});
