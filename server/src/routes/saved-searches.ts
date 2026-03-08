import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { eq, or, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

const savedSearchSchema = z.object({
  name: z.string().min(1).max(200),
  query: z.string().min(1).max(5000),
  filters: z.record(z.unknown()).optional().default({}),
  isShared: z.boolean().optional().default(false),
});

const app = new Hono();

// All saved-search routes require auth
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('*', requireAuth as any);

// ─── List saved searches (own + shared) ─────────────────────────

app.get('/', requireRole('admin', 'analyst', 'viewer'), async (c) => {
  const user = c.get('user' as never) as { id: string };

  const rows = await db
    .select()
    .from(schema.savedSearches)
    .where(
      or(
        eq(schema.savedSearches.userId, user.id),
        eq(schema.savedSearches.isShared, true),
      ),
    )
    .orderBy(desc(schema.savedSearches.createdAt));

  return c.json({
    searches: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      query: r.query,
      filters: r.filters,
      isShared: r.isShared,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

// ─── Create saved search ────────────────────────────────────────

app.post('/', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = savedSearchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid saved search data', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const id = nanoid();
  const now = new Date();

  await db.insert(schema.savedSearches).values({
    id,
    userId: user.id,
    name: parsed.data.name,
    query: parsed.data.query,
    filters: parsed.data.filters,
    isShared: parsed.data.isShared,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({
    search: {
      id,
      userId: user.id,
      name: parsed.data.name,
      query: parsed.data.query,
      filters: parsed.data.filters,
      isShared: parsed.data.isShared,
      createdAt: now,
      updatedAt: now,
    },
  }, 201);
});

// ─── Update saved search ────────────────────────────────────────

app.put('/:id', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(schema.savedSearches)
    .where(eq(schema.savedSearches.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Saved search not found' }, 404);
  }

  // Only the owner can update
  if (rows[0].userId !== user.id) {
    return c.json({ error: 'Not authorized to update this saved search' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = savedSearchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid saved search data', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const now = new Date();
  await db
    .update(schema.savedSearches)
    .set({
      name: parsed.data.name,
      query: parsed.data.query,
      filters: parsed.data.filters,
      isShared: parsed.data.isShared,
      updatedAt: now,
    })
    .where(eq(schema.savedSearches.id, id));

  return c.json({
    search: {
      id,
      userId: user.id,
      name: parsed.data.name,
      query: parsed.data.query,
      filters: parsed.data.filters,
      isShared: parsed.data.isShared,
      createdAt: rows[0].createdAt,
      updatedAt: now,
    },
  });
});

// ─── Delete saved search ────────────────────────────────────────

app.delete('/:id', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user' as never) as { id: string; role: string };
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(schema.savedSearches)
    .where(eq(schema.savedSearches.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Saved search not found' }, 404);
  }

  // Only owner or admin can delete
  if (rows[0].userId !== user.id && user.role !== 'admin') {
    return c.json({ error: 'Not authorized to delete this saved search' }, 403);
  }

  await db.delete(schema.savedSearches).where(eq(schema.savedSearches.id, id));

  return c.json({ ok: true });
});

export default app;
