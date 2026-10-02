import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { standaloneIOCs } from '../db/schema.js';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], access: vi.fn(), limits: [] as number[] }));
vi.mock('../db/index.js', () => ({ db: { select: () => {
  const rows = mocks.rows.shift() ?? [];
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain,
    limit: (limit: number) => { mocks.limits.push(limit); return Promise.resolve(rows); },
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return chain;
} } }));
vi.mock('../middleware/auth.js', () => ({ requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => { c.set('user', { id: 'analyst' }); await next(); } }));
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: mocks.access }));
import routes from '../routes/taxii.js';
import { stixId, stixIOC, stixRelationship } from '../lib/stix-projection.js';
const app = new Hono().route('/api/taxii', routes);
const folder = { id: 'case', name: 'Ordinary investigation', deletedAt: null };
const path = '/api/taxii/collections/case/objects/';
function ioc(id: string, overrides = {}): typeof standaloneIOCs.$inferSelect {
  return { id, folderId: 'case', type: 'domain', value: `${id}.example.test`, clsLevel: 'TLP:GREEN', confidence: 'high',
    createdAt: new Date('2025-01-01Z'), updatedAt: new Date('2026-01-01Z'), cursorDate: '2026-01-01T00:00:00.000Z', deletedAt: null, trashed: false, archived: false,
    relationships: [], ...overrides } as unknown as typeof standaloneIOCs.$inferSelect;
}
beforeEach(() => { vi.clearAllMocks(); mocks.rows.length = 0; mocks.limits.length = 0; mocks.access.mockResolvedValue(true); });

describe('TAXII current-state objects', () => {
  it('returns an envelope and TAXII media type, with no deleted/trashed/archived IOC data', async () => {
    mocks.rows.push([folder], [ioc('visible'), ioc('deleted', { deletedAt: new Date() }), ioc('trash', { trashed: true }), ioc('archive', { archived: true })]);
    const response = await app.request(path);
    expect(response.headers.get('content-type')).toBe('application/taxii+json;version=2.1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-taxii-date-added-first')).toBe('2026-01-01T00:00:00.000Z');
    const body = await response.json();
    expect(body.type).toBeUndefined();
    expect(body.more).toBe(false);
    expect(body.objects.map((item: { name: string }) => item.name)).toEqual(['visible.example.test']);
    expect(mocks.limits).toEqual([1, 100]);
  });
  it('hides a deleted investigation on both metadata and objects endpoints', async () => {
    mocks.rows.push([{ ...folder, deletedAt: new Date() }], [{ ...folder, deletedAt: new Date() }]);
    expect((await app.request('/api/taxii/collections/case/')).status).toBe(404);
    expect((await app.request(path)).status).toBe(404);
  });
  it('continues within a multi-object IOC without losing its classification definition', async () => {
    const value = ioc('custom', { clsLevel: 'INTERNAL' });
    mocks.rows.push([folder], [value]);
    const first = await (await app.request(`${path}?limit=1`)).json();
    expect(first.more).toBe(true);
    expect(first.objects[0].type).toBe('marking-definition');
    mocks.rows.push([folder], [value]);
    const second = await (await app.request(`${path}?limit=1&next=${first.next}`)).json();
    expect(second.more).toBe(false);
    expect(second.objects[0].type).toBe('indicator');
    expect(second.objects[0].object_marking_refs).toEqual([first.objects[0].id]);
  });
  it('rechecks membership before every continuation', async () => {
    mocks.access.mockResolvedValue(false);
    expect((await app.request(`${path}?next=ordinary`)).status).toBe(403);
    expect(mocks.limits).toEqual([]);
  });
  it.each(['limit=0', 'limit=1&limit=2', 'added_after=not-a-date', 'next=invalid'])('rejects malformed %s', async query => {
    mocks.rows.push([folder]);
    expect((await app.request(`${path}?${query}`)).status).toBe(400);
  });
  it('respects type filters without relabelling CVEs or ATT&CK techniques as indicators', async () => {
    mocks.rows.push([folder], [ioc('cve', { type: 'cve', value: 'cve-2024-12345' }), ioc('technique', { type: 'mitre-attack', value: 'T1059' })]);
    const body = await (await app.request(`${path}?match[type]=vulnerability`)).json();
    expect(body.objects).toHaveLength(1);
    expect(body.objects[0]).toMatchObject({ type: 'vulnerability', name: 'CVE-2024-12345' });
  });
});
describe('STIX client/server identity and marking contract', () => {
  it.each([
    ['indicator', 'domain:example.test', '841dc450-7304-5213-ad4a-4c21d2d7db6b'],
    ['vulnerability', 'CVE-2024-12345', '62aacf68-9a2c-53c9-9885-ae8028030cb0'],
    ['attack-pattern', 'T1059', 'b22cc82e-f9fb-56aa-b9f8-48f6dc65b2b5'],
  ])('matches uuid.v5 URL fixture for %s', (type, value, expected) => expect(stixId(type, value)).toBe(`${type}--${expected}`));
  it('uses canonical TLP2 references and preserves stronger target markings on relationships', () => {
    const source = ioc('source');
    const target = ioc('target', { clsLevel: 'TLP:AMBER+STRICT' });
    expect(stixIOC(source)[0].object_marking_refs).toEqual(['marking-definition--bab4a63c-aed9-4cf5-a766-dfca5abac2bb']);
    expect(stixRelationship(source, target, 'related-to')[0].object_marking_refs).toEqual([
      'marking-definition--bab4a63c-aed9-4cf5-a766-dfca5abac2bb', 'marking-definition--939a9414-2ddd-4d32-a0cd-375ea402b003' ]);
  });
  it('preserves original granular markings conservatively at whole-object scope', () => {
    const mark = { type: 'marking-definition', spec_version: '2.1', id: 'marking-definition--af5b83a3-b105-5344-a13a-46f79d3279d7',
      created: '2022-10-01T00:00:00.000Z', definition_type: 'statement', definition: { statement: 'INTERNAL' } };
    const objects = stixIOC(ioc('imported', { enrichment: { stix: [{ object: JSON.stringify({ granular_markings: [{ marking_ref: mark.id, selectors: ['description'] }] }), markings: JSON.stringify([mark]) }] } }));
    expect(objects).toContainEqual(mark);
    expect(objects.at(-1)?.object_marking_refs).toContain(mark.id);
  });
});
