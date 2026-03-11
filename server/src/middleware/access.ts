import { createMiddleware } from 'hono/factory';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { investigationMembers } from '../db/schema.js';
import type { AuthUser, InvestigationRole } from '../types.js';

const ROLE_LEVELS: Record<string, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export async function checkInvestigationAccess(
  userId: string,
  folderId: string,
  minRole: InvestigationRole = 'viewer'
): Promise<boolean> {
  const member = await db
    .select()
    .from(investigationMembers)
    .where(
      and(
        eq(investigationMembers.userId, userId),
        eq(investigationMembers.folderId, folderId)
      )
    )
    .limit(1);

  if (member.length === 0) return false;
  return (ROLE_LEVELS[member[0].role] ?? 0) >= (ROLE_LEVELS[minRole] ?? 0);
}

// Middleware that checks investigation access based on folderId param or body
export function requireInvestigationAccess(minRole: InvestigationRole = 'viewer') {
  return createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
    const user = c.get('user');

    const folderId = c.req.param('folderId') || c.req.query('folderId');
    if (!folderId) {
      return c.json({ error: 'Missing folderId' }, 400);
    }

    const hasAccess = await checkInvestigationAccess(user.id, folderId, minRole);
    if (!hasAccess) {
      return c.json({ error: 'No access to this investigation' }, 403);
    }

    await next();
  });
}
