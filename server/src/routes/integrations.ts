import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logActivity } from '../services/audit-service.js';

const app = new Hono();

// All integration routes require auth
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use('*', requireAuth as any);

// ─── List all shared templates ──────────────────────────────────

app.get('/templates', requireRole('admin', 'analyst', 'viewer'), async (c) => {
  const rows = await db
    .select()
    .from(schema.integrationTemplates)
    .orderBy(desc(schema.integrationTemplates.createdAt));

  return c.json({
    templates: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      template: r.template,
      sharedBy: r.sharedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

// ─── Get a single template ──────────────────────────────────────

app.get('/templates/:id', requireRole('admin', 'analyst', 'viewer'), async (c) => {
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(schema.integrationTemplates)
    .where(eq(schema.integrationTemplates.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Template not found' }, 404);
  }

  const r = rows[0];
  return c.json({
    template: {
      id: r.id,
      name: r.name,
      description: r.description,
      template: r.template,
      sharedBy: r.sharedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
  });
});

// ─── Share a template with the team ─────────────────────────────

app.post('/templates', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const template = body.template as Record<string, unknown> | undefined;
  if (!template || typeof template !== 'object') {
    return c.json({ error: 'Missing or invalid "template" field' }, 400);
  }

  const name = (template.name as string) || (body.name as string);
  if (!name || typeof name !== 'string') {
    return c.json({ error: 'Template must have a name' }, 400);
  }

  const description = (template.description as string) || (body.description as string) || '';
  const id = (template.id as string) || nanoid();

  // Ensure the template has an ID
  (template as Record<string, unknown>).id = id;

  await db.insert(schema.integrationTemplates).values({
    id,
    name,
    description,
    template,
    sharedBy: user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await logActivity({
    userId: user.id,
    category: 'integration',
    action: 'template.share',
    detail: `Shared integration template "${name}"`,
    itemId: id,
    itemTitle: name,
  }).catch(() => {});

  return c.json({
    template: {
      id,
      name,
      description,
      template,
      sharedBy: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }, 201);
});

// ─── Delete a shared template (admin only) ──────────────────────

app.delete('/templates/:id', requireRole('admin'), async (c) => {
  const user = c.get('user' as never) as { id: string };
  const id = c.req.param('id');

  const rows = await db
    .select({ id: schema.integrationTemplates.id, name: schema.integrationTemplates.name })
    .from(schema.integrationTemplates)
    .where(eq(schema.integrationTemplates.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Template not found' }, 404);
  }

  await db.delete(schema.integrationTemplates).where(eq(schema.integrationTemplates.id, id));

  await logActivity({
    userId: user.id,
    category: 'integration',
    action: 'template.delete',
    detail: `Deleted integration template "${rows[0].name}"`,
    itemId: id,
    itemTitle: rows[0].name,
  }).catch(() => {});

  return c.json({ ok: true });
});

export default app;
