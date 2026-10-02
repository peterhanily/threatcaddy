import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { processPush, pullChanges, pullCursorChanges, SyncReadError, SyncWriteValidationError, getSnapshot } from '../services/sync-service.js';
import { logActivityBatch } from '../services/audit-service.js';
import { broadcastToFolder } from '../ws/handler.js';
import { db } from '../db/index.js';
import { investigationMembers } from '../db/schema.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();
app.use('*', requireAuth);

const changeSchema = z.object({
  table: z.enum(['notes', 'tasks', 'folders', 'tags', 'timelineEvents', 'timelines', 'whiteboards', 'standaloneIOCs', 'chatThreads', 'evidenceItems']),
  op: z.enum(['put', 'delete']),
  entityId: z.string().min(1).max(128),
  data: z.record(z.unknown()).optional(),
  clientVersion: z.number().int().min(0).max(2147483646).optional(),
}).refine(change => change.op !== 'put' || change.data !== undefined, 'Put requires entity data');
const pushSchema = z.object({ generation: z.string().uuid(), changes: z.array(changeSchema).max(500) }).superRefine(({ changes }, ctx) => {
  const identities = new Set<string>();
  for (const change of changes) {
    const key = JSON.stringify([change.table, change.entityId]);
    if (identities.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate entity in sync batch' });
    identities.add(key);
  }
});

app.post('/push', requireRole('admin', 'analyst'), async (c) => {
  const parsed = pushSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid sync batch', code: ErrorCodes.VALIDATION_FAILED, details: parsed.error.flatten() }, 400);
  const user = c.get('user');
  const changes = parsed.data.changes;
  if (!changes.length) return c.json({ results: [] });

  // The service checks current membership and source/destination scope while
  // holding the same transaction used for revision checks and writes.
  let results;
  try {
    results = await processPush(changes, user.id, { authorize: true, generation: parsed.data.generation });
  } catch (error) {
    if (error instanceof SyncWriteValidationError) return c.json({ error: error.message, code: ErrorCodes.VALIDATION_FAILED }, 400);
    if (error instanceof SyncReadError) return c.json({ error: error.message, code: 'SYNC_CURSOR_RESET', resetRequired: true }, error.status);
    throw error;
  }
  const activityEntries = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const result = results[index];
    if (result.status !== 'accepted') continue;
    const folderId = change.table === 'folders' ? change.entityId : result.serverRecord?.folderId as string | undefined;
    if (result.previousFolderId && result.previousFolderId !== folderId) {
      await broadcastToFolder(result.previousFolderId, {
        type: 'entity-change', table: change.table, op: 'delete', entityId: change.entityId, updatedBy: user.id,
      }, user.id);
    }
    if (folderId) {
      await broadcastToFolder(folderId, {
        type: 'entity-change', table: change.table, op: change.op, entityId: change.entityId,
        data: result.serverRecord, updatedBy: user.id,
      }, user.id);
    }
    activityEntries.push({
      userId: user.id,
      category: change.table === 'timelineEvents' ? 'timeline' : change.table === 'standaloneIOCs' ? 'ioc' : change.table === 'chatThreads' ? 'chat' : change.table,
      action: change.op === 'delete' ? 'delete' : 'update',
      detail: `Synced ${change.op} on ${change.table}`,
      itemId: change.entityId,
      itemTitle: (result.serverRecord?.title as string) || (result.serverRecord?.name as string),
      folderId,
    });
  }
  if (activityEntries.length) await logActivityBatch(activityEntries);
  return c.json({ results });
});

app.get('/pull', async (c) => {
  const user = c.get('user');
  const cursor = c.req.query('cursor');
  const folderId = c.req.query('folderId');
  const metadataOnly = c.req.query('metadataOnly') === 'true';
  if (cursor !== undefined) {
    const rawLimit = c.req.query('limit');
    const limit = rawLimit === undefined ? 200 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return c.json({ error: 'Invalid sync page limit' }, 400);
    try {
      return c.json(await pullCursorChanges(cursor, user.id, { folderId, metadataOnly, limit, generation: c.req.query('generation') }));
    } catch (error) {
      if (error instanceof SyncReadError) return c.json({
        error: error.message,
        ...(error.resetRequired ? { code: 'SYNC_CURSOR_RESET', resetRequired: true } : {}),
      }, error.status);
      throw error;
    }
  }

  // Legacy clients receive a full visible resync; wall-clock timestamps are
  // informational and never used as an incremental lower bound.
  const since = c.req.query('since');
  if (!since) return c.json({ error: 'Missing cursor parameter', code: ErrorCodes.MISSING_SINCE_PARAM }, 400);
  if (folderId) {
    if (!await checkInvestigationAccess(user.id, folderId, 'viewer')) return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
    return c.json(await pullChanges(since, [folderId], metadataOnly ? { metadataOnly } : undefined));
  }
  const memberships = await db.select({ folderId: investigationMembers.folderId }).from(investigationMembers)
    .where(eq(investigationMembers.userId, user.id));
  return c.json(await pullChanges(since, memberships.map(member => member.folderId), metadataOnly ? { metadataOnly } : undefined));
});

app.get('/snapshot/:folderId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('folderId');
  if (!await checkInvestigationAccess(user.id, folderId, 'viewer')) return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  return c.json(await getSnapshot(folderId));
});

export default app;
