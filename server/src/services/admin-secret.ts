import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { serverSettings } from '../db/schema.js';
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

  // No env var, no DB entry — generate new secret
  const secret = nanoid(32);
  const hash = await argon2.hash(secret, { type: argon2.argon2id });

  // INSERT ... ON CONFLICT DO NOTHING to handle race conditions
  await db.insert(serverSettings).values({ key: SETTINGS_KEY, value: hash }).onConflictDoNothing();

  // Verify we won the race
  const inserted = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (inserted.length > 0 && inserted[0].value === hash) {
    // We won — print the secret
    const banner = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║  ADMIN SECRET (save this — it will not be shown again):     ║',
      `║  ${secret.padEnd(56)} ║`,
      '║  Set ADMIN_SECRET env var to use your own.                  ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
    ].join('\n');
    // Print directly to stdout so it's visible even with structured logging
    process.stdout.write(banner + '\n');
    logger.info('Generated new admin secret');
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

export async function verifyAdminSecret(plaintext: string): Promise<boolean> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (row.length === 0) return false;
  try {
    return await argon2.verify(row[0].value, plaintext);
  } catch {
    return false;
  }
}
