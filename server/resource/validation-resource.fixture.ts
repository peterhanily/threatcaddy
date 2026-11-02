import { generateKeyPairSync } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { test, expect, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  push: vi.fn(), insert: vi.fn(), syncInsert: vi.fn(), audit: vi.fn(), broadcast: vi.fn(),
  user: { id: 'resource-user', email: 'fixture@example.test', role: 'analyst', displayName: 'Resource fixture', avatarUrl: null },
}));
vi.mock('../src/db/index.js', () => ({ db: {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [mocks.user] }) }) }) }),
  insert: () => ({ values: mocks.insert }),
  transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    let reads = 0;
    const select = () => {
      const result = reads++ === 0 ? [{ ...mocks.user, active: true }] : [];
      const chain = { from: () => chain, where: () => chain, for: () => Promise.resolve(result), limit: () => Promise.resolve(result) };
      return chain;
    };
    return run({ select, execute: async () => [{ generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      insert: () => ({ values: mocks.syncInsert }) });
  },
} }));
vi.mock('../src/middleware/access.js', () => ({ checkInvestigationAccess: vi.fn() }));
vi.mock('../src/services/sync-service.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/services/sync-service.js')>();
  mocks.push.mockImplementation(original.processPush);
  return { ...original, processPush: mocks.push };
});
vi.mock('../src/bots/event-bus.js', () => ({ emitEntityEvent: vi.fn() }));
vi.mock('../src/services/audit-service.js', () => ({ logActivity: mocks.audit, logActivityBatch: mocks.audit }));
vi.mock('../src/ws/handler.js', () => ({ broadcastToFolder: mocks.broadcast }));

import syncRoutes from '../src/routes/sync.js';
import integrationRoutes from '../src/routes/integrations.js';
import { apiBodyLimit, MAX_SYNC_BYTES } from '../src/middleware/api-body-limit.js';
import { signAccessToken } from '../src/middleware/auth.js';

const app = new Hono();
app.use('/api/*', apiBodyLimit);
app.route('/api/sync', syncRoutes);
app.route('/api/integrations', integrationRoutes);
const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const template = {
  id: 'resource-template', name: 'Synthetic resource fixture', schemaVersion: '1.0', version: '1',
  description: '', author: '', icon: '', color: '', category: 'utility', tags: [], source: 'user',
  triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [],
};
const change = { table: 'tags', op: 'put', entityId: 'resource-tag', clientVersion: 0, data: { name: 'Synthetic' } };
const report = (value: Record<string, unknown>) => console.log(`RESOURCE_REPORT ${JSON.stringify(value)}`);

async function collectHeap() {
  if (!global.gc) throw new Error('The resource worker must enable --expose-gc');
  await nextTurn();
  global.gc(); global.gc();
  return process.memoryUsage().heapUsed;
}

test('bounded authenticated route validation survives repeated oversized collections', async () => {
  const scenario = process.env.RESOURCE_SCENARIO;
  if (!scenario || !['sync', 'sync-wide', 'steps', 'outputs', 'triggers'].includes(scenario)) throw new Error('Unknown resource scenario');
  const keys = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = keys.privateKey;
  process.env.JWT_PUBLIC_KEY = keys.publicKey;
  mocks.syncInsert.mockImplementation((value: unknown) => ({ returning: async () => [value] }));
  mocks.insert.mockReturnValue({ onConflictDoNothing: () => ({ returning: async () => [{ id: template.id }] }) });
  mocks.audit.mockResolvedValue(undefined);
  const token = await signAccessToken({ ...mocks.user, role: 'analyst' }, 'resource-session');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const isSync = scenario.startsWith('sync');
  const route = isSync ? '/api/sync/push' : '/api/integrations/templates';
  const limit = isSync ? MAX_SYNC_BYTES : 1024 * 1024;
  const validBody = JSON.stringify(isSync ? { generation, changes: [change] } : { template });
  const skeleton = isSync ? { generation, changes: '__RESOURCE_ARRAY__' }
    : { template: { ...template, [scenario]: '__RESOURCE_ARRAY__' } };
  const encoded = JSON.stringify(skeleton);
  const count = scenario === 'sync-wide' ? 1_350_000 : Math.floor((limit - Buffer.byteLength(encoded) - 4096) / 5);
  const payload = scenario === 'sync-wide'
    ? JSON.stringify({ generation, changes: [{ ...change, data: '__DATA__' }] }).replace('"__DATA__"',
      `{${Array.from({ length: count }, (_, index) => `"f${index}":0`).join(',')}}`)
    : encoded.replace('"__RESOURCE_ARRAY__"', `[${'null,'.repeat(count - 1)}null]`);
  const bytes = Buffer.byteLength(payload);
  expect(bytes).toBeLessThan(limit);
  expect(count).toBeGreaterThan(100_000);
  report({ kind: 'start', scenario, pid: process.pid, node: process.version, payloadBytes: bytes, elements: count, heapLimitMiB: 512 });

  // Keep production authentication and role middleware in the exercised path.
  expect((await app.request(route, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  mocks.user.role = 'viewer';
  expect((await app.request(route, { method: 'POST', body: '{}', headers })).status).toBe(403);
  mocks.user.role = 'analyst';
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();

  // No Content-Length header: enforce the actual streamed bytes, too.
  const overByteResponse = await app.request(route, { method: 'POST', headers, body: ' '.repeat(limit + 1) });
  report({ kind: 'byte-limit', scenario, payloadBytes: limit + 1, status: overByteResponse.status });
  expect(overByteResponse.status).toBe(413);
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  const retained: number[] = [];
  for (let iteration = 0; iteration < 8; iteration++) {
    const writesBefore = mocks.push.mock.calls.length + mocks.insert.mock.calls.length;
    const auditsBefore = mocks.audit.mock.calls.length;
    const started = performance.now();
    const response = await app.request(route, { method: 'POST', headers, body: payload });
    const responseText = await response.text();
    const elapsedMs = performance.now() - started;
    report({ kind: 'request', scenario, iteration, payloadBytes: bytes, status: response.status,
      elapsedMs: Math.round(elapsedMs), responseBytes: Buffer.byteLength(responseText),
      peakRssBytes: process.resourceUsage().maxRSS * 1024 });
    expect(response.status).toBe(400);
    expect(Buffer.byteLength(responseText)).toBeLessThanOrEqual(16 * 1024);
    if (isSync) expect(JSON.parse(responseText).code).toBe('VALIDATION_FAILED');
    expect(mocks.push.mock.calls.length + mocks.insert.mock.calls.length).toBe(writesBefore);
    expect(mocks.audit.mock.calls.length).toBe(auditsBefore);
    expect(mocks.broadcast).not.toHaveBeenCalled();
    const followup = await app.request(route, { method: 'POST', headers, body: validBody });
    expect(followup.status).toBe(isSync ? 200 : 201);
    await followup.text();
    expect(mocks.push.mock.calls.length + mocks.insert.mock.calls.length).toBe(writesBefore + 1);
    retained.push(await collectHeap());
  }
  // Compare warmed samples, not initialization. Clean runs grew by <1 MiB;
  // a 2 MiB allowance still catches retaining each 1 MiB template request.
  const early = Math.min(...retained.slice(1, 3));
  const late = Math.max(...retained.slice(-3));
  const growth = late - early;
  report({ kind: 'complete', scenario, survives: true, postGcHeapBytes: retained,
    retainedGrowthBytes: growth, maximumRetainedGrowthBytes: 2 * 1024 * 1024,
    peakRssBytes: process.resourceUsage().maxRSS * 1024 });
  expect(growth).toBeLessThanOrEqual(2 * 1024 * 1024);
});
