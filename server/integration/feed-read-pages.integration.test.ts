import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema.js';
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
import { createTokenPair } from '../src/services/session-service.js';
import type { FeedVariables } from '../src/middleware/feed-access.js';
import { loadPostReactions, loadReplyPage } from '../src/services/feed-read.js';

interface FeedPost {
  id: string;
  replies: Array<{ id: string; replyToAuthorName?: string }>;
  reactions: Record<string, { count: number; userIds: string[]; reactedByMe?: boolean; userIdsScope?: string; userIdsComplete?: boolean }>;
  replyPage?: { total: number; limit: number; hasMore: boolean; nextCursor: string | null };
}

describe('opt-in feed read bounds and legacy compatibility in PostgreSQL', () => {
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
      ('viewer','viewer@example.invalid','Fictional viewer','fixture','analyst'),
      ('outsider','outsider@example.invalid','Fictional outsider','fixture','analyst')`;
    await database.sql`INSERT INTO folders (id,name,created_by,updated_by,created_at,updated_at)
      VALUES ('case-a','Fictional case','owner','owner',now(),now())`;
    await database.sql`INSERT INTO investigation_members (id,folder_id,user_id,role)
      VALUES ('owner-a','case-a','owner','owner'),('viewer-a','case-a','viewer','viewer')`;
    await database.sql`INSERT INTO posts (id,author_id,content,folder_id) VALUES
      ('root','owner','Fictional root','case-a'),('public','owner','Fictional public',null)`;
    tokens = {};
    for (const id of ['owner', 'viewer', 'outsider']) tokens[id] = (await createTokenPair(id)).accessToken;
    app = new Hono<{ Variables: FeedVariables }>();
    app.route('/feed', feedRoutes); app.route('/users', userRoutes);
  });
  afterEach(async () => { await database?.close(); });
  const request = async (path: string, user = 'viewer') => app.request(path, { headers: { Authorization: `Bearer ${tokens[user]}` } });
  async function replies(amount: number) {
    await database.sql`INSERT INTO posts (id,author_id,content,folder_id,parent_id,reply_to_id,created_at)
      SELECT 'reply-' || lpad(n::text,3,'0'),'owner','Fictional reply ' || n,'case-a','root','root',
        '2026-10-10 10:00:00.123456+00'::timestamptz FROM generate_series(1,${amount}) AS n`;
  }
  const pageURL = (cursor?: string) => '/feed/posts/root?replies=page&reactions=summary&limit=50'
    + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');

  it('returns all legacy replies, but opt-in pages preserve exact ties and total across50+25', async () => {
    await replies(75);
    const legacy = await (await request('/feed/posts/root')).json() as FeedPost;
    expect(legacy.replies).toHaveLength(75); expect(legacy.replyPage).toBeUndefined();
    const first = await (await request(pageURL())).json() as FeedPost;
    expect(first.replies).toHaveLength(50);
    expect(first.replyPage).toMatchObject({ total: 75, limit: 50, hasMore: true });
    expect(first.replyPage?.nextCursor).toBeTypeOf('string');
    const next = await (await request(pageURL(first.replyPage?.nextCursor || ''))).json() as FeedPost;
    expect(next.replies).toHaveLength(25);
    expect(next.replyPage).toEqual({ total: 75, limit: 50, hasMore: false, nextCursor: null });
    expect(new Set([...first.replies, ...next.replies].map(row => row.id)).size).toBe(75);
    expect(next.replies[0].id).toBe('reply-051');
  });

  it('resolves a target author from an earlier page without including that earlier reply again', async () => {
    await replies(51);
    await database.sql`UPDATE posts SET reply_to_id='reply-001' WHERE id='reply-051'`;
    const first = await (await request(pageURL())).json() as FeedPost;
    const second = await (await request(pageURL(first.replyPage?.nextCursor || ''))).json() as FeedPost;
    expect(second.replies).toEqual([expect.objectContaining({ id: 'reply-051', replyToAuthorName: 'Fictional owner' })]);
    await database.sql`UPDATE posts SET deleted=true WHERE id='reply-001'`;
    const afterDelete = await (await request(pageURL(first.replyPage?.nextCursor || ''))).json() as FeedPost;
    expect(afterDelete.replies[0].replyToAuthorName).toBeUndefined();
  });

  it('keeps legacy reactor lists but explicitly returns exact counts and only the viewer in summary mode', async () => {
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role)
      SELECT 'reactor-'||n,'reactor-'||n||'@example.invalid','Fictional reactor','fixture','analyst' FROM generate_series(1,60) AS n`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji)
      SELECT 'reaction-'||n,'root','reactor-'||n,'👍' FROM generate_series(1,60) AS n`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji) VALUES ('self','root','viewer','👍'),('only-other','root','owner','✅')`;
    const legacy = await (await request('/feed/posts/root')).json() as FeedPost;
    expect(legacy.reactions['👍'].count).toBe(61); expect(legacy.reactions['👍'].userIds).toHaveLength(61);
    expect(legacy.reactions['👍'].userIdsScope).toBeUndefined();
    const summary = await (await request(pageURL())).json() as FeedPost;
    expect(summary.reactions['👍']).toEqual({ count: 61, reactedByMe: true, userIds: ['viewer'], userIdsScope: 'viewer', userIdsComplete: false });
    expect(summary.reactions['✅']).toEqual({ count: 1, reactedByMe: false, userIds: [], userIdsScope: 'viewer', userIdsComplete: false });
    const feed = await (await request('/feed?folderId=case-a&reactions=summary')).json() as FeedPost[];
    expect(feed[0].reactions).toEqual(summary.reactions);
  });

  it('reauthorizes every page after membership or session revocation', async () => {
    await replies(51);
    const first = await (await request(pageURL())).json() as FeedPost;
    await database.sql`DELETE FROM investigation_members WHERE id='viewer-a'`;
    expect([403, 404]).toContain((await request(pageURL(first.replyPage?.nextCursor || ''))).status);
    await database.sql`DELETE FROM sessions WHERE user_id='owner'`;
    expect([401, 403]).toContain((await request(pageURL(), 'owner')).status);
  });

  it('reauthorizes a page queued behind committed membership revocation', async () => {
    let queued: Promise<Response> | undefined;
    await database.sql.begin(async tx => {
      await tx`SELECT id FROM sync_clock WHERE id=1 FOR UPDATE`;
      queued = request(pageURL());
      await vi.waitFor(async () => {
        const waiting = await database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query ILIKE '%sync_clock%'`;
        expect(waiting.length).toBeGreaterThan(0);
      });
      await tx`DELETE FROM investigation_members WHERE id='viewer-a'`;
    });
    expect(queued).toBeDefined();
    expect([403, 404]).toContain((await queued)?.status);
  });

  it('rejects cross-thread cursors and invalid limits and caps larger requests', async () => {
    await replies(51);
    const first = await (await request(pageURL())).json() as FeedPost;
    expect((await request('/feed/posts/public?replies=page&cursor=' + first.replyPage?.nextCursor)).status).toBe(400);
    expect((await request('/feed/posts/root?replies=page&limit=0')).status).toBe(400);
    const capped = await (await request('/feed/posts/root?replies=page&limit=100')).json() as FeedPost;
    expect(capped.replies).toHaveLength(50);
    expect((await request(pageURL(), 'outsider')).status).toBe(404);
  });

  it('applies visibility before the likes limit and does not duplicate posts for multiple emoji', async () => {
    await database.sql`INSERT INTO posts (id,author_id,content,created_at)
      SELECT 'public-'||lpad(n::text,3,'0'),'owner','Fictional public post',now()-n*interval '1 minute' FROM generate_series(1,60) AS n`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji)
      SELECT 'like-'||n,'public-'||lpad(n::text,3,'0'),'owner','👍' FROM generate_series(1,60) AS n`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji)
      VALUES ('another-emoji','public-001','owner','✅'),('private-like','root','owner','👍')`;
    const rows = await (await request('/users/owner/likes', 'outsider')).json() as Array<{ id: string }>;
    expect(rows).toHaveLength(50); expect(new Set(rows.map(row => row.id)).size).toBe(50);
    expect(rows[0].id).toBe('public-001'); expect(rows.at(-1)?.id).toBe('public-050');
    expect(rows.some(row => row.id === 'root')).toBe(false);
  });

  it('records actual bounded-page query plans against a modest synthetic history', async () => {
    await database.sql`INSERT INTO posts (id,author_id,content,folder_id,parent_id,reply_to_id,created_at)
      SELECT 'history-' || lpad(n::text,6,'0'),'owner','Fictional historical reply','case-a','root','root',
        '2026-10-10 10:00:00.123456+00'::timestamptz + n*interval '1 microsecond'
      FROM generate_series(1,2000) AS n`;
    await database.sql`INSERT INTO users (id,email,display_name,password_hash,role)
      SELECT 'reader-'||n,'reader-'||n||'@example.invalid','Fictional reader','fixture','analyst'
      FROM generate_series(1,2000) AS n`;
    await database.sql`INSERT INTO reactions (id,post_id,user_id,emoji)
      SELECT 'history-reaction-'||n,'root','reader-'||n,'👍' FROM generate_series(1,2000) AS n`;
    await database.sql`ANALYZE posts`;
    await database.sql`ANALYZE reactions`;
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const measured = drizzle(database.sql, { schema, logger: { logQuery(query, params) {
      if (query.startsWith('select ')) queries.push({ query, params });
    } } });
    const result = await measured.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM sync_clock WHERE id=1 FOR SHARE`);
      const page = await loadReplyPage(tx, { id: 'root', folderId: 'case-a', authorDisplayName: 'Fictional owner' }, 'viewer', { limit: 50 });
      const summary = await loadPostReactions(tx, ['root'], 'viewer', true);
      return { page, summary };
    });
    expect(result.page.replies).toHaveLength(50);
    expect(result.page.replyPage).toMatchObject({ total: 2000, hasMore: true });
    expect(result.summary.get('root')?.['👍']).toMatchObject({ count: 2000, userIds: [], userIdsScope: 'viewer' });
    expect(queries).toHaveLength(3);

    interface PlanNode { 'Node Type': string; 'Actual Rows': number; 'Actual Loops': number; Plans?: PlanNode[] }
    interface QueryPlan { Plan: PlanNode; 'Execution Time': number; 'Planning Time': number }
    const plans = [];
    for (const [index, query] of queries.entries()) {
      // Explain only the exact, parameterized SELECT emitted by our helpers;
      // neither caller input nor database credentials are written to evidence.
      const rows = await database.sql.unsafe<Array<{ 'QUERY PLAN': QueryPlan[] }>>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${query.query}`,
        query.params as Parameters<typeof database.sql.unsafe>[1],
      );
      const plan = rows[0]['QUERY PLAN'][0];
      const scans: Array<{ node: string; rows: number }> = [];
      const visit = (node: PlanNode) => {
        if (node['Node Type'].includes('Scan')) scans.push({ node: node['Node Type'], rows: node['Actual Rows'] * node['Actual Loops'] });
        node.Plans?.forEach(visit);
      };
      visit(plan.Plan);
      plans.push({ query: ['reply-page', 'visible-total', 'reaction-summary'][index],
        returnedRows: plan.Plan['Actual Rows'], scans,
        planningMs: plan['Planning Time'], executionMs: plan['Execution Time'] });
    }
    expect(plans.map(plan => plan.returnedRows)).toEqual([51, 1, 1]);
    // Timings are evidence, not machine-dependent pass/fail budgets. Counts
    // still scan visible history; this is not a claim of constant DB work.
    console.log('Synthetic feed query plans:', JSON.stringify({ replies: 2000, reactors: 2000, pageLimit: 50,
      pageBytes: Buffer.byteLength(JSON.stringify(result.page)), plans }));
  });
});
