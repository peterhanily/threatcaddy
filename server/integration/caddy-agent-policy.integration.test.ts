import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown, unload: vi.fn() }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));
vi.mock('../src/middleware/auth.js', () => ({ requireAuth: async (context: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
  context.set('user', { id: 'editor' }); await next();
} }));
// This suite verifies persisted metadata only; no bot/provider may execute.
vi.mock('../src/bots/bot-manager.js', () => ({ botManager: { unloadBot: state.unload } }));
import caddyAgents from '../src/routes/caddy-agents.js';

describe('deployment metadata policy serialization in PostgreSQL', () => {
  let database: ScratchDatabase;
  const app = new Hono().route('/agents', caddyAgents);
  beforeEach(async () => {
    state.unload.mockReset();
    database = await scratchDatabase({ maxConnections: 4 }); state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Fictional owner','fixture','analyst'),
      ('editor','editor@example.invalid','Fictional editor','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at)
      VALUES ('case','Fictional case',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('owner-member','case','owner','owner'),('editor-member','case','editor','editor')`;
    await database.sql`INSERT INTO bot_configs
      (id,user_id,type,name,enabled,scope_type,scope_folder_ids,created_by,source_type,source_deployment_id)
      VALUES ('metadata-bot','editor','ai-agent','Disabled fictional deployment',false,
        'investigation','["case"]','editor','caddy-agent','deployment')`;
  });
  afterEach(async () => { await database?.close(); });

  it.each(['register', 'unregister'])('rechecks revoked membership after %s waits on the common policy lock', async operation => {
    const before = await database.sql`SELECT * FROM bot_configs ORDER BY id`;
    let request!: Response | Promise<Response>;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      request = app.request(`/agents/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation === 'register' ? {
          investigationId: 'case', deployments: [{ deploymentId: 'deployment', order: 0,
            profile: { id: 'profile', name: 'Fictional observer', role: 'observer', systemPrompt: 'Synthetic fixture', policy: {} } }],
        } : { deploymentIds: ['deployment'] }) });
      await vi.waitFor(async () => {
        const waiting = await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query ILIKE '%sync_clock%' AND query ILIKE '%FOR UPDATE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
      await tx`DELETE FROM investigation_members WHERE id='editor-member'`;
    });
    expect((await request).status).toBe(403);
    expect(await database.sql`SELECT * FROM bot_configs ORDER BY id`).toEqual(before);
    expect(state.unload).not.toHaveBeenCalled();
  });
});
