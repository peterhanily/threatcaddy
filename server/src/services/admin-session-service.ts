import { and, eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db, type DB } from '../db/index.js';
import { adminUsers, serverSettings } from '../db/schema.js';

// Admin signing keys already live per process and rotate on restart. Retain revocation epochs for that same lifetime.
const adminRevocations = new Map<string, string>();
export const adminSessionVersion = (id: string): string => adminRevocations.get(id) ?? '';
export function revokeAdminSessions(id: string): void { adminRevocations.set(id, nanoid(24)); }

export async function getActiveAdmin(id: string, database: Pick<DB, 'select'> = db, lock = false) {
  const query = database.select({ id: adminUsers.id, username: adminUsers.username, passwordHash: adminUsers.passwordHash }).from(adminUsers).where(and(eq(adminUsers.id, id), eq(adminUsers.active, true))).limit(1);
  const [admin] = await (lock ? query.for('share') : query);
  return admin;
}

export async function hasActiveAdmin(): Promise<boolean> {
  return (await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.active, true)).limit(1)).length > 0;
}

/** Bootstrap credentials permit setup/recovery only while no active administrator exists. */
let bootstrapInFlight = false;

export async function bootstrapAdminUser(secret: string, username: string, displayName: string, password: string) {
  // The runtime lease permits one process per database. Reject excess work
  // instead of queuing password hashing or holding database locks while hashing.
  if (bootstrapInFlight) return { error: 'busy' as const };
  bootstrapInFlight = true;
  try {
    if (await hasActiveAdmin()) return { error: 'configured' as const };
    const [setting] = await db.select().from(serverSettings).where(eq(serverSettings.key, 'admin_secret_hash'));
    if (!setting || !await argon2.verify(setting.value, secret)) return { error: 'invalid' as const };
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return await db.transaction(async tx => {
      // Serialize the final state change and recheck both authorization inputs.
      const [current] = await tx.select().from(serverSettings).where(eq(serverSettings.key, 'admin_secret_hash')).for('update');
      if ((await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.active, true)).limit(1)).length) return { error: 'configured' as const };
      if (!current || current.value !== setting.value) return { error: 'invalid' as const };
      const admin = { id: nanoid(), username: username.toLowerCase().trim(), displayName: displayName.trim() };
      await tx.insert(adminUsers).values({ ...admin, passwordHash });
      return { admin, passwordHash };
    });
  } finally {
    bootstrapInFlight = false;
  }
}
