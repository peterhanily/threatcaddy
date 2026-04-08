import { Hono } from 'hono';
import { eq, and, gt, desc, inArray } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { activityLog, users, investigationMembers } from '../db/schema.js';
import type { AuthUser } from '../types.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// GET /api/audit
app.get('/', async (c) => {
  const user = c.get('user');
  const folderId = c.req.query('folderId');
  const userId = c.req.query('userId');
  const since = c.req.query('since');
  const category = c.req.query('category');
  const rawLimit0 = parseInt(c.req.query('limit') || '', 10);
  const limit = Math.min(isFinite(rawLimit0) && rawLimit0 > 0 ? rawLimit0 : 100, 500);

  // Non-admin users must specify a folderId and be an owner of that investigation
  if (user.role !== 'admin') {
    if (!folderId) {
      return c.json({ error: 'folderId is required' }, 400);
    }
    const hasAccess = await checkInvestigationAccess(user.id, folderId, 'owner');
    if (!hasAccess) {
      return c.json({ error: 'Only investigation owners can view audit logs' }, 403);
    }
  }

  const conditions = [];
  if (folderId) conditions.push(eq(activityLog.folderId, folderId));
  if (userId) conditions.push(eq(activityLog.userId, userId));
  if (since) conditions.push(gt(activityLog.timestamp, new Date(since)));
  if (category) conditions.push(eq(activityLog.category, category));

  const result = await db
    .select({
      id: activityLog.id,
      userId: activityLog.userId,
      category: activityLog.category,
      action: activityLog.action,
      detail: activityLog.detail,
      itemId: activityLog.itemId,
      itemTitle: activityLog.itemTitle,
      folderId: activityLog.folderId,
      timestamp: activityLog.timestamp,
      userDisplayName: users.displayName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLog.timestamp))
    .limit(limit);

  return c.json(result);
});

// GET /api/audit/team — team-wide activity feed scoped to user's accessible investigations
app.get('/team', async (c) => {
  const user = c.get('user');
  const since = c.req.query('since');
  const category = c.req.query('category');
  const rawLimit1 = parseInt(c.req.query('limit') || '', 10);
  const limit = Math.min(isFinite(rawLimit1) && rawLimit1 > 0 ? rawLimit1 : 50, 200);

  // Get all folder IDs the user has access to
  const memberships = await db
    .select({ folderId: investigationMembers.folderId })
    .from(investigationMembers)
    .where(eq(investigationMembers.userId, user.id));
  const accessibleFolderIds = memberships.map((m) => m.folderId);

  const conditions = [];
  // Admins see everything; non-admins only see activity from their investigations
  if (user.role !== 'admin' && accessibleFolderIds.length > 0) {
    conditions.push(inArray(activityLog.folderId, accessibleFolderIds));
  } else if (user.role !== 'admin') {
    // No accessible folders — return empty
    return c.json([]);
  }
  if (since) conditions.push(gt(activityLog.timestamp, new Date(since)));
  if (category) conditions.push(eq(activityLog.category, category));

  const result = await db
    .select({
      id: activityLog.id,
      userId: activityLog.userId,
      category: activityLog.category,
      action: activityLog.action,
      detail: activityLog.detail,
      itemId: activityLog.itemId,
      itemTitle: activityLog.itemTitle,
      folderId: activityLog.folderId,
      timestamp: activityLog.timestamp,
      userDisplayName: users.displayName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLog.timestamp))
    .limit(limit);

  return c.json(result);
});

export default app;
