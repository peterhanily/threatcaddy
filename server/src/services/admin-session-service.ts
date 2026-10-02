import { and, eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { adminUsers, serverSettings } from '../db/schema.js';

// Admin signing keys already live per process and rotate on restart. Retain revocation epochs for that same lifetime.
const adminRevocations = new Map<string, string>();
export const adminSessionVersion = (id: string): string => adminRevocations.get(id) ?? '';
export function revokeAdminSessions(id: string): void { adminRevocations.set(id, nanoid(24)); }

export async function getActiveAdmin(id: string) {
  const [admin] = await db.select({ id: adminUsers.id, username: adminUsers.username, passwordHash: adminUsers.passwordHash }).from(adminUsers).where(and(eq(adminUsers.id, id), eq(adminUsers.active, true))).limit(1);
  return admin;
}

export async function hasActiveAdmin(): Promise<boolean> {
  return (await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.active, true)).limit(1)).length > 0;
}

/** Bootstrap credentials permit setup/recovery only while no active administrator exists. */
export async function bootstrapAdminUser(secret: string, username: string, displayName: string, password: string) {
  return db.transaction(async tx => {
    // This existing settings row serializes simultaneous bootstrap attempts without adding schema.
    const [setting] = await tx.select().from(serverSettings).where(eq(serverSettings.key, 'admin_secret_hash')).for('update');
    if (!setting || !await argon2.verify(setting.value, secret)) return { error: 'invalid' as const };
    if ((await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.active, true)).limit(1)).length) return { error: 'configured' as const };
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const admin = { id: nanoid(), username: username.toLowerCase().trim(), displayName: displayName.trim() };
    await tx.insert(adminUsers).values({ ...admin, passwordHash });
    return { admin, passwordHash };
  });
}
