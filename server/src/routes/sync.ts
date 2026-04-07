import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { processPush, pullChanges, getSnapshot, bulkLookupEntityFolderIds } from '../services/sync-service.js';
import { logActivityBatch } from '../services/audit-service.js';
import { logger } from '../lib/logger.js';
import { broadcastToFolder } from '../ws/handler.js';
import { db } from '../db/index.js';
import { folders, investigationMembers } from '../db/schema.js';
import type { AuthUser, SyncChange, SyncResult } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';

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

  // Pre-fetch all needed folderId lookups in a single batch to avoid N+1 queries
  const lookupsNeeded: Array<{ table: string; entityId: string }> = [];
  for (const change of changes) {
    if (TABLES_WITHOUT_FOLDER.has(change.table) || change.table === 'folders') continue;
    lookupsNeeded.push({ table: change.table, entityId: change.entityId });
  }
  const folderIdCache = await bulkLookupEntityFolderIds(lookupsNeeded);

  // P7: Pre-fetch all accessible folderIds in one query instead of N checkInvestigationAccess calls
  const accessibleEditorFolders = new Set<string>();
  {
    const memberships = await db
      .select({ folderId: investigationMembers.folderId })
      .from(investigationMembers)
      .where(
        eq(investigationMembers.userId, user.id),
      );
    for (const m of memberships) {
      // editor and owner roles have editor-level access
      accessibleEditorFolders.add(m.folderId);
    }
  }
  // Refine: we need role-based check. Re-query with role filter for editor+ access.
  accessibleEditorFolders.clear();
  {
    const memberships = await db
      .select({ folderId: investigationMembers.folderId, role: investigationMembers.role })
      .from(investigationMembers)
      .where(eq(investigationMembers.userId, user.id));
    for (const m of memberships) {
      if (m.role === 'owner' || m.role === 'editor') {
        accessibleEditorFolders.add(m.folderId);
      }
    }
  }

  // Batch check for new folder creates: find which folder entityIds already exist
  const folderCreates = changes
    .filter(c => c.table === 'folders' && c.op === 'put')
    .map(c => c.entityId);
  const existingFolderIds = new Set<string>();
  if (folderCreates.length > 0) {
    const existingRows = await db
      .select({ id: folders.id })
      .from(folders)
      .where(inArray(folders.id, folderCreates));
    for (const row of existingRows) {
      existingFolderIds.add(row.id);
    }
  }

  // Build authorization list using in-memory Set lookups
  const authorized: boolean[] = [];
  for (const change of changes) {
    if (TABLES_WITHOUT_FOLDER.has(change.table)) {
      authorized.push(true);
      continue;
    }

    // Extract folderId: for folders table, entityId IS the folderId.
    // For other tables, use the pre-fetched bulk lookup result
    // (never trust the client-supplied folderId for auth decisions).
    let folderId: string | undefined;
    if (change.table === 'folders') {
      folderId = change.entityId;
    } else if (change.op === 'delete' || !change.data?.folderId) {
      // For deletes (no data) or missing folderId: use cached DB lookup
      folderId = folderIdCache.get(`${change.table}:${change.entityId}`);
      // If entity doesn't exist yet and no folderId provided, use client data
      if (!folderId && change.op === 'put') {
        folderId = change.data?.folderId as string | undefined;
      }
    } else {
      // New entity with folderId in payload — verify against DB if entity exists
      const dbFolderId = folderIdCache.get(`${change.table}:${change.entityId}`);
      folderId = dbFolderId || (change.data?.folderId as string | undefined);
    }

    if (!folderId) {
      // Entity has no folder association and table is folder-scoped — reject
      // (folder-scoped entities must have a folderId)
      authorized.push(false);
      continue;
    }

    // P7: Use pre-fetched Set for O(1) access check instead of per-change DB query
    const hasAccess = accessibleEditorFolders.has(folderId);

    // If the client is moving an entity to a different folder, also verify
    // access to the destination folder to prevent cross-folder data exfil.
    const clientFolderId = change.data?.folderId as string | undefined;
    if (hasAccess && change.op === 'put' && clientFolderId && clientFolderId !== folderId) {
      const hasDestAccess = accessibleEditorFolders.has(clientFolderId);
      if (!hasDestAccess) {
        authorized.push(false);
        continue;
      }
    }

    if (hasAccess) {
      authorized.push(true);
    } else if (change.table === 'folders' && change.op === 'put') {
      // Allow creating new folders — user won't have membership yet.
      // Existing folder modifications still require editor access.
      authorized.push(!existingFolderIds.has(change.entityId));
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
      results.push({ table: changes[i].table, entityId: changes[i].entityId, status: 'rejected' });
      logger.warn(`Sync rejected: user ${user.id} attempted ${changes[i].op} on ${changes[i].table}/${changes[i].entityId}`);
    }
  }

  // Auto-create owner membership for newly created folders (batched)
  const newFolderMemberships = changes
    .map((change, i) => ({ change, result: results[i] }))
    .filter(({ change, result }) =>
      change.table === 'folders' && change.op === 'put' &&
      result.status === 'accepted' && result.serverVersion === 1)
    .map(({ change }) => ({
      id: nanoid(),
      folderId: change.entityId,
      userId: user.id,
      role: 'owner' as const,
    }));
  if (newFolderMemberships.length > 0) {
    await db.insert(investigationMembers).values(newFolderMemberships).onConflictDoNothing();
  }

  // Batch-lookup folderIds for accepted deletes that lack folderId in data/serverRecord
  const deleteLookups = changes
    .map((change, i) => ({ change, result: results[i], idx: i }))
    .filter(({ change, result }) =>
      result.status === 'accepted' && change.op === 'delete' &&
      !(change.data?.folderId as string) && !(result.serverRecord?.folderId as string | undefined))
    .map(({ change }) => ({ table: change.table, entityId: change.entityId }));
  const deleteFolderIds = deleteLookups.length > 0
    ? await bulkLookupEntityFolderIds(deleteLookups)
    : new Map<string, string | undefined>();

  // Broadcast accepted changes via WebSocket and collect activity log entries
  const activityEntries: Array<{
    userId: string;
    category: string;
    action: string;
    detail: string;
    itemId?: string;
    itemTitle?: string;
    folderId?: string;
  }> = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const result = results[i];
    if (result.status === 'accepted') {
      const folderId = (change.data?.folderId as string)
        || (result.serverRecord?.folderId as string | undefined)
        || deleteFolderIds.get(`${change.table}:${change.entityId}`);
      if (folderId) {
        broadcastToFolder(folderId, {
          type: 'entity-change',
          table: change.table,
          op: change.op,
          entityId: change.entityId,
          data: result.serverRecord || change.data,
          updatedBy: user.id,
        }, user.id);
      }

      // P13: Collect activity entries for batch insert instead of per-change INSERT
      activityEntries.push({
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

  // P13: Single batch INSERT for all activity log entries
  if (activityEntries.length > 0) {
    await logActivityBatch(activityEntries);
  }

  return c.json({ results });
});

// GET /api/sync/pull
app.get('/pull', async (c) => {
  const user = c.get('user');
  const since = c.req.query('since');
  if (!since) {
    return c.json({ error: 'Missing since parameter', code: ErrorCodes.MISSING_SINCE_PARAM }, 400);
  }

  const folderId = c.req.query('folderId');
  // P11: Support metadataOnly flag to exclude heavy columns (content, messages, elements, iocAnalysis)
  const metadataOnly = c.req.query('metadataOnly') === 'true';
  const pullOpts = metadataOnly ? { metadataOnly } : undefined;

  if (folderId) {
    // Specific folder: verify access
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
    }
    const result = await pullChanges(since, [folderId], pullOpts);
    return c.json(result);
  }

  // No folderId: pull from all folders the user is a member of
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, user.id));
  const folderIds = memberships.map((m) => m.folderId);
  const result = await pullChanges(since, folderIds, pullOpts);
  return c.json(result);
});

// GET /api/sync/snapshot/:folderId
app.get('/snapshot/:folderId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('folderId');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const snapshot = await getSnapshot(folderId);
  return c.json(snapshot);
});

export default app;
