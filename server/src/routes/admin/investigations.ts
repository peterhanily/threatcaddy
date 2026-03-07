import { Hono } from 'hono';
import { eq, count, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  db, users, folders, investigationMembers, notes, tasks,
  timelineEvents, whiteboards, standaloneIOCs, chatThreads, posts,
  files, notifications,
  requireAdminAuth, logger, logAdminAction, FILE_STORAGE_PATH,
} from './shared.js';

const app = new Hono();

// ─── Investigations ──────────────────────────────────────────────

app.get('/api/investigations', requireAdminAuth, async (c) => {
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      status: folders.status,
      color: folders.color,
      createdAt: folders.createdAt,
      creatorName: users.displayName,
      creatorEmail: users.email,
      memberCount: sql<number>`(select count(*) from investigation_members where folder_id = ${folders.id})`.as('member_count'),
    })
    .from(folders)
    .innerJoin(users, eq(users.id, folders.createdBy))
    .orderBy(folders.createdAt);

  return c.json({ investigations: rows });
});

// GET /admin/api/investigations/:id/detail
app.get('/api/investigations/:id/detail', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const [folder] = await db.select({
    id: folders.id,
    name: folders.name,
    status: folders.status,
    color: folders.color,
    description: folders.description,
    createdAt: folders.createdAt,
    updatedAt: folders.updatedAt,
    creatorName: users.displayName,
    creatorEmail: users.email,
  }).from(folders)
    .innerJoin(users, eq(users.id, folders.createdBy))
    .where(eq(folders.id, id)).limit(1);

  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  const members = await db.select({
    id: investigationMembers.id,
    userId: investigationMembers.userId,
    role: investigationMembers.role,
    joinedAt: investigationMembers.joinedAt,
    userEmail: users.email,
    userDisplayName: users.displayName,
  }).from(investigationMembers)
    .leftJoin(users, eq(users.id, investigationMembers.userId))
    .where(eq(investigationMembers.folderId, id));

  // Entity counts
  const [notesCount] = await db.select({ count: count() }).from(notes).where(eq(notes.folderId, id));
  const [tasksCount] = await db.select({ count: count() }).from(tasks).where(eq(tasks.folderId, id));
  const [eventsCount] = await db.select({ count: count() }).from(timelineEvents).where(eq(timelineEvents.folderId, id));
  const [wbCount] = await db.select({ count: count() }).from(whiteboards).where(eq(whiteboards.folderId, id));
  const [iocCount] = await db.select({ count: count() }).from(standaloneIOCs).where(eq(standaloneIOCs.folderId, id));
  const [chatCount] = await db.select({ count: count() }).from(chatThreads).where(eq(chatThreads.folderId, id));
  const [fileCount] = await db.select({ count: count() }).from(files).where(eq(files.folderId, id));

  return c.json({
    investigation: folder,
    members,
    entityCounts: {
      notes: notesCount.count,
      tasks: tasksCount.count,
      timelineEvents: eventsCount.count,
      whiteboards: wbCount.count,
      standaloneIOCs: iocCount.count,
      chatThreads: chatCount.count,
      files: fileCount.count,
    },
  });
});

// PATCH /admin/api/investigations/:id — update status
app.patch('/api/investigations/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status } = body || {};

  const validStatuses = ['active', 'closed', 'archived'];
  if (!validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const [folder] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === 'closed') {
    updates.closedAt = new Date();
  }

  await db.update(folders).set(updates).where(eq(folders.id, id));
  await logAdminAction('investigation.status-change', `Changed "${folder.name}" status to ${status}`, { folderId: id });

  return c.json({ ok: true });
});

// POST /admin/api/investigations/:id/members — add member
app.post('/api/investigations/:id/members', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { userId, role } = body || {};

  if (!userId || typeof userId !== 'string') return c.json({ error: 'userId required' }, 400);
  const validRoles = ['owner', 'editor', 'viewer'];
  const memberRole = validRoles.includes(role) ? role : 'editor';

  // Check folder and user exist
  const [folder] = await db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'User not found' }, 404);

  await db.insert(investigationMembers).values({
    id: nanoid(),
    folderId,
    userId,
    role: memberRole,
  }).onConflictDoNothing();

  await logAdminAction('investigation.add-member', `Added ${user.email} as ${memberRole} to investigation`, { folderId });

  return c.json({ ok: true });
});

// PATCH /admin/api/investigations/:id/members/:userId — update member role
app.patch('/api/investigations/:id/members/:userId', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const userId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body || {};

  const validRoles = ['owner', 'editor', 'viewer'];
  if (!validRoles.includes(role)) return c.json({ error: 'Invalid role' }, 400);

  const result = await db.update(investigationMembers)
    .set({ role })
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .returning({ id: investigationMembers.id });

  if (result.length === 0) return c.json({ error: 'Member not found' }, 404);

  await logAdminAction('investigation.update-member', `Changed member role to ${role}`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/members/:userId
app.delete('/api/investigations/:id/members/:userId', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const userId = c.req.param('userId');

  const result = await db.delete(investigationMembers)
    .where(and(eq(investigationMembers.folderId, folderId), eq(investigationMembers.userId, userId)))
    .returning({ id: investigationMembers.id });

  if (result.length === 0) return c.json({ error: 'Member not found' }, 404);

  await logAdminAction('investigation.remove-member', `Removed member from investigation`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/content — purge all content
app.delete('/api/investigations/:id/content', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { confirmName } = body || {};

  const [folder] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) return c.json({ error: 'Investigation not found' }, 404);

  if (confirmName !== folder.name) {
    return c.json({ error: 'Confirmation name does not match' }, 400);
  }

  // Delete files from disk first
  const folderFiles = await db.select({ storagePath: files.storagePath, thumbnailPath: files.thumbnailPath })
    .from(files).where(eq(files.folderId, folderId));
  for (const f of folderFiles) {
    try { await unlink(join(FILE_STORAGE_PATH, f.storagePath)); } catch (err) { logger.warn('Failed to unlink file', { path: f.storagePath, error: String(err) }); }
    if (f.thumbnailPath) {
      try { await unlink(join(FILE_STORAGE_PATH, f.thumbnailPath)); } catch (err) { logger.warn('Failed to unlink file', { path: f.thumbnailPath, error: String(err) }); }
    }
  }

  // Hard delete all entities
  const deleted: Record<string, number> = {};
  const delNotes = await db.delete(notes).where(eq(notes.folderId, folderId)).returning({ id: notes.id });
  deleted.notes = delNotes.length;
  const delTasks = await db.delete(tasks).where(eq(tasks.folderId, folderId)).returning({ id: tasks.id });
  deleted.tasks = delTasks.length;
  const delEvents = await db.delete(timelineEvents).where(eq(timelineEvents.folderId, folderId)).returning({ id: timelineEvents.id });
  deleted.timelineEvents = delEvents.length;
  const delWb = await db.delete(whiteboards).where(eq(whiteboards.folderId, folderId)).returning({ id: whiteboards.id });
  deleted.whiteboards = delWb.length;
  const delIoc = await db.delete(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId)).returning({ id: standaloneIOCs.id });
  deleted.standaloneIOCs = delIoc.length;
  const delChat = await db.delete(chatThreads).where(eq(chatThreads.folderId, folderId)).returning({ id: chatThreads.id });
  deleted.chatThreads = delChat.length;
  const delPosts = await db.delete(posts).where(eq(posts.folderId, folderId)).returning({ id: posts.id });
  deleted.posts = delPosts.length;
  const delFiles = await db.delete(files).where(eq(files.folderId, folderId)).returning({ id: files.id });
  deleted.files = delFiles.length;
  const delNotif = await db.delete(notifications).where(eq(notifications.folderId, folderId)).returning({ id: notifications.id });
  deleted.notifications = delNotif.length;
  const delMembers = await db.delete(investigationMembers).where(eq(investigationMembers.folderId, folderId)).returning({ id: investigationMembers.id });
  deleted.members = delMembers.length;

  // Delete the folder itself
  await db.delete(folders).where(eq(folders.id, folderId));

  await logAdminAction('investigation.purge', `Purged and deleted investigation "${folder.name}"`, { folderId });

  return c.json({ ok: true, deleted });
});

export default app;
