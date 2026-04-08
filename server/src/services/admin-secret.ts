import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/index.js';
import { serverSettings, folders, investigationMembers, users, adminUsers } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export const ADMIN_SYSTEM_USER_ID = '__system_admin__';

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
    logger.info('Admin bootstrap secret set from ADMIN_SECRET env var');
    return;
  }

  // No env var — check DB
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (existing.length > 0) {
    logger.info('Using existing admin bootstrap secret from database');
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
      logger.info(`Generated new admin bootstrap secret — written to ${secretFilePath} (read and delete it)`);
    } catch {
      // Fall back to stderr if file write fails (e.g. read-only FS) — never log the secret to structured logs
      logger.warn('Generated new admin bootstrap secret — could not write to file. Set ADMIN_SECRET env var or mount a writable volume at FILE_STORAGE_PATH');
    }
  } else {
    logger.info('Another instance set the admin bootstrap secret first, using that');
  }
}

// ─── Server Name ────────────────────────────────────────────────

const SERVER_NAME_KEY = 'server_name';

// Adjective + noun random name generator
function generateRandomName(): string {
  const adjectives = [
    'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Falcon', 'Ghost',
    'Hawk', 'Iron', 'Jade', 'Kilo', 'Luna', 'Mystic', 'Nova', 'Onyx',
    'Phoenix', 'Quantum', 'Raven', 'Shadow', 'Titan', 'Ultra', 'Viper',
    'Wolf', 'Zenith', 'Apex', 'Blaze', 'Cipher', 'Dagger', 'Ember',
  ];
  const nouns = [
    'Base', 'Hub', 'Ops', 'Node', 'Lab', 'Vault', 'Forge', 'Core',
    'Station', 'Nexus', 'Tower', 'Grid', 'Deck', 'Watch', 'Post',
    'Gate', 'Shield', 'Camp', 'Den', 'Hive', 'Bunker', 'Outpost',
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

export async function initServerName(): Promise<void> {
  const envName = process.env.SERVER_NAME?.trim();

  if (envName) {
    const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SERVER_NAME_KEY)).limit(1);
    if (existing.length > 0) {
      await db.update(serverSettings).set({ value: envName, updatedAt: new Date() }).where(eq(serverSettings.key, SERVER_NAME_KEY));
    } else {
      await db.insert(serverSettings).values({ key: SERVER_NAME_KEY, value: envName });
    }
    logger.info(`Server name set from SERVER_NAME env var: ${envName}`);
    return;
  }

  // No env var — check DB
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SERVER_NAME_KEY)).limit(1);
  if (existing.length > 0) return;

  // Generate random name
  const name = generateRandomName();
  await db.insert(serverSettings).values({ key: SERVER_NAME_KEY, value: name }).onConflictDoNothing();
  logger.info(`Generated random server name: ${name}`);
}

export async function getServerName(): Promise<string> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, SERVER_NAME_KEY)).limit(1);
  if (row.length === 0) return 'ThreatCaddy';
  return row[0].value;
}

export async function setServerName(name: string): Promise<void> {
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, SERVER_NAME_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(serverSettings).set({ value: name, updatedAt: new Date() }).where(eq(serverSettings.key, SERVER_NAME_KEY));
  } else {
    await db.insert(serverSettings).values({ key: SERVER_NAME_KEY, value: name });
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
  const parsedTtl = ttlRow.length > 0 ? parseInt(ttlRow[0].value, 10) : NaN;
  const parsedMax = maxRow.length > 0 ? parseInt(maxRow[0].value, 10) : NaN;
  return {
    ttlHours: isFinite(parsedTtl) && parsedTtl >= 1 ? parsedTtl : 24,
    maxPerUser: isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 0,
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
    if (ownerExists.length === 0 && f.createdBy) {
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

export async function initAdminSystemUser(): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, ADMIN_SYSTEM_USER_ID)).limit(1);
  if (existing.length > 0) return;
  const hash = await argon2.hash(nanoid(32), { type: argon2.argon2id });
  await db.insert(users).values({
    id: ADMIN_SYSTEM_USER_ID,
    email: 'system@threatcaddy.internal',
    displayName: 'System Admin',
    passwordHash: hash,
    role: 'admin',
    active: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
  logger.info('System admin sentinel user created');
}

// ─── Bootstrap Secret ───────────────────────────────────────────

export async function verifyBootstrapSecret(plaintext: string): Promise<boolean> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, SETTINGS_KEY)).limit(1);
  if (row.length === 0) return false;
  try {
    return await argon2.verify(row[0].value, plaintext);
  } catch {
    return false;
  }
}

export async function changeAdminSecret(currentPlaintext: string, newPlaintext: string): Promise<boolean> {
  const valid = await verifyBootstrapSecret(currentPlaintext);
  if (!valid) return false;
  const hash = await argon2.hash(newPlaintext, { type: argon2.argon2id });
  await db.update(serverSettings).set({ value: hash, updatedAt: new Date() }).where(eq(serverSettings.key, SETTINGS_KEY));
  return true;
}

// ─── Admin User CRUD ────────────────────────────────────────────

export async function getAdminUserCount(): Promise<number> {
  const rows = await db.select({ id: adminUsers.id }).from(adminUsers);
  return rows.length;
}

export async function listAdminUsers(): Promise<Array<{
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}>> {
  return db.select({
    id: adminUsers.id,
    username: adminUsers.username,
    displayName: adminUsers.displayName,
    active: adminUsers.active,
    createdAt: adminUsers.createdAt,
    lastLoginAt: adminUsers.lastLoginAt,
  }).from(adminUsers).orderBy(adminUsers.createdAt);
}

export async function createAdminUser(username: string, displayName: string, password: string): Promise<{ id: string; username: string; displayName: string }> {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const id = nanoid();
  await db.insert(adminUsers).values({
    id,
    username: username.toLowerCase().trim(),
    displayName: displayName.trim(),
    passwordHash: hash,
  });
  return { id, username: username.toLowerCase().trim(), displayName: displayName.trim() };
}

export async function verifyAdminUser(username: string, password: string): Promise<{ id: string; username: string; displayName: string } | null> {
  const rows = await db.select().from(adminUsers)
    .where(and(eq(adminUsers.username, username.toLowerCase().trim()), eq(adminUsers.active, true)))
    .limit(1);
  if (rows.length === 0) return null;
  const user = rows[0];
  try {
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) return null;
  } catch {
    return null;
  }
  // Update last login
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  return { id: user.id, username: user.username, displayName: user.displayName };
}

export async function verifyAdminUserById(id: string, password: string): Promise<boolean> {
  const rows = await db.select().from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  if (rows.length === 0) return false;
  try {
    return await argon2.verify(rows[0].passwordHash, password);
  } catch {
    return false;
  }
}

export async function updateAdminUser(id: string, updates: { displayName?: string; active?: boolean }): Promise<boolean> {
  const result = await db.update(adminUsers).set(updates).where(eq(adminUsers.id, id)).returning({ id: adminUsers.id });
  return result.length > 0;
}

export async function changeAdminUserPassword(id: string, newPassword: string): Promise<boolean> {
  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  const result = await db.update(adminUsers).set({ passwordHash: hash }).where(eq(adminUsers.id, id)).returning({ id: adminUsers.id });
  return result.length > 0;
}

export async function deleteAdminUser(id: string): Promise<boolean> {
  const result = await db.delete(adminUsers).where(eq(adminUsers.id, id)).returning({ id: adminUsers.id });
  return result.length > 0;
}

// ─── AI Assistant Settings ───────────────────────────────────────

export interface AiAssistantSettings {
  localEndpoint: string;
  localApiKey: string;
  localModelName: string;
  customSystemPrompt: string;
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
}

const AI_SETTINGS_DEFAULTS: AiAssistantSettings = {
  localEndpoint: '',
  localApiKey: '',
  localModelName: '',
  customSystemPrompt: '',
  defaultProvider: '',
  defaultModel: '',
  temperature: 0.7,
};

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).limit(1);
  return row.length > 0 ? row[0].value : null;
}

async function setSettingValue(key: string, value: string): Promise<void> {
  const existing = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(serverSettings).set({ value, updatedAt: new Date() }).where(eq(serverSettings.key, key));
  } else {
    await db.insert(serverSettings).values({ key, value });
  }
}

export async function getAiSettings(): Promise<AiAssistantSettings> {
  const [endpoint, apiKey, modelName, systemPrompt, provider, model, temp] = await Promise.all([
    getSettingValue('ai_local_endpoint'),
    getSettingValue('ai_local_api_key'),
    getSettingValue('ai_local_model_name'),
    getSettingValue('ai_custom_system_prompt'),
    getSettingValue('ai_default_provider'),
    getSettingValue('ai_default_model'),
    getSettingValue('ai_temperature'),
  ]);

  return {
    localEndpoint: endpoint || AI_SETTINGS_DEFAULTS.localEndpoint,
    localApiKey: apiKey || AI_SETTINGS_DEFAULTS.localApiKey,
    localModelName: modelName || AI_SETTINGS_DEFAULTS.localModelName,
    customSystemPrompt: systemPrompt || AI_SETTINGS_DEFAULTS.customSystemPrompt,
    defaultProvider: provider || AI_SETTINGS_DEFAULTS.defaultProvider,
    defaultModel: model || AI_SETTINGS_DEFAULTS.defaultModel,
    temperature: temp ? parseFloat(temp) : AI_SETTINGS_DEFAULTS.temperature,
  };
}

export async function setAiSettings(settings: Partial<AiAssistantSettings>): Promise<void> {
  const updates: Array<Promise<void>> = [];
  if (settings.localEndpoint !== undefined) updates.push(setSettingValue('ai_local_endpoint', settings.localEndpoint));
  if (settings.localApiKey !== undefined) updates.push(setSettingValue('ai_local_api_key', settings.localApiKey));
  if (settings.localModelName !== undefined) updates.push(setSettingValue('ai_local_model_name', settings.localModelName));
  if (settings.customSystemPrompt !== undefined) updates.push(setSettingValue('ai_custom_system_prompt', settings.customSystemPrompt));
  if (settings.defaultProvider !== undefined) updates.push(setSettingValue('ai_default_provider', settings.defaultProvider));
  if (settings.defaultModel !== undefined) updates.push(setSettingValue('ai_default_model', settings.defaultModel));
  if (settings.temperature !== undefined) updates.push(setSettingValue('ai_temperature', String(settings.temperature)));
  await Promise.all(updates);
}
