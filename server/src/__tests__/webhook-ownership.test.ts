import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => {
  const oldSecret = process.env.WEBHOOK_INGEST_SECRET;
  const oldOwner = process.env.WEBHOOK_INGEST_OWNER_ID;
  process.env.WEBHOOK_INGEST_SECRET = 'synthetic-ingest-secret';
  return { oldSecret, oldOwner, results: [] as unknown[][], committed: [] as Array<{ table: unknown; values: Record<string, unknown> | unknown[] }>, failTable: undefined as unknown, txOwner: {} as Record<string, unknown>, access: vi.fn(), transaction: vi.fn() };
});
vi.mock('../middleware/access.js', () => ({ checkInvestigationAccess: mocks.access }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../db/index.js', () => ({ db: {
  select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => mocks.results.shift() ?? [] }) }) })),
  insert: () => { throw new Error('Ingest writes must be inside one transaction'); },
  transaction: mocks.transaction,
} }));
import { folders, investigationMembers, notes, standaloneIOCs } from '../db/schema.js';
import webhooks from '../routes/webhooks.js';
const app = new Hono().route('/webhooks', webhooks);
const request = (body: unknown = { source: 'synthetic', title: 'Owned alert', iocs: [{ type: 'domain', value: 'indicator.example.invalid' }] }) => app.request('/webhooks/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'synthetic-ingest-secret' }, body: JSON.stringify(body) });
const owner = { id: 'owner-a', active: true, role: 'analyst', email: 'owner@example.invalid' };

beforeEach(() => {
  vi.clearAllMocks(); mocks.results.length = 0; mocks.committed.length = 0; mocks.failTable = undefined;
  process.env.WEBHOOK_INGEST_OWNER_ID = owner.id; mocks.txOwner = owner;
  mocks.access.mockResolvedValue(true);
  mocks.transaction.mockImplementation(async callback => {
    const staged: typeof mocks.committed = [];
    await callback({ select: () => ({ from: () => ({ where: () => ({ for: async () => [mocks.txOwner] }) }) }), insert: (table: unknown) => ({ values: async (values: Record<string, unknown> | unknown[]) => {
      if (table === mocks.failTable) throw new Error('Synthetic membership failure');
      staged.push({ table, values });
    } }) });
    mocks.committed.push(...staged);
  });
});
afterAll(() => {
  for (const [key, value] of [['WEBHOOK_INGEST_SECRET', mocks.oldSecret], ['WEBHOOK_INGEST_OWNER_ID', mocks.oldOwner]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

describe('webhook investigation ownership', () => {
  it('requires an explicitly configured owner before writing data', async () => {
    delete process.env.WEBHOOK_INGEST_OWNER_ID;
    expect((await request()).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([{ ...owner, active: false }, { ...owner, role: 'viewer' }, { ...owner, email: 'bot@threatcaddy.internal' }])('rejects a noneligible configured principal', async principal => {
    mocks.results.push([principal]);
    expect((await request()).status).toBe(503);
    expect(mocks.committed).toEqual([]);
  });

  it('creates owner membership, attributed records and JSONB arrays in the same transaction', async () => {
    mocks.results.push([owner]);
    const response = await request();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ created: true, iocs: 1, agentsTriggered: 0, agentExecutionAvailable: false });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.committed.map(write => write.table)).toEqual([folders, investigationMembers, notes, standaloneIOCs]);
    expect(mocks.committed[0].values).toMatchObject({ id: result.investigationId, createdBy: owner.id, updatedBy: owner.id, tags: ['source:synthetic', 'auto-ingested'] });
    expect(mocks.committed[1].values).toMatchObject({ folderId: result.investigationId, userId: owner.id, role: 'owner' });
    expect(mocks.committed[2].values).toMatchObject({ folderId: result.investigationId, createdBy: owner.id, tags: ['alert', 'source:synthetic', 'severity:medium'] });
  });

  it('revalidates the configured owner under the write transaction before inserting records', async () => {
    mocks.results.push([owner]); mocks.txOwner = { ...owner, active: false };
    expect((await request()).status).toBe(503);
    expect(mocks.committed).toEqual([]);
  });

  it('does not retain a folder or alert if owner membership creation fails', async () => {
    mocks.results.push([owner]); mocks.failTable = investigationMembers;
    expect((await request()).status).toBe(500);
    expect(mocks.committed).toEqual([]);
  });

  it('requires the configured owner to have editor access for existing investigations', async () => {
    mocks.results.push([owner], [{ id: 'existing-private-folder' }]); mocks.access.mockResolvedValue(false);
    expect((await request({ source: 'synthetic', title: 'Alert', investigationId: 'existing-private-folder' })).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(owner.id, 'existing-private-folder', 'editor');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
