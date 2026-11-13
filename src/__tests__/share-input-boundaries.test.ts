import * as pako from 'pako';
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

  it('shares chat content without tool transcripts, images, usage or identities', () => {
    const thread = sanitizeSharePayload(payload('chat', { id: 'c1', title: 'Thread', createdBy: 'u-ana', updatedBy: 'u-ana', messages: [{
      id: 'm1', role: 'assistant', content: 'Answer', createdAt: 1, model: 'm', userId: 'u-ana', tokenCount: { input: 1, output: 2 },
      toolCalls: [{ id: 't', name: 'search_across_investigations', input: {}, result: 'Case B (TLP:RED)', isError: false }],
      attachments: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      agentCycleSummary: { outcome: 'success', tokens: { input: 1, output: 1 }, toolCalls: { executed: 1, proposed: 0 } },
    }] })).d as ChatThread;
    expect(thread).not.toHaveProperty('createdBy');
    expect(thread.messages).toEqual([{ id: 'm1', role: 'assistant', content: 'Answer', createdAt: 1, model: 'm' }]);
  });

  it('shares investigation comment and chat text without identities, tool transcripts or images', () => {
    const data = sanitizeSharePayload(payload('investigation', {
      folder: { id: 'f', name: 'Case', createdBy: 'u-ana' },
      notes: [{ id: 'n', title: 'N', annotations: [{ id: 'a', text: 'check', authorId: 'u-ana', authorName: 'Ana', createdAt: 1 }] }],
      tasks: [{ id: 't', title: 'T', comments: [{ id: 'k', text: 'done', authorId: 'u-ben', authorName: 'Ben', createdAt: 1 }] }],
      events: [{ id: 'e', title: 'E', comments: [{ id: 'c', content: 'C2 match', userId: 'u-ana', userName: 'Ana (IR Lead)', createdAt: 1 }] }],
      iocs: [{ id: 'i', type: 'domain', value: 'x.test', createdBy: 'u-cy', comments: [{ id: 'c', content: 'seen', userId: 'u-cy', userName: 'Cy', createdAt: 1 }] }],
      chatThreads: [{ id: 'ch', title: 'Chat', messages: [{ id: 'm', role: 'assistant', content: 'Answer', createdAt: 1, userId: 'u-ana',
        toolCalls: [{ id: 't', name: 'search_across_investigations', input: {}, result: 'Case B (TLP:RED)', isError: false }],
        attachments: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }], tokenCount: { input: 1, output: 1 } }] }],
    })).d as InvestigationBundle;
    expect(data.chatThreads[0].messages).toEqual([{ id: 'm', role: 'assistant', content: 'Answer', createdAt: 1 }]);
    expect(data.folder).not.toHaveProperty('createdBy');
    expect(data.notes[0].annotations).toEqual([{ id: 'a', text: 'check', createdAt: 1 }]);
    expect(data.tasks[0].comments).toEqual([{ id: 'k', text: 'done', createdAt: 1 }]);
    expect(data.events[0].comments).toEqual([{ id: 'c', content: 'C2 match', createdAt: 1 }]);
    expect(data.iocs[0].comments).toEqual([{ id: 'c', content: 'seen', createdAt: 1 }]);
    expect(data.iocs[0]).not.toHaveProperty('createdBy');
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
