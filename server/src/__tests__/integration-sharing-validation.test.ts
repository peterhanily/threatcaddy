import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ values: vi.fn(), audit: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: { insert: () => ({ values: mocks.values }) } }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (context: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => { context.set('user', { id: 'synthetic-user' }); await next(); },
  requireRole: () => async (_context: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../services/audit-service.js', () => ({ logActivity: mocks.audit }));
import app from '../routes/integrations.js';
const definition = { id: 'synthetic-definition', name: 'Synthetic definition', schemaVersion: '1.0', version: '1', description: '', author: '',
  icon: '', color: '', category: 'utility', tags: [], source: 'user', triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.values.mockResolvedValue(undefined); mocks.audit.mockResolvedValue(undefined); });
const share = (template: unknown) => app.request('/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template }) });
describe('shared integration template validation', () => {
  it('stores valid inert definitions without executing them', async () => {
    expect((await share(definition)).status).toBe(201);
    expect(mocks.values).toHaveBeenCalledOnce();
  });
  it.each([
    { ...definition, outputs: {} },
    { ...definition, configSchema: [{ key: 'setting' }] },
    { ...definition, steps: [{ id: 'loop', type: 'loop', label: '', items: '{{config.items}}', itemVariable: 'item', bodySteps: ['missing'] }] },
  ])('rejects malformed definitions before persistence', async value => {
    expect((await share(value)).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
