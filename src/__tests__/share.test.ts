import { describe, it, expect } from 'vitest';
import {
  encodeSharePayload,
  decodeSharePayload,
  isEncryptedShare,
  buildShareUrl,
  MAX_URL_LENGTH,
} from '../lib/share';
import type { SharePayload } from '../lib/share';
import type { Note, Task } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

function makeNote(): Note {
  return {
    id: 'note-1',
    title: 'Shared Note',
    content: 'Some investigation content.',
    tags: ['malware'],
    pinned: false,
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
  };
}

function makeTask(): Task {
  return {
    id: 'task-1',
    title: 'Review logs',
    status: 'todo',
    priority: 'high',
    completed: false,
    tags: [],
    order: 0,
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
  };
}

function makeNotePayload(): SharePayload {
  return { v: 1, s: 'note', t: Date.now(), d: makeNote() };
}

function makeTaskPayload(): SharePayload {
  return { v: 1, s: 'task', t: Date.now(), d: makeTask() };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('encodeSharePayload / decodeSharePayload', () => {
  it('round-trips a note payload', async () => {
    const payload = makeNotePayload();
    const encoded = await encodeSharePayload(payload);
    const decoded = await decodeSharePayload(encoded);

    expect(decoded.v).toBe(1);
    expect(decoded.s).toBe('note');
    expect(decoded.t).toBe(payload.t);
    expect((decoded.d as Note).id).toBe('note-1');
    expect((decoded.d as Note).title).toBe('Shared Note');
    expect((decoded.d as Note).content).toBe('Some investigation content.');
  });

  it('round-trips a task payload', async () => {
    const payload = makeTaskPayload();
    const encoded = await encodeSharePayload(payload);
    const decoded = await decodeSharePayload(encoded);

    expect(decoded.v).toBe(1);
    expect(decoded.s).toBe('task');
    expect((decoded.d as Task).id).toBe('task-1');
    expect((decoded.d as Task).title).toBe('Review logs');
    expect((decoded.d as Task).priority).toBe('high');
  });

  it('round-trips with encryption (password)', async () => {
    const payload = makeNotePayload();
    const password = 'hunter2';
    const encoded = await encodeSharePayload(payload, password);
    const decoded = await decodeSharePayload(encoded, password);

    expect(decoded.v).toBe(1);
    expect(decoded.s).toBe('note');
    expect((decoded.d as Note).id).toBe('note-1');
    expect((decoded.d as Note).title).toBe('Shared Note');
  });

  it('encrypted payload is different from unencrypted', async () => {
    const payload = makeNotePayload();
    const unencrypted = await encodeSharePayload(payload);
    const encrypted = await encodeSharePayload(payload, 'password123');

    expect(encrypted).not.toBe(unencrypted);
    // Encrypted payload should be longer (salt + IV + auth tag overhead)
    expect(encrypted.length).toBeGreaterThan(unencrypted.length);
  });
});

describe('isEncryptedShare', () => {
  it('returns true for encrypted payload', async () => {
    const payload = makeNotePayload();
    const encoded = await encodeSharePayload(payload, 'secret');
    expect(isEncryptedShare(encoded)).toBe(true);
  });

  it('returns false for unencrypted payload', async () => {
    const payload = makeNotePayload();
    const encoded = await encodeSharePayload(payload);
    expect(isEncryptedShare(encoded)).toBe(false);
  });

  it('returns false for garbage input', () => {
    expect(isEncryptedShare('not-valid-base64!!!')).toBe(false);
    expect(isEncryptedShare('')).toBe(false);
    // 'AA' decodes to a single zero-byte → flags=0 → not encrypted
    expect(isEncryptedShare('AA')).toBe(false);
  });
});

describe('decodeSharePayload error cases', () => {
  it('decoding encrypted payload without password throws', async () => {
    const payload = makeNotePayload();
    const encoded = await encodeSharePayload(payload, 'mysecret');

    await expect(decodeSharePayload(encoded)).rejects.toThrow(
      'Password required to decrypt this share',
    );
  });

  it('decoding encrypted payload with wrong password throws', async () => {
    const payload = makeNotePayload();
    const encoded = await encodeSharePayload(payload, 'correct-password');

    await expect(decodeSharePayload(encoded, 'wrong-password')).rejects.toThrow();
  });
});

describe('MAX_URL_LENGTH', () => {
  it('is 32000', () => {
    expect(MAX_URL_LENGTH).toBe(32_000);
  });
});

describe('buildShareUrl', () => {
  it('constructs correct URL with share hash', () => {
    const encoded = 'ABCdef123_-';
    const url = buildShareUrl(encoded);
    expect(url).toBe(`${window.location.origin}${window.location.pathname}#share=${encoded}`);
    expect(url).toContain('#share=ABCdef123_-');
  });
});
