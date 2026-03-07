import { Hono } from 'hono';
import { eq, count, desc, and, gte, lte, ilike, or, sql } from 'drizzle-orm';
import {
  db, users, folders, activityLog, adminUsers,
  requireAdminAuth, logAdminAction, getAdminId,
} from './shared.js';

const app = new Hono();

// ─── Audit Log ───────────────────────────────────────────────────

app.get('/api/audit-log', requireAdminAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));
  const userId = c.req.query('userId');
  const category = c.req.query('category');
  const action = c.req.query('action');
  const folderId = c.req.query('folderId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions = [];
  if (userId) conditions.push(eq(activityLog.userId, userId));
  if (category) conditions.push(eq(activityLog.category, category));
  if (action) conditions.push(eq(activityLog.action, action));
  if (folderId) conditions.push(eq(activityLog.folderId, folderId));
  if (dateFrom) conditions.push(gte(activityLog.timestamp, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(activityLog.timestamp, new Date(dateTo)));
  if (search) {
    conditions.push(or(
      ilike(activityLog.detail, `%${search}%`),
      ilike(activityLog.itemTitle, `%${search}%`),
    )!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(activityLog).where(whereClause);

  const entries = await db.select({
    id: activityLog.id,
    userId: activityLog.userId,
    userDisplayName: sql<string>`COALESCE(${users.displayName}, ${adminUsers.displayName})`.as('user_display_name'),
    userEmail: sql<string>`COALESCE(${users.email}, ${adminUsers.username})`.as('user_email'),
    category: activityLog.category,
    action: activityLog.action,
    detail: activityLog.detail,
    itemId: activityLog.itemId,
    itemTitle: activityLog.itemTitle,
    folderId: activityLog.folderId,
    folderName: folders.name,
    timestamp: activityLog.timestamp,
  }).from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(adminUsers, eq(adminUsers.id, activityLog.userId))
    .leftJoin(folders, eq(folders.id, activityLog.folderId))
    .where(whereClause)
    .orderBy(desc(activityLog.timestamp))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ entries, total: totalResult.count, page, pageSize });
});

// GET /admin/api/audit-log/export — CSV
app.get('/api/audit-log/export', requireAdminAuth, async (c) => {
  const userId = c.req.query('userId');
  const category = c.req.query('category');
  const action = c.req.query('action');
  const folderId = c.req.query('folderId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions = [];
  if (userId) conditions.push(eq(activityLog.userId, userId));
  if (category) conditions.push(eq(activityLog.category, category));
  if (action) conditions.push(eq(activityLog.action, action));
  if (folderId) conditions.push(eq(activityLog.folderId, folderId));
  if (dateFrom) conditions.push(gte(activityLog.timestamp, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(activityLog.timestamp, new Date(dateTo)));
  if (search) {
    conditions.push(or(
      ilike(activityLog.detail, `%${search}%`),
      ilike(activityLog.itemTitle, `%${search}%`),
    )!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const entries = await db.select({
    id: activityLog.id,
    userId: activityLog.userId,
    userEmail: sql<string>`COALESCE(${users.email}, ${adminUsers.username})`.as('user_email'),
    category: activityLog.category,
    action: activityLog.action,
    detail: activityLog.detail,
    itemId: activityLog.itemId,
    itemTitle: activityLog.itemTitle,
    folderId: activityLog.folderId,
    folderName: folders.name,
    timestamp: activityLog.timestamp,
  }).from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(adminUsers, eq(adminUsers.id, activityLog.userId))
    .leftJoin(folders, eq(folders.id, activityLog.folderId))
    .where(whereClause)
    .orderBy(desc(activityLog.timestamp))
    .limit(50000);

  const csvEscape = (s: string | null | undefined) => {
    if (s == null) return '';
    const str = String(s);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const header = 'id,timestamp,userId,userEmail,category,action,detail,itemId,itemTitle,folderId,folderName';
  const rows = entries.map(e =>
    [e.id, e.timestamp?.toISOString() ?? '', e.userId, e.userEmail ?? '', e.category, e.action, e.detail,
     e.itemId ?? '', e.itemTitle ?? '', e.folderId ?? '', e.folderName ?? '']
      .map(v => csvEscape(String(v))).join(',')
  );

  await logAdminAction(getAdminId(c), 'audit-log.export', `Exported ${entries.length} audit log entries as CSV`);

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
  return c.text([header, ...rows].join('\n'));
});

export default app;
