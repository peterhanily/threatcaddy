import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { logger } from '../lib/logger.js';

/**
 * Encrypts/decrypts bot API keys and secrets at rest.
 * Uses AES-256-GCM with a server master key derived via scrypt.
 *
 * S3: Each secret gets a random 32-byte salt for key derivation,
 * stored alongside the ciphertext: enc2:<salt>:<iv>:<authTag>:<ciphertext> (base64).
 *
 * Legacy format (enc:<iv>:<authTag>:<ciphertext>) uses a static salt and is
 * still supported for decryption (backward compat).
 *
 * Master key source: BOT_MASTER_KEY env var (required in production).
 * If not set, a random key is generated for development (secrets won't survive restarts).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const LEGACY_SALT = Buffer.from('threatcaddy-bot-secrets-v1');

// Cache derived keys by salt hex to avoid re-deriving for the same salt
const derivedKeyCache = new Map<string, Buffer>();

let masterKeyStr: string | null = null;

function getMasterKey(): string {
  if (masterKeyStr) return masterKeyStr;
  masterKeyStr = process.env.BOT_MASTER_KEY || null;
  if (!masterKeyStr) {
    logger.warn(
      'BOT_MASTER_KEY is not set — generating a random key. ' +
      'Bot secrets will NOT survive server restarts. Set BOT_MASTER_KEY in production.',
    );
    masterKeyStr = randomBytes(32).toString('hex');
  }
  return masterKeyStr;
}

function deriveKey(salt: Buffer): Buffer {
  const cacheKey = salt.toString('hex');
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const key = scryptSync(getMasterKey(), salt, 32);
  derivedKeyCache.set(cacheKey, key);
  return key;
}

/** Encrypt a plaintext secret. Returns 'enc2:' prefixed string with per-secret random salt. */
export function encryptSecret(plaintext: string): string {
  // S3: Generate a random 32-byte salt per secret
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: enc2:<salt>:<iv>:<authTag>:<ciphertext> (all base64)
  return `enc2:${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypt an encrypted secret. Supports both enc2: (per-secret salt) and legacy enc: (static salt). */
export function decryptSecret(encrypted: string): string {
  if (encrypted.startsWith('enc2:')) {
    // New format with per-secret random salt
    const parts = encrypted.slice(5).split(':');
    if (parts.length !== 4) {
      throw new Error('Malformed encrypted secret (enc2 format)');
    }

    const salt = Buffer.from(parts[0], 'base64');
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');

    const key = deriveKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  if (encrypted.startsWith('enc:')) {
    // Legacy format with static salt — backward compatible decryption
    const parts = encrypted.slice(4).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted secret');
    }

    const key = deriveKey(LEGACY_SALT);
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  // Not encrypted — return as-is (for backwards compat during migration)
  return encrypted;
}

/**
 * Process a bot config object, encrypting any plaintext secret fields.
 * Convention: keys ending in 'Key', 'Secret', 'Token', or 'Password' are secrets.
 */
export function encryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      result[key] = encryptConfigSecrets(value as Record<string, unknown>);
    } else if (isSecretField(key) && typeof value === 'string' && value && !isEncrypted(value)) {
      // Don't re-encrypt redacted sentinel values — these come from the admin UI
      // when editing a bot without changing the secret fields
      if (value === '***configured***' || value === '***not set***') {
        // Preserve the existing encrypted value — caller must merge with existing config
        result[key] = value;
      } else {
        result[key] = encryptSecret(value);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Process a bot config object, decrypting any encrypted secret fields.
 * Only call this in the bot runtime — never expose decrypted config via API.
 */
export function decryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      result[key] = decryptConfigSecrets(value as Record<string, unknown>);
    } else if (typeof value === 'string' && isEncrypted(value)) {
      try {
        result[key] = decryptSecret(value);
      } catch (err) {
        logger.error('Failed to decrypt bot secret — this likely means the BOT_MASTER_KEY has changed or the value is corrupt', { key, error: String(err) });
        throw new Error(`Decryption failed for secret field "${key}": ${String(err)}. Check that BOT_MASTER_KEY matches the key used at encryption time.`);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redact secret fields for API responses.
 * Returns config with secret values replaced by '***configured***' or '***not set***'.
 */
export function redactConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested objects
      result[key] = redactConfigSecrets(value as Record<string, unknown>);
    } else if (isSecretField(key)) {
      result[key] = typeof value === 'string' && value.length > 0 ? '***configured***' : '***not set***';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Returns true if value is already encrypted (enc: or enc2: prefix). */
function isEncrypted(value: string): boolean {
  return value.startsWith('enc:') || value.startsWith('enc2:');
}

const SECRET_SUFFIXES = ['secret', 'password', 'token', 'apikey', 'api_key', 'auth_key', 'private_key', 'encryption_key'];

function isSecretField(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_SUFFIXES.some(suffix => lower.endsWith(suffix) || lower === suffix);
}
