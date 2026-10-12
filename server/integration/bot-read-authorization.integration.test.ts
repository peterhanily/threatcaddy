import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));

import { BotExecutionContext } from '../src/bots/bot-context.js';
import type { BotConfig, BotContext } from '../src/bots/types.js';
import { withBotReadPolicy } from '../src/services/bot-read-policy.js';
import { notes } from '../src/db/schema.js';

describe('current bot read authorization in PostgreSQL', () => {
  let database: ScratchDatabase;
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Fictional owner','fixture','analyst'),
      ('bot-user','bot@threatcaddy.internal','Fictional read-only bot','fixture','viewer')`;
    await database.sql`INSERT INTO folders (id,name,created_at,updated_at) VALUES
      ('case-a','Fictional A',now(),now()),('case-b','Fictional B',now(),now()),
      ('case-deleted','Retained fictional case',now(),now())`;
    await database.sql`UPDATE folders SET deleted_at=now() WHERE id='case-deleted'`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('bot-a','case-a','bot-user','viewer'),('bot-b','case-b','bot-user','viewer')`;
    await database.sql`INSERT INTO bot_configs (id,user_id,type,name,enabled,capabilities,scope_type,scope_folder_ids)
      VALUES ('read-bot','bot-user','enrichment','Fictional reader',true,
        '["read_entities","cross_investigation"]','investigation','["case-a"]')`;
    await database.sql`INSERT INTO notes (id,title,content,folder_id,created_at,updated_at) VALUES
      ('note-a','Fictional note A','Readable A','case-a',now(),now()),
      ('note-b','Fictional note B','Readable B','case-b',now(),now()),
      ('note-deleted','Retained fictional note','Retained body','case-deleted',now(),now()),
      ('note-missing','Detached fictional note','Detached body','missing-case',now(),now()),
      ('note-global','Fictional global note','Global body',null,now(),now()),
      ('note-empty','Fictional legacy global note','Global body','',now(),now()),
      ('note-tombstone','Independently deleted note','Deleted body','case-a',now(),now())`;
    await database.sql`UPDATE notes SET deleted_at=now() WHERE id='note-tombstone'`;
    await database.sql`INSERT INTO tasks (id,title,folder_id,created_at,updated_at)
      SELECT 'task-' || suffix,'Fictional task',folder_id,now(),now()
      FROM (VALUES ('a','case-a'),('b','case-b'),('deleted','case-deleted')) AS fixture(suffix,folder_id)`;
    await database.sql`INSERT INTO standalone_iocs (id,type,value,folder_id,created_at,updated_at)
      SELECT 'ioc-' || suffix,'domain',suffix || '.example.invalid',folder_id,now(),now()
      FROM (VALUES ('a','case-a'),('b','case-b'),('deleted','case-deleted'),('missing','missing-case'),('global',null)) AS fixture(suffix,folder_id)`;
    await database.sql`INSERT INTO timeline_events (id,title,timestamp,event_type,timeline_id,folder_id,created_at,updated_at)
      SELECT 'event-' || suffix,'Fictional event',now(),'other','fixture-timeline',folder_id,now(),now()
      FROM (VALUES ('a','case-a'),('b','case-b'),('deleted','case-deleted')) AS fixture(suffix,folder_id)`;
  });
  afterEach(async () => { await database?.close(); });

  function context(overrides: Partial<BotConfig> = {}, signal = new AbortController().signal): BotContext {
    return {
      botConfig: { id: 'read-bot', userId: 'bot-user', type: 'enrichment', name: 'Fictional reader', description: '',
        enabled: true, triggers: {}, config: {}, capabilities: ['read_entities', 'cross_investigation'], allowedDomains: [],
        scopeType: 'investigation', scopeFolderIds: ['case-a', 'case-b', 'case-deleted'], rateLimitPerHour: 10,
        rateLimitPerDay: 100, lastRunAt: null, lastError: null, runCount: 0, errorCount: 0,
        createdBy: 'owner', createdAt: new Date(), updatedAt: new Date(), ...overrides },
      botUserId: 'bot-user', runId: 'fictional-read-run', trigger: 'manual', signal,
      entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [],
    };
  }
  const ids = (rows: Record<string, unknown>[]) => rows.map(row => row.id).sort();
  async function waitForReader() {
    await vi.waitFor(async () => {
      const waiting = await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query ILIKE '%sync_clock%' AND query ILIKE '%FOR SHARE%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
  }

  it('allows current scoped viewer membership across every read method', async () => {
    const bot = new BotExecutionContext(context());
    expect(ids(await bot.searchNotes('case-a', 'Fictional'))).toEqual(['note-a']);
    expect(await bot.readNote('note-a')).toMatchObject({ content: 'Readable A' });
    expect(await bot.readNote('note-tombstone')).toBeNull();
    expect(ids(await bot.listIOCs('case-a'))).toEqual(['ioc-a']);
    expect([...(await bot.listIOCsBatch(['case-a', 'case-b'])).keys()]).toEqual(['case-a']);
    expect(ids(await bot.listTasks('case-a'))).toEqual(['task-a']);
    expect([...(await bot.listTasksBatch(['case-a', 'case-b'])).keys()]).toEqual(['case-a']);
    expect(ids(await bot.listTimelineEvents('case-a'))).toEqual(['event-a']);
    expect(await bot.getInvestigation('case-a')).toMatchObject({ id: 'case-a' });
    expect(ids(await bot.listInvestigations())).toEqual(['case-a']);
    expect(ids(await bot.searchAcrossInvestigations('example.invalid'))).toEqual(['ioc-a']);
  });

  it.each(['deleted folder', 'removed membership'])('hides retained content after a %s across every read method', async reason => {
    const bot = new BotExecutionContext(context());
    if (reason === 'deleted folder') await database.sql`UPDATE folders SET deleted_at=now() WHERE id='case-a'`;
    else await database.sql`DELETE FROM investigation_members WHERE id='bot-a'`;
    expect(await bot.searchNotes('case-a', '')).toEqual([]);
    expect(await bot.readNote('note-a')).toBeNull();
    expect(await bot.listIOCs('case-a')).toEqual([]);
    expect((await bot.listIOCsBatch(['case-a'])).size).toBe(0);
    expect(await bot.listTasks('case-a')).toEqual([]);
    expect((await bot.listTasksBatch(['case-a'])).size).toBe(0);
    expect(await bot.listTimelineEvents('case-a')).toEqual([]);
    expect(await bot.getInvestigation('case-a')).toBeNull();
    expect(await bot.listInvestigations()).toEqual([]);
    expect(await bot.searchAcrossInvestigations('example.invalid')).toEqual([]);
    expect(await database.sql`SELECT id FROM notes WHERE id='note-a'`).toHaveLength(1);
  });

  it('intersects current and run grants and never broadens a scoped run to global', async () => {
    await database.sql`UPDATE bot_configs SET scope_folder_ids='["case-b"]' WHERE id='read-bot'`;
    const bot = new BotExecutionContext(context());
    expect(ids(await bot.listInvestigations())).toEqual(['case-b']);
    expect([...(await bot.listTasksBatch(['case-a', 'case-b'])).keys()]).toEqual(['case-b']);
    expect(await bot.readNote('note-a')).toBeNull();
    expect(await bot.readNote('note-global')).toBeNull();
    await database.sql`UPDATE bot_configs SET scope_type='global' WHERE id='read-bot'`;
    const scopedRun = new BotExecutionContext(context({ scopeFolderIds: ['case-a'] }));
    expect(ids(await scopedRun.listInvestigations())).toEqual(['case-a']);
    expect(await scopedRun.readNote('note-global')).toBeNull();
  });

  it('retains global live access without membership only when both grants are global', async () => {
    const bot = new BotExecutionContext(context({ scopeType: 'global', scopeFolderIds: [] }));
    expect(await bot.readNote('note-global')).toBeNull();
    expect(await bot.readNote('note-b')).toBeNull();
    await database.sql`UPDATE bot_configs SET scope_type='global' WHERE id='read-bot'`;
    await database.sql`DELETE FROM investigation_members WHERE user_id='bot-user'`;
    expect(ids(await bot.listInvestigations())).toEqual(['case-a', 'case-b']);
    expect(await bot.readNote('note-global')).toMatchObject({ id: 'note-global' });
    expect(await bot.readNote('note-empty')).toMatchObject({ id: 'note-empty' });
    expect(await bot.readNote('note-b')).toMatchObject({ id: 'note-b' });
    expect(await bot.readNote('note-deleted')).toBeNull();
    expect(await bot.readNote('note-missing')).toBeNull();
    expect(ids(await bot.searchAcrossInvestigations('example.invalid'))).toEqual(['ioc-a', 'ioc-b', 'ioc-global']);
  });

  it.each(['disabled', 'inactive', 'removed capability', 'wrong account'])('rejects a current %s policy before returning data', async reason => {
    const bot = new BotExecutionContext(context());
    if (reason === 'disabled') await database.sql`UPDATE bot_configs SET enabled=false WHERE id='read-bot'`;
    if (reason === 'inactive') await database.sql`UPDATE users SET active=false WHERE id='bot-user'`;
    if (reason === 'removed capability') await database.sql`UPDATE bot_configs SET capabilities='[]' WHERE id='read-bot'`;
    if (reason === 'wrong account') await database.sql`UPDATE bot_configs SET user_id='owner' WHERE id='read-bot'`;
    await expect(bot.readNote('note-a')).rejects.toThrow('no longer authorized');
    await expect(bot.searchAcrossInvestigations('example.invalid')).rejects.toThrow('no longer authorized');
  });

  it('applies SQL visibility before a limit, not by filtering an already limited result', async () => {
    await database.sql`UPDATE bot_configs SET scope_folder_ids='["case-b"]' WHERE id='read-bot'`;
    const rows = await withBotReadPolicy(context(), 'read_entities', (tx, visibleScope) => tx.select({ id: notes.id })
      .from(notes).where(visibleScope(notes.folderId)).orderBy(notes.id).limit(1));
    expect(rows).toEqual([{ id: 'note-b' }]);
  });

  it.each(['membership', 'folder', 'grant'])('rechecks %s changed while the read waits for the policy lock', async reason => {
    const bot = new BotExecutionContext(context());
    let queued: Promise<Record<string, unknown> | null> | undefined;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      queued = bot.readNote('note-a');
      await waitForReader();
      if (reason === 'membership') await tx`DELETE FROM investigation_members WHERE id='bot-a'`;
      if (reason === 'folder') await tx`UPDATE folders SET deleted_at=now() WHERE id='case-a'`;
      if (reason === 'grant') await tx`UPDATE bot_configs SET scope_folder_ids='["case-b"]' WHERE id='read-bot'`;
    });
    expect(await queued).toBeNull();
  });

  it('does not return a late read after cancellation and fails closed without a clock', async () => {
    const controller = new AbortController();
    await expect(withBotReadPolicy(context({}, controller.signal), 'read_entities', async (tx, visibleScope) => {
      const rows = await tx.select().from(notes).where(visibleScope(notes.folderId));
      controller.abort();
      return rows;
    })).rejects.toThrow(/abort/i);
    await database.sql`DELETE FROM sync_clock WHERE id=1`;
    await expect(new BotExecutionContext(context()).readNote('note-a')).rejects.toThrow('authorization lock');
  });
});
