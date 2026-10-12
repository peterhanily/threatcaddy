import { and, eq, inArray, isNull, not, ilike, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, type DB } from '../db/index.js';
import { adminUsers, folders, investigationMembers, users } from '../db/schema.js';
import type { InvestigationRole } from '../types.js';

export type InvestigationPolicyDatabase = Pick<DB, 'execute' | 'select' | 'insert' | 'update' | 'delete'>;
export type InvestigationActor = { kind: 'user'; userId: string } | { kind: 'admin'; userId: string };
export class InvestigationPolicyError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409, public readonly code: string) { super(message); }
}

export function isEligibleInvestigationOwner(user: { active: boolean; role: string; email: string } | undefined): boolean {
  return !!user?.active && ['admin', 'analyst'].includes(user.role)
    && !user.email.toLowerCase().endsWith('@threatcaddy.internal');
}

/** The sync writer lock precedes user, membership, folder and storage locks.
 * Reusing it serializes policy decisions with folder creation and restoration. */
export async function lockInvestigationPolicy(tx: Pick<DB, 'execute'>): Promise<void> {
  const rows = await tx.execute(sql`SELECT id FROM sync_clock WHERE id = 1 FOR UPDATE`);
  if (!rows.length) throw new Error('Investigation policy lock is unavailable');
}

export async function assertAccountAdministrator(tx: InvestigationPolicyDatabase, actor: InvestigationActor): Promise<void> {
  if (actor.kind === 'admin') {
    const [admin] = await tx.select({ active: adminUsers.active }).from(adminUsers).where(eq(adminUsers.id, actor.userId)).for('share');
    if (admin?.active) return;
  } else {
    const [user] = await tx.select().from(users).where(eq(users.id, actor.userId)).for('share');
    if (user?.role === 'admin' && isEligibleInvestigationOwner(user)) return;
  }
  throw new InvestigationPolicyError('A current active administrator is required', 403, 'ADMIN_REQUIRED');
}

const eligibleOwner = () => and(eq(investigationMembers.role, 'owner'), eq(users.active, true),
  inArray(users.role, ['admin', 'analyst']), not(ilike(users.email, '%@threatcaddy.internal')));

export async function assertInvestigationOwner(tx: InvestigationPolicyDatabase, userId: string, folderId: string,
  options: { includeDeleted?: boolean } = {}): Promise<typeof folders.$inferSelect> {
  const [folder] = await tx.select().from(folders).where(and(eq(folders.id, folderId),
    options.includeDeleted ? undefined : isNull(folders.deletedAt))).limit(1);
  if (!folder) throw new InvestigationPolicyError('Investigation not found', 404, 'INVESTIGATION_NOT_FOUND');
  const [member] = await tx.select({ id: investigationMembers.id }).from(investigationMembers)
    .innerJoin(users, eq(users.id, investigationMembers.userId))
    .where(and(eq(investigationMembers.folderId, folderId), eq(users.id, userId), eligibleOwner())).limit(1);
  if (!member) throw new InvestigationPolicyError('A current active human investigation owner is required', 403, 'OWNER_REQUIRED');
  return folder;
}

/** Snapshot only folders with an eligible owner affected by this account change.
 * Legacy ownerless folders need explicit admin recovery, not automatic grants. */
export async function ownedInvestigationIds(tx: InvestigationPolicyDatabase, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await tx.select({ folderId: investigationMembers.folderId }).from(investigationMembers)
    .innerJoin(users, eq(users.id, investigationMembers.userId))
    .innerJoin(folders, eq(folders.id, investigationMembers.folderId))
    .where(and(inArray(users.id, userIds), eligibleOwner()));
  return [...new Set(rows.map(row => row.folderId))];
}

/** Invoke after the prospective mutation, inside the same clock-locked tx. */
export async function assertEligibleOwnersRemain(tx: InvestigationPolicyDatabase, folderIds: string[]): Promise<void> {
  if (!folderIds.length) return;
  const rows = await tx.select({ folderId: investigationMembers.folderId }).from(investigationMembers)
    .innerJoin(users, eq(users.id, investigationMembers.userId))
    .where(and(inArray(investigationMembers.folderId, folderIds), eligibleOwner()));
  const remaining = new Set(rows.map(row => row.folderId));
  if (folderIds.some(id => !remaining.has(id))) {
    throw new InvestigationPolicyError('Assign another active human administrator or analyst as investigation owner before removing, demoting or deactivating the last eligible owner.', 409, 'LAST_ELIGIBLE_OWNER');
  }
}

export async function mutateInvestigationMember(input: {
  actor: InvestigationActor; folderId: string; targetUserId: string;
  operation: 'add' | 'update' | 'remove'; role?: InvestigationRole;
}): Promise<{ folder: typeof folders.$inferSelect; user: typeof users.$inferSelect; changed: boolean }> {
  if (!input.targetUserId || typeof input.targetUserId !== 'string') throw new InvestigationPolicyError('User ID required', 400, 'INVALID_USER_ID');
  if (input.operation !== 'remove' && !['owner', 'editor', 'viewer'].includes(input.role ?? '')) {
    throw new InvestigationPolicyError('Invalid role', 400, 'INVALID_ROLE');
  }
  return db.transaction(async tx => {
    await lockInvestigationPolicy(tx);
    const [folder] = await tx.select().from(folders).where(and(eq(folders.id, input.folderId),
      input.actor.kind === 'admin' ? undefined : isNull(folders.deletedAt))).for('update');
    if (!folder) throw new InvestigationPolicyError('Investigation not found', 404, 'INVESTIGATION_NOT_FOUND');
    if (input.actor.kind === 'admin') {
      await assertAccountAdministrator(tx, input.actor);
    } else if (input.operation === 'remove' && input.actor.userId === input.targetUserId) {
      const [actor] = await tx.select().from(users).where(eq(users.id, input.actor.userId)).for('share');
      if (!actor?.active || actor.email.toLowerCase().endsWith('@threatcaddy.internal')) throw new InvestigationPolicyError('Account is no longer authorized', 403, 'NO_ACCESS');
    } else await assertInvestigationOwner(tx, input.actor.userId, input.folderId);
    const [user] = await tx.select().from(users).where(eq(users.id, input.targetUserId)).for('share');
    if (!user) throw new InvestigationPolicyError('User not found', 404, 'USER_NOT_FOUND');
    if (input.role === 'owner' && !isEligibleInvestigationOwner(user)) {
      throw new InvestigationPolicyError('An owner must be an active human administrator or analyst', 400, 'INELIGIBLE_OWNER');
    }
    const [member] = await tx.select().from(investigationMembers)
      .where(and(eq(investigationMembers.folderId, input.folderId), eq(investigationMembers.userId, input.targetUserId))).for('update');
    if (input.operation === 'add' && member) {
      if (input.actor.kind === 'admin') return { folder, user, changed: false };
      throw new InvestigationPolicyError('User already a member', 409, 'USER_ALREADY_MEMBER');
    }
    if (input.operation !== 'add' && !member) throw new InvestigationPolicyError('Member not found', 404, 'MEMBER_NOT_FOUND');
    const protectedFolders = member?.role === 'owner' && isEligibleInvestigationOwner(user) ? [folder.id] : [];
    if (input.operation === 'add') await tx.insert(investigationMembers).values({ id: nanoid(), folderId: folder.id, userId: user.id, role: input.role });
    else if (input.operation === 'update') await tx.update(investigationMembers).set({ role: input.role }).where(eq(investigationMembers.id, member.id));
    else await tx.delete(investigationMembers).where(eq(investigationMembers.id, member.id));
    await assertEligibleOwnersRemain(tx, protectedFolders);
    return { folder, user, changed: true };
  });
}
