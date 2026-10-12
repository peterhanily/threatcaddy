import { Hono } from 'hono';
import { eq, count, sql, isNull } from 'drizzle-orm';
import { removeCommittedBlobs } from '../../services/storage-policy.js';
import { purgeInvestigation } from '../../services/investigation-lifecycle.js';
import { InvestigationPolicyError, mutateInvestigationMember } from '../../services/investigation-policy.js';
import { revokeUserFolderAccess, revokeFolderAccess } from '../../ws/handler.js';
import {
  db, users, folders, investigationMembers, notes, tasks,
  timelineEvents, whiteboards, standaloneIOCs, chatThreads,
  files, evidenceItems,
  requireAdminAuth, logAdminAction, getAdminId, FILE_STORAGE_PATH,
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
    .leftJoin(users, eq(users.id, folders.createdBy))
    .where(isNull(folders.deletedAt))
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
    .leftJoin(users, eq(users.id, folders.createdBy))
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
  const [evidenceCount] = await db.select({ count: count() }).from(evidenceItems).where(eq(evidenceItems.folderId, id));

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
      evidenceItems: evidenceCount.count,
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
  await logAdminAction(getAdminId(c), 'investigation.status-change', `Changed "${folder.name}" status to ${status}`, { folderId: id });

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

  let result;
  try { result = await mutateInvestigationMember({ actor: { kind: 'admin', userId: getAdminId(c) }, folderId, targetUserId: userId, operation: 'add', role: memberRole }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
  if (result.changed) await logAdminAction(getAdminId(c), 'investigation.add-member', `Added ${result.user.email} as ${memberRole} to investigation`, { folderId });

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

  try { await mutateInvestigationMember({ actor: { kind: 'admin', userId: getAdminId(c) }, folderId, targetUserId: userId, operation: 'update', role }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  revokeUserFolderAccess(userId, folderId);
  await logAdminAction(getAdminId(c), 'investigation.update-member', `Changed member role to ${role}`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/members/:userId
app.delete('/api/investigations/:id/members/:userId', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const userId = c.req.param('userId');

  try { await mutateInvestigationMember({ actor: { kind: 'admin', userId: getAdminId(c) }, folderId, targetUserId: userId, operation: 'remove' }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  revokeUserFolderAccess(userId, folderId);
  await logAdminAction(getAdminId(c), 'investigation.remove-member', `Removed member from investigation`, { folderId });
  return c.json({ ok: true });
});

// DELETE /admin/api/investigations/:id/content — purge all content
app.delete('/api/investigations/:id/content', requireAdminAuth, async (c) => {
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { confirmName } = body || {};

  let purged;
  try { purged = await purgeInvestigation({ actor: { kind: 'admin', userId: getAdminId(c) }, folderId, confirmName }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  const { folder, deleted, folderFiles } = purged;

  revokeFolderAccess(folderId);
  const cleanupPending = await removeCommittedBlobs(FILE_STORAGE_PATH, folderFiles);
  await logAdminAction(getAdminId(c), 'investigation.purge', `Purged and deleted investigation "${folder.name}"`, { folderId });

  return c.json({ ok: true, deleted, cleanupPending });
});

export default app;
