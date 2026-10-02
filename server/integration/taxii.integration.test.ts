import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const value = (state.db as Record<PropertyKey, unknown>)[property];
  return typeof value === 'function' ? value.bind(state.db) : value;
} }) }));
vi.mock('../src/middleware/auth.js', () => ({ requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => { c.set('user', { id: 'owner' }); await next(); } }));
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: vi.fn() }));
import taxii from '../src/routes/taxii.js';
import { processPush } from '../src/services/sync-service.js';
const app = new Hono().route('/taxii', taxii);

describe('TAXII live data and continuation in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase(); state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash) VALUES ('owner','owner@example.invalid','Owner','fixture')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES ('case','Case',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES ('membership','case','owner','owner')`;
  });
  afterEach(async () => { await database?.close(); });
  it('preserves imported granular marking restrictions after an authorized sync write', async () => {
    const definition = { type: 'marking-definition', spec_version: '2.1', id: 'marking-definition--af5b83a3-b105-5344-a13a-46f79d3279d7',
      created: '2022-10-01T00:00:00.000Z', definition_type: 'statement', definition: { statement: 'INTERNAL' } };
    const enrichment = { stix: [{ object: JSON.stringify({ granular_markings: [{ marking_ref: definition.id, selectors: ['description'] }] }), markings: JSON.stringify([definition]) }] };
    expect((await processPush([{ table: 'standaloneIOCs', entityId: 'ioc', op: 'put', clientVersion: 0,
      data: { folderId: 'case', type: 'domain', value: 'example.test', enrichment } }], 'owner', { authorize: true }))[0].status).toBe('accepted');
    const response = await app.request('/taxii/collections/case/objects/');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objects).toContainEqual(definition);
    expect(body.objects.find((object: { type: string }) => object.type === 'indicator').object_marking_refs).toContain(definition.id);
  });
  it('paginates across sub-millisecond database timestamps without repeating or omitting objects', async () => {
    await database.sql`INSERT INTO standalone_iocs (id,type,value,folder_id,created_at,updated_at)
      SELECT 'ioc-' || lpad(i::text, 3, '0'),'domain','value-' || i || '.example.test','case',now(),now() FROM generate_series(1, 125) AS i`;
    const seen: string[] = [];
    let next: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await app.request(`/taxii/collections/case/objects/?limit=17${next ? `&next=${next}` : ''}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.objects.length).toBeLessThanOrEqual(17);
      seen.push(...body.objects.map((object: { id: string }) => object.id));
      if (!body.more) break;
      expect(body.next).toBeTruthy(); next = body.next;
    }
    expect(seen).toHaveLength(125);
    expect(new Set(seen).size).toBe(125);
  });
  it('excludes retained tombstones and stops access after current membership is removed', async () => {
    await database.sql`INSERT INTO standalone_iocs (id,type,value,folder_id,created_at,updated_at,deleted_at)
      VALUES ('old','domain','old.example.test','case',now(),now(),now())`;
    expect((await (await app.request('/taxii/collections/case/objects/')).json()).objects).toEqual([]);
    await database.sql`DELETE FROM investigation_members WHERE id = 'membership'`;
    expect((await app.request('/taxii/collections/case/objects/')).status).toBe(403);
  });
});
