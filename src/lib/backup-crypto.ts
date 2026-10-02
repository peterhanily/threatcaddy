/**
 * Encrypted backup envelope — password-based AES-256-GCM encryption.
 * Reuses PBKDF2 config from crypto.ts but derives AES-GCM keys (not AES-KW).
 */

import { generateSalt, arrayBufferToBase64, base64ToArrayBuffer } from './crypto';

const PBKDF2_ITERATIONS = 600_000;
const IV_BYTES = 12;

export interface EncryptedBackupBlob {
  v: 1;
  salt: string;  // base64
  iv: string;    // base64
  ct: string;    // base64 ciphertext
}

export interface BackupPayload {
  version: 1 | 2;
  type: 'full' | 'differential';
  scope: 'all' | 'investigation' | 'entity';
  scopeId?: string;
  parentBackupId?: string;
  createdAt: number;
  lastBackupAt?: number;
  /** Version 2 differentials bind the exact full parent and both scoped states. */
  baseFingerprint?: string;
  baseStateFingerprint?: string;
  resultFingerprint?: string;
  data: {
    notes?: unknown[];
    tasks?: unknown[];
    folders?: unknown[];
    tags?: unknown[];
    timelineEvents?: unknown[];
    timelines?: unknown[];
    whiteboards?: unknown[];
    standaloneIOCs?: unknown[];
    evidenceItems?: unknown[];
    chatThreads?: unknown[];
    agentActions?: unknown[];
    agentProfiles?: unknown[];
    agentDeployments?: unknown[];
    agentMeetings?: unknown[];
    noteTemplates?: unknown[];
    playbookTemplates?: unknown[];
    integrationTemplates?: unknown[];
    installedIntegrations?: unknown[];
    customSlashCommands?: unknown[];
  };
  deletedIds?: Record<string, string[]>;
}

/** Canonical JSON, matching JSON backup serialization while ignoring key order. */
export function canonicalBackupJSON(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, entry]) => [key, canonical(entry)]),
    );
    return item;
  }
  return JSON.stringify(canonical(JSON.parse(JSON.stringify(value))));
}

function orderedData(data: BackupPayload['data']): BackupPayload['data'] {
  return Object.fromEntries(Object.entries(data).map(([name, rows]) => [name,
    [...(rows ?? [])].sort((a, b) => {
      const left = String((a as { id?: unknown })?.id);
      const right = String((b as { id?: unknown })?.id);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  ]));
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBackupJSON(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function backupFingerprint(payload: BackupPayload): Promise<string> {
  return fingerprint({ ...payload, data: orderedData(payload.data) });
}

export function backupStateFingerprint(payload: Pick<BackupPayload, 'scope' | 'scopeId' | 'data'>): Promise<string> {
  return fingerprint({ scope: payload.scope, scopeId: payload.scopeId, data: orderedData(payload.data) });
}

async function deriveBackupKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup<T extends object>(password: string, payload: T): Promise<EncryptedBackupBlob> {
  const salt = generateSalt();
  const saltBuf = base64ToArrayBuffer(salt);
  const key = await deriveBackupKey(password, saltBuf);

  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );

  return {
    v: 1,
    salt,
    iv: arrayBufferToBase64(iv.buffer),
    ct: arrayBufferToBase64(ct),
  };
}

export async function decryptBackup<T = BackupPayload>(password: string, blob: EncryptedBackupBlob): Promise<T> {
  if (blob.v !== 1) throw new Error('Unsupported backup format version');

  const saltBuf = base64ToArrayBuffer(blob.salt);
  const key = await deriveBackupKey(password, saltBuf);

  const ivBuf = base64ToArrayBuffer(blob.iv);
  const ctBuf = base64ToArrayBuffer(blob.ct);

  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuf },
      key,
      ctBuf,
    );
  } catch {
    throw new Error('Wrong password or corrupted backup');
  }

  const plaintext = new TextDecoder().decode(plainBuf);
  return JSON.parse(plaintext) as T;
}
