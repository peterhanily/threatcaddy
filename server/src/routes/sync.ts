import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { processPush, pullChanges, getSnapshot } from '../services/sync-service.js';
import { logActivity } from '../services/audit-service.js';
import { broadcastToFolder } from '../ws/handler.js';
import { db } from '../db/index.js';
import { folders, investigationMembers } from '../db/schema.js';
import type { AuthUser, SyncChange, SyncResult } from '../types.js';

// Tables that are global (not scoped to a folder)
const TABLES_WITHOUT_FOLDER = new Set(['tags', 'timelines']);

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/sync/push
app.post('/push', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const changes: SyncChange[] = body.changes || [];

  if (changes.length === 0) {
    return c.json({ results: [] });
  }

  // Build authorization list
  const authorized: boolean[] = [];
  for (const change of changes) {
    if (TABLES_WITHOUT_FOLDER.has(change.table)) {
      authorized.push(true);
      continue;
    }

    // Extract folderId: for folders table, entityId IS the folderId
    const folderId =
      change.table === 'folders'
        ? change.entityId
        : (change.data?.folderId as string | undefined);

    if (!folderId) {
      authorized.push(true); // No folder context — allow
      continue;
    }

    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'editor');
    if (hasAccess) {
      authorized.push(true);
    } else if (change.table === 'folders' && change.op === 'put') {
      // Allow creating new folders — user won't have membership yet.
      // Existing folder modifications still require editor access.
      const existing = await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, change.entityId))
        .limit(1);
      authorized.push(existing.length === 0);
    } else {
      authorized.push(false);
    }
  }

  // Process only authorized changes
  const toProcess = changes.filter((_, i) => authorized[i]);
  const processedResults =
    toProcess.length > 0 ? await processPush(toProcess, user.id) : [];

  // Map results back by original index
  const results: SyncResult[] = [];
  let processedIdx = 0;
  for (let i = 0; i < changes.length; i++) {
    if (authorized[i]) {
      results.push(processedResults[processedIdx++]);
    } else {
      results.push({ entityId: changes[i].entityId, status: 'rejected' });
    }
  }

  // Auto-create owner membership for newly created folders
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const result = results[i];
    if (
      change.table === 'folders' &&
      change.op === 'put' &&
      result.status === 'accepted' &&
      result.serverVersion === 1
    ) {
      await db.insert(investigationMembers).values({
        id: nanoid(),
        folderId: change.entityId,
        userId: user.id,
        role: 'owner',
      }).onConflictDoNothing();
    }
  }

  // Broadcast accepted changes via WebSocket
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const result = results[i];
    if (result.status === 'accepted') {
      const folderId = (change.data?.folderId as string) || undefined;
      if (folderId) {
        broadcastToFolder(folderId, {
          type: 'entity-change',
          table: change.table,
          op: change.op,
          entityId: change.entityId,
          data: change.data,
          updatedBy: user.id,
        }, user.id);
      }

      // Log activity
      await logActivity({
        userId: user.id,
        category: change.table === 'timelineEvents' ? 'timeline' :
                  change.table === 'standaloneIOCs' ? 'ioc' :
                  change.table === 'chatThreads' ? 'chat' :
                  change.table as string,
        action: change.op === 'delete' ? 'delete' : 'update',
        detail: `Synced ${change.op} on ${change.table}`,
        itemId: change.entityId,
        itemTitle: (change.data?.title as string) || (change.data?.name as string),
        folderId,
      });
    }
  }

  return c.json({ results });
});

// GET /api/sync/pull
app.get('/pull', async (c) => {
  const user = c.get('user');
  const since = c.req.query('since');
  if (!since) {
    return c.json({ error: 'Missing since parameter' }, 400);
  }

  const folderId = c.req.query('folderId');

  if (!folderId) {
    return c.json({ error: 'folderId is required' }, 400);
  }

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }

  const result = await pullChanges(since, folderId || undefined);
  return c.json(result);
});

// GET /api/sync/snapshot/:folderId
app.get('/snapshot/:folderId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('folderId');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation' }, 403);
  }

  const snapshot = await getSnapshot(folderId);
  return c.json(snapshot);
});

export default app;
