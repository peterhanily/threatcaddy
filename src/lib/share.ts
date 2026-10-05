import pako from 'pako';
import { sanitizeSharePayload } from './share-data';
import type { Note, Task, TimelineEvent, Timeline, Whiteboard, StandaloneIOC, Folder, Tag, ChatThread } from '../types';

// --- Payload types ---

export interface InvestigationBundle {
  folder: Folder;
  notes: Note[];
  tasks: Task[];
  events: TimelineEvent[];
  timelines: Timeline[];
  whiteboards: Whiteboard[];
  iocs: StandaloneIOC[];
  chatThreads: ChatThread[];
  tags: Tag[];
}

export type ShareScope = 'note' | 'task' | 'event' | 'whiteboard' | 'ioc' | 'investigation' | 'chat';

export interface SharePayload {
  v: 1;
  s: ShareScope;
  t: number; // sharedAt
  d: Note | Task | TimelineEvent | Whiteboard | StandaloneIOC | InvestigationBundle | ChatThread;
}

export const MAX_URL_LENGTH = 32_000;
export const MAX_SHARE_ENCODED_LENGTH = 2 * 1024 * 1024;
export const MAX_SHARE_DECODED_BYTES = 8 * 1024 * 1024;

// --- Helpers ---

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  // Restore standard base64
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Encryption (Web Crypto API) ---

// 600k iterations per OWASP guidelines for PBKDF2-SHA256 (matches main crypto module)
const PBKDF2_ITERATIONS = 600_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource,
  ));
  // [16-byte salt][12-byte IV][ciphertext]
  const result = new Uint8Array(salt.length + iv.length + ciphertext.length);
  result.set(salt, 0);
  result.set(iv, 16);
  result.set(ciphertext, 28);
  return result;
}

async function decrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ciphertext = data.slice(28);
  const key = await deriveKey(password, salt);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource,
  ));
}

// --- Public API ---

/** Flags byte: bit 0 = encrypted */
const FLAG_ENCRYPTED = 0x01;

export async function encodeSharePayload(payload: SharePayload, password?: string): Promise<string> {
  const json = JSON.stringify(sanitizeSharePayload(payload));
  const enc = new TextEncoder();
  const bytes = enc.encode(json);
  if (bytes.byteLength > MAX_SHARE_DECODED_BYTES) throw new Error('Share content is too large; export a file instead');
  const compressed = pako.deflate(bytes);

  let flags = 0;
  let body: Uint8Array;

  if (password) {
    flags |= FLAG_ENCRYPTED;
    body = await encrypt(compressed, password);
  } else {
    body = compressed;
  }

  // [1-byte flags][payload...]
  const blob = new Uint8Array(1 + body.length);
  blob[0] = flags;
  blob.set(body, 1);

  const encoded = toBase64Url(blob);
  if (encoded.length > MAX_SHARE_ENCODED_LENGTH) throw new Error('Share code is too large; export a file instead');
  return encoded;
}

/** The optional budget can only tighten the production limit (useful to constrained callers). */
export function inflateShareBody(body: Uint8Array, maxBytes = MAX_SHARE_DECODED_BYTES): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SHARE_DECODED_BYTES) throw new Error('Invalid share size budget');
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  const inflater = new pako.Inflate({ chunkSize: Math.min(16 * 1024, maxBytes + 1) });
  inflater.onData = chunk => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error('Share content exceeds the decoded size limit');
    chunks.push(bytes);
  };
  inflater.onEnd = status => { complete = status === 0; };
  inflater.push(body, true);
  if (!complete) throw new Error('Invalid or incomplete compressed share');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function decodeSharePayload(encoded: string, password?: string): Promise<SharePayload> {
  if (encoded.length > MAX_SHARE_ENCODED_LENGTH) throw new Error('Share code exceeds the encoded size limit');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) throw new Error('Invalid share encoding');
  const blob = fromBase64Url(encoded);
  const flags = blob[0];
  if (blob.length < 2 || (flags !== 0 && flags !== FLAG_ENCRYPTED)) throw new Error('Invalid share header');
  let body: Uint8Array = blob.slice(1);

  if (flags & FLAG_ENCRYPTED) {
    if (!password) throw new Error('Password required to decrypt this share');
    if (body.length < 44) throw new Error('Invalid encrypted share');
    body = await decrypt(body, password);
  }

  const dec = new TextDecoder();
  const json = dec.decode(inflateShareBody(body));
  return sanitizeSharePayload(JSON.parse(json));
}

export function isEncryptedShare(encoded: string): boolean {
  try {
    if (encoded.length > MAX_SHARE_ENCODED_LENGTH) return false;
    // Only the first byte is needed; do not allocate a decoded copy of the code here.
    const blob = fromBase64Url(encoded.slice(0, 4));
    return blob[0] === FLAG_ENCRYPTED;
  } catch {
    return false;
  }
}

export function buildShareUrl(encoded: string): string {
  return `${window.location.origin}${window.location.pathname}#share=${encoded}`;
}
