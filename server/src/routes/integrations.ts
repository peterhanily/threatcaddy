import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logActivity } from '../services/audit-service.js';
import { compileIntegrationPlan, INTEGRATION_LIMITS, isSafeTeamTemplateId } from '../lib/integration-plan.js';
import { boundedValidationDetails, isRequestObject } from '../lib/request-validation.js';

const integrationTemplateSchema = z.object({
  id: z.string().refine(id => id === '' || isSafeTeamTemplateId(id), 'Invalid template ID').optional(),
  name: z.string().min(1).max(200),
  version: z.string().optional(),
  description: z.string().max(2000).optional(),
  category: z.string().optional(),
  steps: z.array(z.object({}).passthrough()).max(INTEGRATION_LIMITS.steps),
  outputs: z.union([z.array(z.object({}).passthrough()).max(INTEGRATION_LIMITS.collectionItems), z.object({}).passthrough()]),
  triggers: z.array(z.object({}).passthrough()).max(INTEGRATION_LIMITS.collectionItems).optional().default([]),
}).passthrough();

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
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!isRequestObject(body)) return c.json({ error: 'Invalid JSON body' }, 400);
  const rawTemplate = body.template;
  if (!isRequestObject(rawTemplate)) {
    return c.json({ error: 'Missing or invalid "template" field' }, 400);
  }

  // These checks precede both Zod element validation and compiler traversal.
  for (const [field, maximum] of [
    ['steps', INTEGRATION_LIMITS.steps],
    ['outputs', INTEGRATION_LIMITS.collectionItems],
    ['triggers', INTEGRATION_LIMITS.collectionItems],
  ] as const) {
    const collection = rawTemplate[field];
    if (Array.isArray(collection) && collection.length > maximum) {
      return c.json({ error: 'Invalid template', details: boundedValidationDetails([
        { path: [field], message: `At most ${maximum} ${field} are allowed` },
      ]).fieldErrors }, 400);
    }
  }

  const parsed = integrationTemplateSchema.safeParse(rawTemplate);
  if (!parsed.success) {
    return c.json({ error: 'Invalid template', details: boundedValidationDetails(parsed.error.issues).fieldErrors }, 400);
  }

  const template = parsed.data as Record<string, unknown>;
  const name = template.name as string;
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) {
    return c.json({ error: 'Description must be a string of at most 2000 characters' }, 400);
  }
  const description = (template.description as string) || (body.description as string) || '';
  const id = (template.id as string) || nanoid();

  // Ensure the template has an ID
  template.id = id;

  try {
    compileIntegrationPlan(template);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid integration template' }, 400);
  }

  const inserted = await db.insert(schema.integrationTemplates).values({
    id,
    name,
    description,
    template,
    sharedBy: user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing({ target: schema.integrationTemplates.id }).returning({ id: schema.integrationTemplates.id });
  if (!inserted.length) return c.json({ error: 'A template with this ID is already shared. Import a separate copy to share a different definition.', code: 'TEMPLATE_ALREADY_SHARED' }, 409);

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
