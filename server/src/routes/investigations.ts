import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { eq, and, count, sql, isNull } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { db } from '../db/index.js';
import { investigationMembers, folders, users, notes, tasks, timelineEvents, whiteboards, standaloneIOCs, chatThreads, evidenceItems } from '../db/schema.js';
import { createNotification } from '../services/notification-service.js';
import { logActivity } from '../services/audit-service.js';
import { revokeUserFolderAccess, revokeFolderAccess, broadcastToUser } from '../ws/handler.js';
import { getEntityCounts, getEntityCountsBatch } from '../services/sync-service.js';
import type { AuthUser } from '../types.js';
import { ErrorCodes } from '../types/error-codes.js';
import { removeCommittedBlobs } from '../services/storage-policy.js';
import { purgeInvestigation } from '../services/investigation-lifecycle.js';
import { InvestigationPolicyError, mutateInvestigationMember } from '../services/investigation-policy.js';

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);
const requireInvestigationWrite = createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
  if (c.get('user').role === 'viewer') return c.json({ error: 'Insufficient permissions', code: ErrorCodes.INSUFFICIENT_PERMISSIONS }, 403);
  await next();
});

// GET /api/investigations — list investigations the user has access to
app.get('/', async (c) => {
  const user = c.get('user');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  const [totalResult, memberships] = await Promise.all([
    db
      .select({ count: count() })
      .from(investigationMembers)
      .innerJoin(folders, eq(folders.id, investigationMembers.folderId))
      .where(and(eq(investigationMembers.userId, user.id), isNull(folders.deletedAt))),
    db
      .select({
        folderId: investigationMembers.folderId,
        role: investigationMembers.role,
        joinedAt: investigationMembers.joinedAt,
        folderName: folders.name,
        folderStatus: folders.status,
        folderColor: folders.color,
        folderIcon: folders.icon,
        folderDescription: folders.description,
        folderClsLevel: folders.clsLevel,
        folderPapLevel: folders.papLevel,
        folderTags: folders.tags,
        folderCreatedAt: folders.createdAt,
        folderUpdatedAt: folders.updatedAt,
        memberCount: sql<number>`(select count(*) from investigation_members where folder_id = ${investigationMembers.folderId})`.as('member_count'),
      })
      .from(investigationMembers)
      .innerJoin(folders, eq(folders.id, investigationMembers.folderId))
      .where(and(eq(investigationMembers.userId, user.id), isNull(folders.deletedAt)))
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const folderIds = memberships.map((m) => m.folderId);

  // Batch entity counts: one query per table with GROUP BY
  const entityCountsMap = await getEntityCountsBatch(folderIds);

  const data = memberships.map((m) => ({
    folderId: m.folderId,
    role: m.role,
    joinedAt: m.joinedAt,
    folder: {
      name: m.folderName,
      status: m.folderStatus,
      color: m.folderColor,
      icon: m.folderIcon,
      description: m.folderDescription,
      clsLevel: m.folderClsLevel,
      papLevel: m.folderPapLevel,
      tags: m.folderTags,
      createdAt: m.folderCreatedAt,
      updatedAt: m.folderUpdatedAt,
    },
    entityCounts: entityCountsMap.get(m.folderId) ?? { notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0, evidence: 0 },
    memberCount: m.memberCount,
  }));

  return c.json({ data, total, limit, offset });
});

// GET /api/investigations/:id/summary — detailed metadata without full entity data
app.get('/:id/summary', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const [folderResult, members, entityCounts, lastActivityResult] = await Promise.all([
    // Folder metadata
    db
      .select({
        name: folders.name,
        status: folders.status,
        color: folders.color,
        icon: folders.icon,
        description: folders.description,
        clsLevel: folders.clsLevel,
        papLevel: folders.papLevel,
        tags: folders.tags,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
      })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1),

    // Members with user info
    db
      .select({
        id: investigationMembers.id,
        userId: investigationMembers.userId,
        role: investigationMembers.role,
        joinedAt: investigationMembers.joinedAt,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(investigationMembers)
      .innerJoin(users, eq(users.id, investigationMembers.userId))
      .where(eq(investigationMembers.folderId, folderId)),

    // Entity counts (parallel internally)
    getEntityCounts(folderId),

    // Last activity: most recent updatedAt across all entity tables
    Promise.all([
      db.select({ latest: sql<string>`max(${notes.updatedAt})` }).from(notes).where(eq(notes.folderId, folderId)),
      db.select({ latest: sql<string>`max(${tasks.updatedAt})` }).from(tasks).where(eq(tasks.folderId, folderId)),
      db.select({ latest: sql<string>`max(${standaloneIOCs.updatedAt})` }).from(standaloneIOCs).where(eq(standaloneIOCs.folderId, folderId)),
      db.select({ latest: sql<string>`max(${timelineEvents.updatedAt})` }).from(timelineEvents).where(eq(timelineEvents.folderId, folderId)),
      db.select({ latest: sql<string>`max(${whiteboards.updatedAt})` }).from(whiteboards).where(eq(whiteboards.folderId, folderId)),
      db.select({ latest: sql<string>`max(${chatThreads.updatedAt})` }).from(chatThreads).where(eq(chatThreads.folderId, folderId)),
      db.select({ latest: sql<string>`max(${evidenceItems.updatedAt})` }).from(evidenceItems).where(eq(evidenceItems.folderId, folderId)),
    ]),
  ]);

  const folder = folderResult[0];
  if (!folder) {
    return c.json({ error: 'Investigation not found', code: ErrorCodes.INVESTIGATION_NOT_FOUND }, 404);
  }

  // Find the most recent updatedAt across all entity tables
  const latestDates = lastActivityResult
    .map((r) => r[0]?.latest)
    .filter((d): d is string => d != null)
    .map((d) => new Date(d).getTime());
  const lastActivity = latestDates.length > 0
    ? new Date(Math.max(...latestDates)).toISOString()
    : undefined;

  return c.json({
    folder,
    entityCounts,
    members,
    lastActivity,
  });
});

// GET /api/investigations/:id/members
app.get('/:id/members', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  const hasAccess = await checkInvestigationAccess(user.id, folderId, 'viewer');
  if (!hasAccess) {
    return c.json({ error: 'No access to this investigation', code: ErrorCodes.NO_ACCESS }, 403);
  }

  const members = await db
    .select({
      id: investigationMembers.id,
      userId: investigationMembers.userId,
      role: investigationMembers.role,
      joinedAt: investigationMembers.joinedAt,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(investigationMembers)
    .innerJoin(users, eq(users.id, investigationMembers.userId))
    .where(eq(investigationMembers.folderId, folderId));

  return c.json(members);
});

// POST /api/investigations/:id/members — add member
app.post('/:id/members', requireInvestigationWrite, async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { userId, role = 'editor' } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  let result;
  try { result = await mutateInvestigationMember({ actor: { kind: 'user', userId: user.id }, folderId, targetUserId: userId, operation: 'add', role }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
  const { folder } = result;

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} added you to ${folder.name}`,
  });

  // Notify the invited user via WS so their client pulls the investigation data
  broadcastToUser(userId, { type: 'folder-invite', folderId });

  return c.json({ ok: true }, 201);
});

// PATCH /api/investigations/:id/members/:userId — update member role
app.patch('/:id/members/:userId', requireInvestigationWrite, async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const body = await c.req.json();
  const { role } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  try { await mutateInvestigationMember({ actor: { kind: 'user', userId: user.id }, folderId, targetUserId, operation: 'update', role }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  revokeUserFolderAccess(targetUserId, folderId);
  return c.json({ ok: true });
});

// DELETE /api/investigations/:id/members/:userId — remove member
app.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  try { await mutateInvestigationMember({ actor: { kind: 'user', userId: user.id }, folderId, targetUserId, operation: 'remove' }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }

  // Revoke WS subscriptions immediately so removed user can't receive further data
  revokeUserFolderAccess(targetUserId, folderId);

  await logActivity({
    userId: user.id,
    category: 'investigation',
    action: 'remove-member',
    detail: `Removed user ${targetUserId} from investigation`,
    folderId,
  });

  return c.json({ ok: true });
});

// DELETE /api/investigations/:id — delete investigation (owner only)
app.delete('/:id', requireInvestigationWrite, async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  let purged;
  try { purged = await purgeInvestigation({ actor: { kind: 'user', userId: user.id }, folderId }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
  const { folder, folderFiles } = purged;

  revokeFolderAccess(folderId);
  const cleanupPending = await removeCommittedBlobs(FILE_STORAGE_PATH, folderFiles);
  await logActivity({
    userId: user.id,
    category: 'investigation',
    action: 'delete',
    detail: `Deleted investigation "${folder.name}"`,
    folderId,
  });

  return c.json({ ok: true, cleanupPending });
});

// POST /api/investigations/:id/invite — invite by email
app.post('/:id/invite', requireInvestigationWrite, async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { email, role = 'editor' } = body;

  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role', code: ErrorCodes.INVALID_ROLE }, 400);
  }

  // Find user by email
  const targetUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'No user with that email found', code: ErrorCodes.USER_NOT_FOUND }, 404);
  }

  const userId = targetUser[0].id;

  let result;
  try { result = await mutateInvestigationMember({ actor: { kind: 'user', userId: user.id }, folderId, targetUserId: userId, operation: 'add', role }); }
  catch (error) {
    if (error instanceof InvestigationPolicyError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
  const { folder } = result;

  await createNotification({
    userId,
    type: 'invite',
    sourceUserId: user.id,
    folderId,
    message: `${user.displayName} invited you to ${folder.name}`,
  });

  // Notify the invited user via WS so their client pulls the investigation data
  broadcastToUser(userId, { type: 'folder-invite', folderId });

  return c.json({ ok: true }, 201);
});

export default app;
