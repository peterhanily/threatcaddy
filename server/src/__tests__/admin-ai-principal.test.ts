import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ active: true, hash: 'fictional-password-hash', epoch: '', lookup: vi.fn() }));
vi.mock('../services/admin-session-service.js', () => ({
  adminSessionVersion: () => state.epoch,
  getActiveAdmin: (...args: unknown[]) => { state.lookup(...args); return Promise.resolve(state.active ? { id: 'admin', username: 'fixture', passwordHash: state.hash } : undefined); },
}));
import { assertAdminAiPrincipal, getAdminAiPrincipal, initAdminKey, requireAdminAuth, signAdminToken, type AdminAiPrincipal } from '../middleware/admin-auth.js';
const app = new Hono().get('/', requireAdminAuth, c => c.json(getAdminAiPrincipal(c)));
const database = {} as Parameters<typeof assertAdminAiPrincipal>[0];
beforeEach(() => { vi.restoreAllMocks(); state.active = true; state.hash = 'fictional-password-hash'; state.epoch = ''; state.lookup.mockClear(); initAdminKey(); });
async function login() {
  const token = await signAdminToken('admin', 'fixture', state.hash);
  const response = await app.request('/', { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return { token, principal: await response.json() as AdminAiPrincipal };
}

describe('administrator approval session identity', () => {
  it('gives same-second logins different random identities and exposes no token or password hash', async () => {
    const first = await login(); const second = await login();
    expect(jose.decodeJwt(first.token).jti).toEqual(expect.any(String));
    expect(first.token).not.toBe(second.token);
    expect(first.principal.tokenFingerprint).not.toBe(second.principal.tokenFingerprint);
    expect(JSON.stringify(first.principal)).not.toContain(first.token);
    expect(JSON.stringify(first.principal)).not.toContain(state.hash);
    expect(Object.keys(first.principal).sort()).toEqual(['adminId', 'credentialVersion', 'expiresAt', 'sessionVersion', 'tokenFingerprint']);
  });
  it('retains authentication compatibility with already-issued tokens without jti', async () => {
    vi.spyOn(jose.SignJWT.prototype, 'setJti').mockImplementation(function (this: jose.SignJWT) { return this; });
    const legacy = await login();
    expect(jose.decodeJwt(legacy.token).jti).toBeUndefined();
    await expect(assertAdminAiPrincipal(database, legacy.principal)).resolves.toBeUndefined();
    expect(state.lookup).toHaveBeenLastCalledWith('admin', database, true);
  });
  it.each(['password', 'epoch', 'inactive', 'restart', 'expiry'])('rejects a captured principal after %s changes', async change => {
    const { principal } = await login();
    if (change === 'password') state.hash = 'different-fictional-hash';
    if (change === 'epoch') state.epoch = 'revoked';
    if (change === 'inactive') state.active = false;
    if (change === 'restart') initAdminKey();
    await expect(assertAdminAiPrincipal(database, change === 'expiry' ? { ...principal, expiresAt: 0 } : principal)).rejects.toMatchObject({ status: 401 });
  });
});
