import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/index.js';
import { serverSettings, folders, investigationMembers } from '../db/schema.js';
import { logger } from '../lib/logger.js';

const SETTINGS_KEY = 'admin_secret_hash';

export async function initAdminSecret(): Promise<void> {
  const envSecret = process.env.ADMIN_SECRET?.trim();

  if (envSecret) {
    // Env var provided — hash and upsert
    const hash = await argon2.hash(envSecret, { type: argon2.argon2id });
    const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
    if (existing.length > 0) {
      await db.update(serverSettings).set({ value: hash, updatedAt: new Date() }).where(eq(serverSettings.key, SETTINGS_KEY));
    } else {
      await db.insert(serverSettings).values({ key: SETTINGS_KEY, value: hash });
    }
    logger.info('Admin secret set from ADMIN_SECRET env var');
    return;
  }

  // No env var — check DB
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (existing.length > 0) {
    logger.info('Using existing admin secret from database');
    return;
  }

  // No env var, no DB entry — generate new secret and write to file
  const secret = nanoid(32);
  const hash = await argon2.hash(secret, { type: argon2.argon2id });

  await db.insert(serverSettings).values({ key: SETTINGS_KEY, value: hash }).onConflictDoNothing();

  const inserted = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (inserted.length > 0 && inserted[0].value === hash) {
    // Write to file instead of stdout to avoid log exposure
    const secretFilePath = join(process.env.FILE_STORAGE_PATH || '/data/files', '.admin-secret');
    try {
      await writeFile(secretFilePath, secret, { mode: 0o600 });
      logger.info(`Generated new admin secret — written to ${secretFilePath} (read and delete it)`);
    } catch {
      // Fall back to logger if file write fails (e.g. read-only FS)
      logger.warn('Generated new admin secret — could not write to file, check structured logs');
      logger.info('Admin secret value', { adminSecret: secret, _onetime: true });
    }
  } else {
    logger.info('Another instance set the admin secret first, using that');
  }
}

// ─── Registration Mode ──────────────────────────────────────────

const REG_MODE_KEY = 'registration_mode';

export async function initRegistrationMode(): Promise<void> {
  await db.insert(serverSettings)
    .values({ key: REG_MODE_KEY, value: 'invite' })
    .onConflictDoNothing();
  logger.info('Registration mode initialized');
}

export async function getRegistrationMode(): Promise<'invite' | 'open'> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, REG_MODE_KEY)).limit(1);
  if (row.length === 0) return 'invite';
  return row[0].value === 'open' ? 'open' : 'invite';
}

export async function setRegistrationMode(mode: 'invite' | 'open'): Promise<void> {
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, REG_MODE_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(serverSettings).set({ value: mode, updatedAt: new Date() }).where(eq(serverSettings.key, REG_MODE_KEY));
  } else {
    await db.insert(serverSettings).values({ key: REG_MODE_KEY, value: mode });
  }
}

// ─── Session Settings ───────────────────────────────────────────

export async function getSessionSettings(): Promise<{ ttlHours: number; maxPerUser: number }> {
  const ttlRow = await db.select().from(serverSettings).where(eq(serverSettings.key, 'session_ttl_hours')).limit(1);
  const maxRow = await db.select().from(serverSettings).where(eq(serverSettings.key, 'max_sessions_per_user')).limit(1);
  return {
    ttlHours: ttlRow.length > 0 ? parseInt(ttlRow[0].value, 10) : 24,
    maxPerUser: maxRow.length > 0 ? parseInt(maxRow[0].value, 10) : 0,
  };
}

export async function setSessionSettings(ttlHours: number, maxPerUser: number): Promise<void> {
  for (const [key, value] of [['session_ttl_hours', String(ttlHours)], ['max_sessions_per_user', String(maxPerUser)]] as const) {
    const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(serverSettings).set({ value, updatedAt: new Date() }).where(eq(serverSettings.key, key));
    } else {
      await db.insert(serverSettings).values({ key, value });
    }
  }
}

// ─── Backfill Folder Owners ─────────────────────────────────────

export async function backfillFolderOwners(): Promise<void> {
  const allFolders = await db.select({ id: folders.id, createdBy: folders.createdBy }).from(folders);
  let backfilled = 0;
  for (const f of allFolders) {
    const ownerExists = await db
      .select({ id: investigationMembers.id })
      .from(investigationMembers)
      .where(and(eq(investigationMembers.folderId, f.id), eq(investigationMembers.role, 'owner')))
      .limit(1);
    if (ownerExists.length === 0) {
      await db.insert(investigationMembers).values({
        id: nanoid(),
        folderId: f.id,
        userId: f.createdBy,
        role: 'owner',
      }).onConflictDoNothing();
      backfilled++;
    }
  }
  if (backfilled > 0) {
    logger.info(`Backfilled owner membership for ${backfilled} folder(s)`);
  }
}

export async function verifyAdminSecret(plaintext: string): Promise<boolean> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (row.length === 0) return false;
  try {
    return await argon2.verify(row[0].value, plaintext);
  } catch {
    return false;
  }
}

export async function changeAdminSecret(currentPlaintext: string, newPlaintext: string): Promise<boolean> {
  const valid = await verifyAdminSecret(currentPlaintext);
  if (!valid) return false;
  const hash = await argon2.hash(newPlaintext, { type: argon2.argon2id });
  await db.update(serverSettings).set({ value: hash, updatedAt: new Date() }).where(eq(serverSettings.key, SETTINGS_KEY));
  return true;
}
