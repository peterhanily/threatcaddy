import pako from 'pako';
import { describe, expect, it } from 'vitest';
import { decodeSharePayload, encodeSharePayload, inflateShareBody, MAX_SHARE_DECODED_BYTES } from '../lib/share';
import { sanitizeSharePayload, validateShareTextLengths, MAX_SHARE_TEXT_CHARS } from '../lib/share-data';
import type { InvestigationBundle } from '../lib/share';
import type { ChatThread, Note } from '../types';

const payload = (s: string, d: unknown) => ({ v: 1, s, t: 1_700_000_000_000, d });

describe('share schema and resource contracts', () => {
  it('normalizes missing legacy entity fields before rendering', () => {
    const note = sanitizeSharePayload(payload('note', { id: 'note', title: 'Ordinary note', content: 12, tags: null })).d as Note;
    expect(note.title).toBe('Ordinary note');
    expect(note.content).toBe('');
    expect(note.tags).toEqual([]);
    const chat = sanitizeSharePayload(payload('chat', { id: 'chat', title: 'Ordinary transcript' })).d as ChatThread;
    expect(chat.messages).toEqual([]);
  });

  it('normalizes legacy collections and strips operational settings from a content share', () => {
    const data = sanitizeSharePayload(payload('investigation', { folder: {
      id: 'folder', name: 'Shared investigation', agentEnabled: true, agentStatus: 'running',
      agentPolicy: { autoApproveReads: true }, agentThreadId: 'agent-thread',
      playbookExecution: { status: 'active' }, noteTemplateIds: ['template'],
    } })).d as InvestigationBundle;
    expect(data.notes).toEqual([]);
    expect(data.chatThreads).toEqual([]);
    expect(data.folder.agentEnabled).toBe(false);
    expect(data.folder.agentStatus).toBe('idle');
    expect(data.folder).not.toHaveProperty('agentPolicy');
    expect(data.folder).not.toHaveProperty('playbookExecution');
    expect(data.folder).not.toHaveProperty('agentThreadId');
    expect(data.folder).not.toHaveProperty('noteTemplateIds');
  });

  it.each([
    [], payload('note', []), payload('note', { title: 'Missing ID' }),
    payload('investigation', { folder: { id: 'f' }, notes: {} }),
    payload('investigation', { folder: { id: 'f' }, notes: [{ id: 'n' }, { id: 'n' }] }),
    payload('investigation', { folder: { id: 'f' }, notes: [{ id: 'n', folderId: 'another' }] }),
  ])('rejects incomplete or inconsistent schema before persistence (%#)', value => {
    expect(() => sanitizeSharePayload(value)).toThrow();
  });

  it('uses byte budgets, accepting the exact boundary and rejecting the next ordinary byte', () => {
    const text = new TextEncoder().encode('Shared café');
    const compressed = pako.deflate(text);
    expect(Array.from(inflateShareBody(compressed, text.length))).toEqual(Array.from(text));
    expect(() => inflateShareBody(compressed, text.length - 1)).toThrow('size limit');
    expect(() => inflateShareBody(compressed, MAX_SHARE_DECODED_BYTES + 1)).toThrow('budget');
  });

  it('rejects over-budget text before truncation, using a small ordinary-text budget', () => {
    expect(() => validateShareTextLengths({ content: 'Normal text', messages: [{ content: 'Short text' }] }, 11)).not.toThrow();
    expect(() => validateShareTextLengths({ messages: [{ content: 'Normal text with a tail' }] }, 11)).toThrow('field length');
    expect(() => validateShareTextLengths('Short text', MAX_SHARE_TEXT_CHARS + 1)).toThrow('budget');
  });

  it('rejects an incomplete ordinary compressed stream', () => {
    const compressed = pako.deflate(new TextEncoder().encode('Ordinary shared note'));
    expect(() => inflateShareBody(compressed.slice(0, -2), 128)).toThrow('incomplete');
  });

  it('uses the allowlist on the real encode/decode path', async () => {
    const input = sanitizeSharePayload(payload('note', { id: 'note', title: 'Round trip', content: 'Normal text' }));
    const encoded = await encodeSharePayload(input);
    const result = await decodeSharePayload(encoded);
    expect(result.d).toMatchObject({ id: 'note', title: 'Round trip', tags: [] });
    await expect(decodeSharePayload('AgE')).rejects.toThrow('header');
  });
});
