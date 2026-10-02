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
 * Master key source: a stable, explicitly configured BOT_MASTER_KEY.
 * No environment may persist credentials with an ephemeral fallback key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const LEGACY_SALT = Buffer.from('threatcaddy-bot-secrets-v1');

// Bound decrypted-key retention; random salts used for encryption are not cached.
const MAX_CACHED_KEYS = 128;
const derivedKeyCache = new Map<string, Buffer>();
let masterKeyStr: string | null = null;

/** Validate without normalizing the value: changing key bytes loses old ciphertext. */
export function validateMasterKey(value = process.env.BOT_MASTER_KEY): string {
  if (!value || value.trim() !== value || value.length < 32 || value.length > 1024) {
    throw new Error('BOT_MASTER_KEY must be a stable configured key of 32–1024 characters without surrounding whitespace. Recommended: 64 hexadecimal characters. Preserve the existing key when upgrading.');
  }
  return value;
}

function getMasterKey(): string {
  const configured = validateMasterKey();
  if (masterKeyStr && masterKeyStr !== configured) {
    throw new Error('BOT_MASTER_KEY changed while the server was running. Use the documented offline key rotation procedure.');
  }
  masterKeyStr = configured;
  return configured;
}

function deriveKey(salt: Buffer, cache = true): Buffer {
  const master = getMasterKey();
  const cacheKey = salt.toString('hex');
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const key = scryptSync(master, salt, 32);
  if (cache) {
    if (derivedKeyCache.size >= MAX_CACHED_KEYS) {
      const oldest = derivedKeyCache.keys().next().value;
      if (oldest !== undefined) {
        derivedKeyCache.get(oldest)?.fill(0);
        derivedKeyCache.delete(oldest);
      }
    }
    derivedKeyCache.set(cacheKey, key);
  }
  return key;
}

/** Encrypt a plaintext secret. Returns 'enc2:' prefixed string with per-secret random salt. */
export function encryptSecret(plaintext: string): string {
  // S3: Generate a random 32-byte salt per secret
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt, false);
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

const SENTINELS = new Set(['***configured***', '***not set***']);
// Names consumed by bot runtimes, plus the supported legacy suffix convention.
// Normalize separators so privateKey/private_key and authKey/auth_key agree.
const SECRET_SUFFIXES = ['secret', 'password', 'token', 'apikey', 'authkey', 'privatekey', 'encryptionkey', 'passphrase', 'authorization'];
export function isSecretField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_\-.]/g, '');
  return SECRET_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

function mapConfig(value: unknown, key: string, transform: (value: unknown, key: string) => unknown): unknown {
  if (Array.isArray(value)) return value.map(item => mapConfig(item, key, transform));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, mapConfig(child, name, transform)]));
  }
  return transform(value, key);
}

/** Encrypt all supported plaintext credential fields, including nested arrays. */
export function encryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  return mapConfig(config, '', (value, key) => {
    if (isSecretField(key) && typeof value === 'string' && value && !isEncrypted(value) && !SENTINELS.has(value)) {
      return encryptSecret(value);
    }
    return value;
  }) as Record<string, unknown>;
}

/** Runtime only: decrypt ciphertext without exposing values or crypto errors in logs. */
export function decryptConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  return mapConfig(config, '', (value, key) => {
    if (typeof value !== 'string' || !isEncrypted(value)) return value;
    try { return decryptSecret(value); }
    catch {
      logger.error('Failed to decrypt bot secret; verify the configured master key and stored ciphertext');
      throw new Error(`Decryption failed for secret field "${key}". Verify BOT_MASTER_KEY and stored ciphertext.`);
    }
  }) as Record<string, unknown>;
}

/** Mask recognized secrets and ciphertext on every API configuration path. */
export function redactConfigSecrets(config: Record<string, unknown>): Record<string, unknown> {
  return mapConfig(config, '', (value, key) => {
    if (isSecretField(key) || (typeof value === 'string' && isEncrypted(value))) {
      return typeof value === 'string' && value.length > 0 ? '***configured***' : '***not set***';
    }
    return value;
  }) as Record<string, unknown>;
}

/** Return field paths only for operator exposure review; never include credential values. */
export function findPlaintextSecretPaths(config: Record<string, unknown>): string[] {
  const paths: string[] = [];
  function visit(value: unknown, key: string, path: string) {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, key, `${path}[${index}]`));
    if (value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) visit(child, name, path ? `${path}.${name}` : name);
    } else if (isSecretField(key) && typeof value === 'string' && value && !isEncrypted(value) && !SENTINELS.has(value)) paths.push(path);
  }
  visit(config, '', '');
  return paths;
}

function isEncrypted(value: string): boolean {
  return value.startsWith('enc:') || value.startsWith('enc2:');
}
