import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { scratchDatabase, type ScratchDatabase } from './database.js';
import { applyCurrentMigrations } from './migrations.js';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/index.js', () => ({ db: new Proxy({}, { get(_target, property) {
  const database = state.db as Record<PropertyKey, unknown>;
  const value = database[property];
  return typeof value === 'function' ? value.bind(database) : value;
} }) }));

import feedRoutes from '../src/routes/caddyshack.js';
import userRoutes from '../src/routes/users.js';
import notificationRoutes from '../src/routes/notifications.js';
import { requireAuth } from '../src/middleware/auth.js';
import { withCurrentFeedAccess, type FeedVariables } from '../src/middleware/feed-access.js';
import { createTokenPair } from '../src/services/session-service.js';
import { createNotification } from '../src/services/notification-service.js';
import { processPush } from '../src/services/sync-service.js';
import { BotExecutionContext } from '../src/bots/bot-context.js';
import type { BotContext } from '../src/bots/types.js';
import { broadcastToUser, handleWSConnection, handleWSMessage, handleWSClose } from '../src/ws/handler.js';
import type { WSContext } from 'hono/ws';

describe('current feed and bot write authorization in PostgreSQL', () => {
  let database: ScratchDatabase;
  let app: Hono<{ Variables: FeedVariables }>;
  let tokens: Record<string, string>;
  beforeAll(() => {
    const keys = generateKeyPairSync('ed25519');
    process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    process.env.JWT_PUBLIC_KEY = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  });
  beforeEach(async () => {
    database = await scratchDatabase({ maxConnections: 4 });
    state.db = database.db;
    await applyCurrentMigrations(database);
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role) VALUES
      ('owner','owner@example.invalid','Fictional owner','fixture','analyst'),
      ('author','author@example.invalid','Fictional author','fixture','analyst'),
      ('other','other@example.invalid','Fictional outsider','fixture','analyst'),
      ('bot-user','bot@threatcaddy.internal','Fictional bot','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_by,updated_by,created_at,updated_at) VALUES
      ('case-a','Fictional case A','owner','owner',now(),now()),
      ('case-b','Fictional case B','other','other',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role) VALUES
      ('owner-a','case-a','owner','owner'),('author-a','case-a','author','editor'),
      ('bot-a','case-a','bot-user','editor'),('other-b','case-b','other','owner')`;
    await database.sql`INSERT INTO posts (id,author_id,content,folder_id) VALUES
      ('private-post','author','Fictional private post','case-a'),
      ('private-second','author','Fictional other thread','case-a'),
      ('public-post','author','Fictional public post',null)`;
    await database.sql`INSERT INTO notes (id,title,content,folder_id,created_by,updated_by,created_at,updated_at)
      VALUES ('note-a','Fictional note','Original fixture body','case-a','owner','owner',now(),now())`;
    await database.sql`INSERT INTO bot_configs (id,user_id,type,name,enabled,capabilities,scope_type,scope_folder_ids)
      VALUES ('fixture-bot','bot-user','enrichment','Fictional bot',true,'["create_entities","update_entities","post_to_feed"]','investigation','["case-a"]')`;
    tokens = {};
    for (const user of ['owner', 'author', 'other']) tokens[user] = (await createTokenPair(user)).accessToken;
    app = new Hono<{ Variables: FeedVariables }>();
    app.route('/feed', feedRoutes);
    app.route('/users', userRoutes);
    app.route('/notifications', notificationRoutes);
  });
  afterEach(async () => { await database?.close(); });

  async function request(user: string, path: string, method = 'GET', body?: unknown) {
    return app.request(path, { method, headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  function bot(): BotExecutionContext {
    const context: BotContext = {
      botConfig: { id: 'fixture-bot', userId: 'bot-user', type: 'enrichment', name: 'Fictional bot', description: '',
        enabled: true, triggers: {}, config: {}, capabilities: ['create_entities', 'update_entities', 'post_to_feed'],
        allowedDomains: [], scopeType: 'investigation', scopeFolderIds: ['case-a'], rateLimitPerHour: 10,
        rateLimitPerDay: 100, lastRunAt: null, lastError: null, runCount: 0, errorCount: 0,
        createdBy: 'owner', createdAt: new Date(), updatedAt: new Date() },
      botUserId: 'bot-user', runId: 'fixture-run', trigger: 'manual', signal: new AbortController().signal,
      entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [],
    };
    return new BotExecutionContext(context);
  }

  async function waitForWriter() {
    await vi.waitFor(async () => {
      const waiting = await database.sql`SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%sync_clock%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
  }

  it('denies a removed author editing, deleting or reacting to their former private post', async () => {
    await database.sql`DELETE FROM investigation_members WHERE id='author-a'`;
    for (const [method, path, body] of [
      ['PATCH', '/feed/posts/private-post', { content: 'Must not persist' }],
      ['DELETE', '/feed/posts/private-post', undefined],
      ['POST', '/feed/posts/private-post/reactions', { emoji: 'x' }],
      ['DELETE', '/feed/posts/private-post/reactions/x', undefined],
    ] as const) expect([403, 404]).toContain((await request('author', path, method, body)).status);
    expect(await database.sql`SELECT content,deleted FROM posts WHERE id='private-post'`).toEqual([
      { content: 'Fictional private post', deleted: false },
    ]);
    expect(await database.sql`SELECT * FROM reactions`).toHaveLength(0);
    expect(await database.sql`SELECT * FROM notifications`).toHaveLength(0);
  });

  it('rechecks membership when an already-authenticated feed mutation waits behind revocation', async () => {
    let queued!: Promise<Response>;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      queued = request('author', '/feed/posts/private-post', 'PATCH', { content: 'Must not persist' });
      await waitForWriter();
      await tx`DELETE FROM investigation_members WHERE id='author-a'`;
    });
    expect([403, 404]).toContain((await queued).status);
    expect((await database.sql`SELECT content FROM posts WHERE id='private-post'`)[0].content).toBe('Fictional private post');
  });

  it('rechecks a revoked session after waiting for the feed policy lock', async () => {
    let queued!: Promise<Response>;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      queued = request('author', '/feed/posts/public-post', 'PATCH', { content: 'Must not persist' });
      await waitForWriter();
      await tx`DELETE FROM sessions WHERE user_id='author'`;
    });
    expect((await queued).status).toBe(403);
    expect((await database.sql`SELECT content FROM posts WHERE id='public-post'`)[0].content).toBe('Fictional public post');
  });

  it('allows current members to reply/react but rejects a different-thread target without notifications', async () => {
    const invalid = await request('author', '/feed/posts', 'POST', { content: 'Fixture reply', folderId: 'case-a',
      parentId: 'private-post', replyToId: 'private-second' });
    expect(invalid.status).toBe(400);
    expect(await database.sql`SELECT * FROM notifications`).toHaveLength(0);
    const valid = await request('owner', '/feed/posts', 'POST', { content: 'Fixture reply', folderId: 'case-a', parentId: 'private-post' });
    expect(valid.status).toBe(201);
    expect((await valid.json()).parentId).toBe('private-post');
    expect((await request('owner', '/feed/posts/private-post/reactions', 'POST', { emoji: 'x' })).status).toBe(201);
    expect((await request('owner', '/feed/posts/private-post/reactions', 'POST', { emoji: 'x' })).status).toBe(409);
    expect(await database.sql`SELECT * FROM notifications WHERE user_id='author'`).toHaveLength(2);
  });

  it('does not expose legacy folderless private replies through detail, likes, profile or notifications', async () => {
    await database.sql`INSERT INTO posts (id,author_id,content,parent_id,folder_id)
      VALUES ('legacy-reply','author','Fictional retained private reply','private-post',null)`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji) VALUES ('legacy-like','legacy-reply','author','x')`;
    await database.sql`INSERT INTO notifications (id,user_id,type,post_id,message)
      VALUES ('legacy-notification','other','reaction','legacy-reply','Fictional private notification')`;
    expect((await request('other', '/feed/posts/legacy-reply')).status).toBe(404);
    expect((await request('other', '/feed/posts/legacy-reply/reactions', 'POST', { emoji: 'x' })).status).toBe(404);
    for (const path of ['/users/author/feed', '/users/author/likes', '/notifications']) {
      const response = await request('other', path);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain('legacy-');
    }
  });

  it('requires root editor access to change a legacy folderless reply, and scopes its notification', async () => {
    await database.sql`INSERT INTO posts (id,author_id,content,parent_id,folder_id)
      VALUES ('legacy-reply','author','Fictional private reply','private-post',null)`;
    await database.sql`UPDATE investigation_members SET role='viewer' WHERE id='author-a'`;
    expect((await request('author', '/feed/posts/legacy-reply')).status).toBe(200);
    expect((await request('author', '/feed/posts/legacy-reply', 'PATCH', { content: 'Must not persist' })).status).toBe(403);
    expect((await request('author', '/feed/posts/legacy-reply', 'DELETE')).status).toBe(403);
    expect(await createNotification({ userId: 'author', type: 'reaction', postId: 'legacy-reply', message: 'Fictional reply notification' }))
      .toMatchObject({ folderId: 'case-a' });
  });

  it('hides malformed legacy replyTo-only records without deleting recoverable content', async () => {
    await database.sql`INSERT INTO posts (id,author_id,content,reply_to_id,folder_id)
      VALUES ('malformed-reply','author','Fictional recoverable reply','private-post',null)`;
    expect((await request('other', '/feed/posts/malformed-reply')).status).toBe(404);
    expect(JSON.stringify(await (await request('other', '/feed')).json())).not.toContain('malformed-reply');
    expect(await database.sql`SELECT id FROM posts WHERE id='malformed-reply'`).toHaveLength(1);
  });

  it('rechecks private notification scope at websocket delivery after membership revocation', async () => {
    const socket = { send: vi.fn(), close: vi.fn(), readyState: 1 } as unknown as WSContext;
    handleWSConnection(socket);
    try {
      await handleWSMessage(socket, JSON.stringify({ type: 'auth', token: tokens.author }));
      vi.mocked(socket.send).mockClear();
      await broadcastToUser('author', { type: 'notification', notification: { message: 'Visible without a subscription' } }, ['case-a']);
      expect(vi.mocked(socket.send).mock.calls.some(([message]) => String(message).includes('Visible without a subscription'))).toBe(true);
      vi.mocked(socket.send).mockClear();
      await database.sql`DELETE FROM investigation_members WHERE id='author-a'`;
      await broadcastToUser('author', { type: 'notification', notification: { message: 'Must not deliver' } }, ['case-a']);
      expect(vi.mocked(socket.send).mock.calls.some(([message]) => String(message).includes('Must not deliver'))).toBe(false);
    } finally { handleWSClose(socket); }
  });

  it('hides deleted-investigation feed/profile/notifications without deleting retained records', async () => {
    await database.sql`INSERT INTO notifications (id,user_id,type,post_id,message)
      VALUES ('old-notification','author','reaction','private-post','Fictional private notification')`;
    await database.sql`UPDATE folders SET deleted_at=now() WHERE id='case-a'`;
    expect((await request('author', '/feed?folderId=case-a')).status).toBe(403);
    expect((await request('author', '/feed/posts/private-post')).status).toBe(404);
    expect((await request('author', '/notifications')).status).toBe(200);
    expect(await (await request('author', '/notifications')).json()).toEqual([]);
    expect(await createNotification({ userId: 'author', type: 'reaction', postId: 'private-post', message: 'Must not notify' })).toBeNull();
    expect(await database.sql`SELECT * FROM posts WHERE id='private-post'`).toHaveLength(1);
  });

  it('projects only accessible investigation activity and never raw global security details', async () => {
    await database.sql`INSERT INTO activity_log (id,user_id,category,action,detail,folder_id) VALUES
      ('auth-entry','author','auth','login.failed','Fictional sensitive security detail',null),
      ('admin-entry','author','admin','user.update','Fictional sensitive admin detail',null),
      ('note-entry','author','note','note.update','Raw investigation details','case-a')`;
    expect(await (await request('other', '/users/author/activity')).json()).toEqual([]);
    const visible = await (await request('owner', '/users/author/activity')).json();
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ id: 'note-entry', detail: '' });
    expect(JSON.stringify(visible)).not.toContain('sensitive');
  });

  it('rolls back a failed feed handler and does not emit its deferred side effect', async () => {
    const effect = vi.fn();
    app.post('/rollback', requireAuth, withCurrentFeedAccess, async c => {
      await c.get('feedDb').execute(sql`INSERT INTO posts (id,author_id,content) VALUES ('rollback-post','author','Transient')`);
      c.get('afterFeedCommit')(effect);
      throw new Error('Synthetic handler failure');
    });
    app.onError((_error, c) => c.json({ error: 'Synthetic handler failure' }, 500));
    expect((await request('author', '/rollback', 'POST')).status).toBe(500);
    expect(await database.sql`SELECT * FROM posts WHERE id='rollback-post'`).toHaveLength(0);
    expect(effect).not.toHaveBeenCalled();
  });

  it('fails closed if the singleton policy lock is missing', async () => {
    await database.sql`DELETE FROM sync_clock WHERE id=1`;
    app.onError((_error, c) => c.json({ error: 'Fixture lock unavailable' }, 500));
    expect((await request('author', '/feed/posts/public-post', 'PATCH', { content: 'Must not persist' })).status).toBe(500);
    expect((await database.sql`SELECT content FROM posts WHERE id='public-post'`)[0].content).toBe('Fictional public post');
  });

  it('checks the actual row scope after a concurrent move, not the bot preflight lookup', async () => {
    let result!: Promise<unknown>;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      result = bot().updateEntity('notes', 'note-a', { content: 'Must not persist' }).catch(error => error);
      await waitForWriter();
      await tx`UPDATE notes SET folder_id='case-b' WHERE id='note-a'`;
    });
    expect(await result).toBeInstanceOf(Error);
    expect((await database.sql`SELECT content,folder_id FROM notes WHERE id='note-a'`)[0])
      .toEqual({ content: 'Original fixture body', folder_id: 'case-b' });
  });

  it.each(['null-folder', 'disabled', 'capability-removed', 'member-removed'] as const)('rejects bot writes after %s', async reason => {
    const execution = bot();
    if (reason === 'disabled') await database.sql`UPDATE bot_configs SET enabled=false WHERE id='fixture-bot'`;
    if (reason === 'capability-removed') await database.sql`UPDATE bot_configs SET capabilities='[]' WHERE id='fixture-bot'`;
    if (reason === 'member-removed') await database.sql`DELETE FROM investigation_members WHERE id='bot-a'`;
    await expect(execution.updateEntity('notes', 'note-a', reason === 'null-folder'
      ? { folderId: null } : { content: 'Must not persist' })).rejects.toThrow();
    expect((await database.sql`SELECT content,folder_id FROM notes WHERE id='note-a'`)[0])
      .toEqual({ content: 'Original fixture body', folder_id: 'case-a' });
  });

  it('allows a live authorized bot update and feed post without outbound tools', async () => {
    const execution = bot();
    await execution.updateEntity('notes', 'note-a', { content: 'Authorized fixture edit' });
    const id = await execution.postToFeed('Authorized fixture post', 'case-a');
    expect((await database.sql`SELECT content FROM notes WHERE id='note-a'`)[0].content).toBe('Authorized fixture edit');
    expect(await database.sql`SELECT id FROM posts WHERE id=${id}`).toHaveLength(1);
  });

  it('rolls back awaited entity writes and sync history when cancellation arrives before commit', async () => {
    const controller = new AbortController();
    const beforeClock = await database.sql`SELECT cursor FROM sync_clock WHERE id=1`;
    const beforeHistory = await database.sql`SELECT cursor FROM sync_changes ORDER BY cursor`;
    await expect(processPush([{ table: 'notes', op: 'put', entityId: 'note-a',
      clientVersion: 1, data: { content: 'Must roll back' } }], 'owner', {
      authorize: true, beforeCommit: () => { controller.abort(); controller.signal.throwIfAborted(); },
    })).rejects.toThrow();
    expect((await database.sql`SELECT content,version FROM notes WHERE id='note-a'`)[0])
      .toEqual({ content: 'Original fixture body', version: 1 });
    expect(await database.sql`SELECT cursor FROM sync_clock WHERE id=1`).toEqual(beforeClock);
    expect(await database.sql`SELECT cursor FROM sync_changes ORDER BY cursor`).toEqual(beforeHistory);
  });
});
