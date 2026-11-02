import { afterEach, expect, it } from 'vitest';
import { hash } from 'argon2';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';
import { bootBuiltServer, stageBuiltServer } from './startup.js';

let database: ScratchDatabase | undefined;
let artifact: Awaited<ReturnType<typeof stageBuiltServer>> | undefined;
afterEach(async () => {
  const results = await Promise.allSettled([artifact?.close(), database?.close()]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Validation fixture cleanup failed');
});

it('packaged HTTP validation preserves authenticated sync and sharing without rejected writes, including after restart', async () => {
  const fixture = await scratchDatabase();
  database = fixture;
  await applyCurrentMigrations(fixture);
  const password = 'Synthetic-validation-password';
  const passwordHash = await hash(password);
  await fixture.sql`INSERT INTO users (id,email,display_name,password_hash,role)
    VALUES ('validation-user','validation@example.test','Validation',${passwordHash},'analyst')`;
  await fixture.sql`INSERT INTO folders (id,name,created_at,updated_at)
    VALUES ('validation-folder','Synthetic validation',now(),now())`;
  await fixture.sql`INSERT INTO investigation_members (id,folder_id,user_id,role)
    VALUES ('validation-membership','validation-folder','validation-user','owner')`;
  artifact = await stageBuiltServer();
  const definition = {
    id: 'validation-template', name: 'Synthetic template', schemaVersion: '1.0', version: '1',
    description: '', author: '', icon: '', color: '', category: 'utility', tags: [], source: 'user',
    triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [],
  };

  await bootBuiltServer(fixture, artifact, async ({ apiUrl }) => {
    const post = (path: string, body: unknown, token?: string) => fetch(apiUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    });
    expect((await post('/api/sync/push', {})).status).toBe(401);
    const login = await post('/api/auth/login', { email: 'validation@example.test', password });
    expect(login.status).toBe(200);
    const { accessToken } = await login.json();
    expect(typeof accessToken).toBe('string');
    const headers = { authorization: `Bearer ${accessToken}` };
    const pull = await fetch(apiUrl + '/api/sync/pull?cursor=0', { headers });
    expect(pull.status).toBe(200);
    const { generation } = await pull.json();
    const push = (body: unknown) => post('/api/sync/push', body, accessToken);
    const share = (body: unknown) => post('/api/integrations/templates', body, accessToken);
    const change = (entityId: string) => ({ table: 'notes', op: 'put', entityId, clientVersion: 0,
      data: { title: 'Synthetic note', content: 'Local fixture only', folderId: 'validation-folder' } });
    expect(await (await push({ generation, changes: [] })).json()).toEqual({ results: [] });
    const saved = await push({ generation, changes: [change('validation-note')] });
    expect(saved.status).toBe(200);
    expect((await saved.json()).results[0]).toMatchObject({ entityId: 'validation-note', status: 'accepted', serverVersion: 1 });
    expect((await share({ template: definition })).status).toBe(201);
    // Exercise the actual HTTP adapter: it must not offer an unread oversized
    // request's socket for reuse, or the next POST can fail with a socket reset.
    for (const [path, maximum] of [['/api/sync/push', 16 * 1024 * 1024], ['/api/integrations/templates', 1024 * 1024]] as const) {
      const oversized = await post(path, { padding: 'x'.repeat(maximum) }, accessToken);
      expect(oversized.status).toBe(413);
      expect(oversized.headers.get('connection')).toBe('close');
      expect(await oversized.json()).toMatchObject({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
      expect((await push({ generation, changes: [] })).status).toBe(200);
    }
    expect((await share({ template: definition })).status).toBe(409);
    const concurrent = await Promise.all([0, 1].map(() => share({ template: { ...definition, id: 'concurrent-template' } })));
    expect(concurrent.map(response => response.status).sort()).toEqual([201, 409]);

    const beforeAudit = await fixture.sql`SELECT count(*)::int AS count FROM activity_log`;
    for (const invalid of [null, [], false, { generation, changes: Array(501).fill(null) },
      { generation, changes: [{ ...change('wide-data'), data: { folderId: 'validation-folder',
        ...Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`field-${index}`, null])) } }] },
      { generation, changes: [{ ...change('long-key'), data: { folderId: 'validation-folder', ['x'.repeat(1024 * 1024)]: 'y'.repeat(500_001) } }] },
      { generation, changes: [{ ...change('long-value'), data: { folderId: 'validation-folder', content: 'y'.repeat(500_001) } }] },
    ]) {
      const response = await push(invalid);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    for (const invalid of [null, [], false, { template: null },
      { template: { ...definition, id: '../../users/validation-user' } },
      { template: { ...definition, id: 'invalid-description' }, description: { invalid: true } },
      { template: { ...definition, id: 'large-description' }, description: 'x'.repeat(900_000) },
      ...['steps', 'outputs', 'triggers'].map(field => ({
      template: { ...definition, id: 'must-not-be-stored', [field]: Array(257).fill(null) },
    }))]) expect((await share(invalid)).status).toBe(400);
    expect(await fixture.sql`SELECT count(*)::int AS count FROM activity_log`).toEqual(beforeAudit);
    expect(await fixture.sql`SELECT id FROM notes ORDER BY id`).toEqual([{ id: 'validation-note' }]);
    expect(await fixture.sql`SELECT id FROM integration_templates ORDER BY id`).toEqual([{ id: 'concurrent-template' }, { id: 'validation-template' }]);
    expect(await fixture.sql`SELECT active FROM users WHERE id='validation-user'`).toEqual([{ active: true }]);

    // Authorization reads current database role, including after token issuance.
    await fixture.sql`UPDATE users SET role='viewer' WHERE id='validation-user'`;
    expect((await push({ generation, changes: [] })).status).toBe(403);
    expect((await share({ template: definition })).status).toBe(403);
    await fixture.sql`UPDATE users SET role='analyst' WHERE id='validation-user'`;
    expect((await push({ generation, changes: [change('validation-followup')] })).status).toBe(200);
    expect((await share({ template: { ...definition, id: 'validation-followup' } })).status).toBe(201);
    const listed = await fetch(apiUrl + '/api/integrations/templates', { headers });
    expect(listed.status).toBe(200);
    expect((await listed.json()).templates.map((row: { template: { id: string } }) => row.template.id).sort())
      .toEqual(['concurrent-template', 'validation-followup', 'validation-template']);
  });

  await bootBuiltServer(fixture, artifact);
  expect(await fixture.sql`SELECT id FROM notes ORDER BY id`).toEqual([{ id: 'validation-followup' }, { id: 'validation-note' }]);
  expect(await fixture.sql`SELECT count(*)::int AS count FROM integration_templates`).toEqual([{ count: 3 }]);
});
