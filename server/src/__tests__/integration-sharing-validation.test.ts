import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
const mocks = vi.hoisted(() => ({ values: vi.fn(), returning: vi.fn(), audit: vi.fn(),
  user: { id: 'synthetic-user', role: 'analyst' } as { id: string; role: string } | null,
}));
vi.mock('../db/index.js', () => ({ db: { insert: () => ({ values: mocks.values }) } }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (context: { set: (key: string, value: unknown) => void; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    if (!mocks.user) return context.json({ error: 'Unauthorized' }, 401);
    context.set('user', mocks.user); await next();
  },
  requireRole: (...roles: string[]) => async (context: { get: (key: string) => { role: string }; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) =>
    roles.includes(context.get('user').role) ? next() : context.json({ error: 'Forbidden' }, 403),
}));
vi.mock('../services/audit-service.js', () => ({ logActivity: mocks.audit }));
import integrationRoutes from '../routes/integrations.js';
import { apiBodyLimit } from '../middleware/api-body-limit.js';
const app = new Hono().use('/api/*', apiBodyLimit).route('/api/integrations', integrationRoutes);
const definition = { id: 'synthetic-definition', name: 'Synthetic definition', schemaVersion: '1.0', version: '1', description: '', author: '',
  icon: '', color: '', category: 'utility', tags: [], source: 'user', triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: 'synthetic-user', role: 'analyst' }; mocks.values.mockReturnValue({ onConflictDoNothing: () => ({ returning: mocks.returning }) }); mocks.returning.mockResolvedValue([{ id: 'synthetic-definition' }]); mocks.audit.mockResolvedValue(undefined); });
const submitBody = (body: string) => app.request('/api/integrations/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const share = (template: unknown) => submitBody(JSON.stringify({ template }));
const collections = [
  ['steps', (index: number) => ({ id: `step-${index}`, type: 'delay', label: '', ms: 0 })],
  ['outputs', () => ({ type: 'display', template: { text: 'Synthetic output' } })],
  ['triggers', () => ({ type: 'manual' })],
] as const;
describe('shared integration template validation', () => {
  it.each(['../users/victim', '..', '.', 'has/slash', 'has\\backslash', '%2e%2e', 'id?query', 'id#hash', 'x'.repeat(129)])('rejects unsafe shared ID %s before storage', async id => {
    expect((await share({ ...definition, id })).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([{}, 1, false, null, 'x'.repeat(2001)])('rejects an invalid outer description', async description => {
    expect((await submitBody(JSON.stringify({ template: definition, description }))).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('preserves the valid outer description fallback', async () => {
    expect((await submitBody(JSON.stringify({ template: definition, description: 'Team description' }))).status).toBe(201);
    expect(mocks.values.mock.calls[0][0].description).toBe('Team description');
  });
  it('reports a duplicate share as a conflict without a success audit', async () => {
    mocks.returning.mockResolvedValue([]);
    const response = await share(definition);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'TEMPLATE_ALREADY_SHARED' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('requires authentication and a server write role', async () => {
    mocks.user = null; expect((await share(definition)).status).toBe(401);
    mocks.user = { id: 'synthetic-viewer', role: 'viewer' }; expect((await share(definition)).status).toBe(403);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('stores valid inert definitions without executing them', async () => {
    expect((await share(definition)).status).toBe(201);
    expect(mocks.values).toHaveBeenCalledOnce();
  });

  it.each([undefined, ''])('preserves generated template IDs when id is %j', async id => {
    const response = await share({ ...definition, id });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.template.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ id: body.template.id, template: { id: body.template.id } });
  });

  it.each(collections)('accepts exactly 256 valid %s', async (field, makeItem) => {
    const template = { ...definition, [field]: Array.from({ length: 256 }, (_, index) => makeItem(index)) };
    const response = await share(template);
    expect(response.status).toBe(201);
    expect(mocks.values).toHaveBeenCalledOnce();
    expect(mocks.values.mock.calls[0][0].template[field]).toEqual(template[field]);
  });

  it.each(collections)('rejects 257 otherwise valid %s before persistence', async (field, makeItem) => {
    const response = await share({ ...definition, [field]: Array.from({ length: 257 }, (_, index) => makeItem(index)) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid template', details: { [field]: [`At most 256 ${field} are allowed`] } });
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(collections)('rejects large malformed %s with one count error and accepts a follow-up', async field => {
    const response = await share({ ...definition, [field]: Array(5000).fill(null) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid template', details: { [field]: [`At most 256 ${field} are allowed`] } });
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect((await share(definition)).status).toBe(201);
    expect(mocks.values).toHaveBeenCalledOnce();
  });

  it('bounds details for an invalid collection within the accepted count', async () => {
    const response = await share({ ...definition, steps: Array(256).fill(null) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details.steps.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(body).length).toBeLessThan(8192);
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it.each(['null', '[]', 'false', '7', '"body"', '{}', '{', '', '{"template":null}', '{"template":[]}'])('rejects malformed outer body %j', async body => {
    expect((await submitBody(body)).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('preserves the 1 MiB HTTP limit before JSON parsing', async () => {
    expect((await submitBody(' '.repeat(1024 * 1024 + 1))).status).toBe(413);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    { ...definition, outputs: {} },
    { ...definition, configSchema: [{ key: 'setting' }] },
    { ...definition, steps: [{ id: 'loop', type: 'loop', label: '', items: '{{config.items}}', itemVariable: 'item', bodySteps: ['missing'] }] },
    { ...definition, steps: [{ id: 'loop', type: 'loop', label: '', items: '{{config.items}}', itemVariable: 'item', bodySteps: ['loop'] }] },
    { ...definition, steps: Array.from({ length: 9 }, (_, index) => ({ id: `step-${index}`, type: 'condition', label: '', expression: 'true', thenSteps: index === 8 ? [] : [`step-${index + 1}`] })) },
    { ...definition, steps: [{ id: 'http', type: 'http', label: '', method: 'GET', url: 'https://example.test' }] },
    { ...definition, triggers: undefined },
    { ...definition, version: undefined },
  ])('rejects malformed definitions before persistence', async value => {
    expect((await share(value)).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
