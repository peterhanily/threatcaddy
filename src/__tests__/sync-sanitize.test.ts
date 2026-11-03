import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { sanitizeSyncEntity, sanitizeSyncBatch, SERVER_UNREPRESENTED_FIELDS, keepsLocalValue, outgoingSyncData, preserveUnsyncedFields } from '../lib/sync-sanitize';
import { SYNC_TABLES } from '../lib/sync-state';

/** Sanitize or fail the test; avoids non-null assertions. */
function sanitized(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const record = sanitizeSyncEntity(table, data);
  if (!record) throw new Error(`${table} sample was rejected`);
  return record;
}

/** Top-level column property names of each pgTable in the server's Drizzle schema. */
function serverColumns(): Record<string, Set<string>> {
  const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/src/db/schema.ts'), 'utf8');
  const tables: Record<string, Set<string>> = {};
  for (const match of schema.matchAll(/export const (\w+) = pgTable\('\w+', \{/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1, end = start;
    while (depth && end < schema.length) depth += ({ '{': 1, '}': -1 } as Record<string, number>)[schema[end++]] ?? 0;
    const body = schema.slice(start, end - 1);
    const keys = new Set<string>();
    let nesting = 0;
    for (const token of body.matchAll(/[{}()[\]]|^\s*(\w+):/gm)) {
      if ('{(['.includes(token[0])) nesting++;
      else if ('})]'.includes(token[0])) nesting--;
      else if (nesting === 0 && token[1]) keys.add(token[1]);
    }
    tables[match[1]] = keys;
  }
  return tables;
}

describe('sync-sanitize', () => {
  describe('sanitizeSyncEntity', () => {
    it('strips unexpected fields from a note', () => {
      const result = sanitizeSyncEntity('notes', {
        id: 'n1',
        title: 'Test',
        content: 'body',
        createdAt: 1000,
        updatedAt: 2000,
        __proto__: { admin: true },
        evilField: '<script>alert(1)</script>',
      });
      expect(result).toBeDefined();
      expect(result!.id).toBe('n1');
      expect(result!.title).toBe('Test');
      expect((result as Record<string, unknown>).evilField).toBeUndefined();
    });

    it('converts ISO timestamp strings to ms numbers', () => {
      const result = sanitizeSyncEntity('tasks', {
        id: 't1',
        title: 'Task',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
        trashedAt: '2025-03-15T12:00:00.000Z',
        completedAt: '2025-04-01T00:00:00.000Z',
      });
      expect(result).toBeDefined();
      expect(typeof result!.createdAt).toBe('number');
      expect(typeof result!.updatedAt).toBe('number');
      expect(typeof result!.trashedAt).toBe('number');
      expect(typeof result!.completedAt).toBe('number');
      expect(result!.createdAt).toBe(new Date('2025-01-01T00:00:00.000Z').getTime());
    });

    it('rejects internal and unknown table names from server data', () => {
      const data = { key: 'syncMeta', value: 'abc' };
      const result = sanitizeSyncEntity('_syncMeta', data);
      expect(result).toBeNull();
    });

    it('returns defaults for empty object (sanitizers fill in defaults)', () => {
      const result = sanitizeSyncEntity('notes', {});
      expect(result).toBeDefined();
      expect(result!.id).toBe('');
      expect(result!.title).toBe('');
    });

    it('sanitizes folder with closedAt ISO string', () => {
      const result = sanitizeSyncEntity('folders', {
        id: 'f1',
        name: 'Investigation',
        order: 0,
        createdAt: 1000,
        closedAt: '2025-06-15T00:00:00.000Z',
      });
      expect(result).toBeDefined();
      expect(typeof result!.closedAt).toBe('number');
      expect(result!.closedAt).toBe(new Date('2025-06-15T00:00:00.000Z').getTime());
    });

    it('sanitizes timeline events with timestamp ISO strings', () => {
      const result = sanitizeSyncEntity('timelineEvents', {
        id: 'e1',
        title: 'Event',
        timestamp: '2025-01-01T00:00:00.000Z',
        timestampEnd: '2025-01-02T00:00:00.000Z',
        createdAt: 1000,
        updatedAt: 2000,
        source: 'test',
        timelineId: 'tl1',
      });
      expect(result).toBeDefined();
      expect(typeof result!.timestamp).toBe('number');
      expect(typeof result!.timestampEnd).toBe('number');
    });

    it('handles chatThread message timestamps', () => {
      const result = sanitizeSyncEntity('chatThreads', {
        id: 'c1',
        title: 'Chat',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        messages: [
          { id: 'm1', role: 'user', content: 'hello', createdAt: '2025-01-01T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'hi', createdAt: 5000 },
        ],
        createdAt: 1000,
        updatedAt: 2000,
      });
      expect(result).toBeDefined();
      const messages = result!.messages as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(2);
      expect(typeof messages[0].createdAt).toBe('number');
      expect(messages[1].createdAt).toBe(5000);
    });

    it('ignores invalid ISO strings', () => {
      const result = sanitizeSyncEntity('tasks', {
        id: 't1',
        title: 'Task',
        createdAt: 'not-a-date',
        updatedAt: 2000,
      });
      expect(result).toBeDefined();
      // Invalid string is left as-is, then num() falls back to default
      expect(typeof result!.createdAt).toBe('number');
    });

    it('sanitizes whiteboards with trashedAt and clsLevel', () => {
      const result = sanitizeSyncEntity('whiteboards', {
        id: 'w1',
        name: 'Board',
        elements: '[]',
        trashedAt: '2025-05-01T00:00:00.000Z',
        clsLevel: 'TLP:AMBER',
        createdAt: 1000,
        updatedAt: 2000,
      });
      expect(result).toBeDefined();
      expect(typeof result!.trashedAt).toBe('number');
      expect(result!.clsLevel).toBe('TLP:AMBER');
    });

    it('sanitizes tags', () => {
      const result = sanitizeSyncEntity('tags', {
        id: 'tag1',
        name: 'malware',
        color: '#ff0000',
        extraField: 'should be stripped',
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe('malware');
      expect((result as Record<string, unknown>).extraField).toBeUndefined();
    });

    it('sanitizes standaloneIOCs', () => {
      const result = sanitizeSyncEntity('standaloneIOCs', {
        id: 'ioc1',
        type: 'ipv4',
        value: '10.0.0.1',
        confidence: 'high',
        createdAt: 1000,
        updatedAt: 2000,
        injected: true,
      });
      expect(result).toBeDefined();
      expect(result!.value).toBe('10.0.0.1');
      expect((result as Record<string, unknown>).injected).toBeUndefined();
    });
  });

  describe('sanitizeSyncBatch', () => {
    it('sanitizes multiple entities and strips extra fields', () => {
      const rows = [
        { id: 'n1', title: 'Note 1', content: 'a', createdAt: 1000, updatedAt: 2000, evil: true },
        { id: 'n2', title: 'Note 2', content: 'b', createdAt: 3000, updatedAt: 4000 },
      ];
      const results = sanitizeSyncBatch('notes', rows);
      expect(results).toHaveLength(2);
      expect((results[0] as Record<string, unknown>).evil).toBeUndefined();
      expect(results[1].id).toBe('n2');
    });

    it('rejects batches for unknown tables', () => {
      const rows = [{ key: 'a' }, { key: 'b' }];
      const results = sanitizeSyncBatch('_internal', rows);
      expect(results).toEqual([]);
    });

    it('filters out null results from invalid entries', () => {
      const rows = [
        { id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high', createdAt: 1000, updatedAt: 2000 },
        null as unknown as Record<string, unknown>, // invalid
        { id: 'ioc2', type: 'INVALID_TYPE', value: 'x', confidence: 'low', createdAt: 1000, updatedAt: 2000 }, // invalid type returns null
      ];
      const results = sanitizeSyncBatch('standaloneIOCs', rows);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ioc1');
    });

    it('converts ISO timestamps in batch', () => {
      const rows = [
        { id: 'f1', name: 'Folder', order: 0, createdAt: '2025-01-01T00:00:00.000Z' },
        { id: 'f2', name: 'Folder 2', order: 1, createdAt: 5000 },
      ];
      const results = sanitizeSyncBatch('folders', rows);
      expect(results).toHaveLength(2);
      expect(typeof results[0].createdAt).toBe('number');
      expect(results[1].createdAt).toBe(5000);
    });
  });

  describe('fields the team server cannot store', () => {
    const columns = serverColumns();
    // `version` is sync metadata; local-only folders are never pulled or pushed.
    const exempt = new Set(['version', 'localOnly']);
    // Server-side metadata the client rows do not carry.
    const serverOnly: Record<string, string[]> = { tags: ['createdAt', 'updatedAt'] };

    it.each([...SYNC_TABLES])('%s: every client field is a server column or is declared local', table => {
      const record = sanitized(table, { id: 'x', type: 'ipv4', role: 'user' });
      expect(columns[table], `server table for ${table}`).toBeDefined();
      const local = Object.keys(record).filter(key => !columns[table].has(key) && !exempt.has(key)).sort();
      expect(local).toEqual([...(SERVER_UNREPRESENTED_FIELDS[table] ?? [])].sort());
    });

    it.each([...SYNC_TABLES])('%s: every server column reaches the client row', table => {
      const record = sanitized(table, { id: 'x', type: 'ipv4', role: 'user' });
      const dropped = [...columns[table]].filter(key => !(key in record) && !['deletedAt', 'version'].includes(key)
        && !(serverOnly[table] ?? []).includes(key));
      expect(dropped).toEqual([]);
    });

    it('keeps local values unless the server sends a concrete value', () => {
      const local = { id: 't1', title: 'Old', checklist: [{ id: 'c', text: 'x', done: true }], escalated: true, rejectionCount: 2, rejectionHistory: [] };
      const incoming = { id: 't1', title: 'New', escalated: false, rejectionCount: null, version: 2 };
      const record = preserveUnsyncedFields('tasks', incoming, sanitized('tasks', incoming), local);
      expect(record).toMatchObject({ title: 'New', checklist: local.checklist, rejectionCount: 2, rejectionHistory: [] });
      expect(record.escalated).toBeUndefined(); // a concrete server value wins; null means "no value"
      expect(preserveUnsyncedFields('tasks', incoming, { id: 't1' }, undefined)).toEqual({ id: 't1' });
      expect(preserveUnsyncedFields('tags', { id: 'g' }, { id: 'g' }, { id: 'g', name: 'local' })).toEqual({ id: 'g' });
      expect(keepsLocalValue('tasks', { checklist: [] }, 'checklist')).toBe(false);
      expect(keepsLocalValue('tasks', { checklist: null }, 'checklist')).toBe(true);
      expect(keepsLocalValue('tasks', {}, 'title')).toBe(false);
    });

    it('uploads chat threads without device-only message details and restores them by message id', () => {
      const details = { toolCalls: [{ id: 't', name: 'read_note', input: {}, result: 'ok', isError: false }],
        attachments: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }], agentCycleSummary: { outcome: 'success' } };
      const local = { id: 'c', messages: [{ id: 'm1', role: 'assistant', content: 'a', createdAt: 1, tokenCount: { input: 1, output: 2 }, ...details }] };
      expect(outgoingSyncData('chatThreads', local)).toEqual({ id: 'c', messages: [{ id: 'm1', role: 'assistant', content: 'a', createdAt: 1, tokenCount: { input: 1, output: 2 } }] });
      expect(outgoingSyncData('notes', { id: 'n', content: 'x' })).toEqual({ id: 'n', content: 'x' });
      const incoming = { id: 'c', messages: [{ id: 'm1', role: 'assistant', content: 'a', createdAt: 1 }, { id: 'm2', role: 'user', content: 'b', createdAt: 2 }] };
      const merged = preserveUnsyncedFields('chatThreads', incoming, sanitized('chatThreads', incoming), local);
      expect(merged.messages).toEqual([
        expect.objectContaining({ id: 'm1', toolCalls: details.toolCalls, attachments: details.attachments, agentCycleSummary: details.agentCycleSummary }),
        { id: 'm2', role: 'user', content: 'b', createdAt: 2 },
      ]);
    });

    it('does not carry a parent pointer into another investigation', () => {
      const local = { id: 'n', folderId: 'f1', parentNoteId: 'p', isFolder: true };
      expect(preserveUnsyncedFields('notes', { id: 'n', folderId: 'f1' }, sanitized('notes', { id: 'n', folderId: 'f1' }), local))
        .toMatchObject({ parentNoteId: 'p', isFolder: true });
      const moved = preserveUnsyncedFields('notes', { id: 'n', folderId: 'f2' }, sanitized('notes', { id: 'n', folderId: 'f2' }), local);
      expect(moved.parentNoteId).toBeUndefined();
      expect(moved.isFolder).toBe(true);
    });

    it('never takes per-device agent state from the server', () => {
      const incoming = { id: 'f1', name: 'Case', agentEnabled: true, agentPolicy: { autoApproveCreate: true }, agentStatus: 'running', version: 3 };
      const kept = preserveUnsyncedFields('folders', incoming, sanitized('folders', incoming), { id: 'f1', agentEnabled: false, agentStatus: 'idle' });
      expect(kept).toMatchObject({ agentEnabled: false, agentStatus: 'idle' });
      expect(kept.agentPolicy).toBeUndefined();
      const fresh = preserveUnsyncedFields('folders', incoming, sanitized('folders', incoming), undefined);
      expect([fresh.agentEnabled, fresh.agentPolicy, fresh.agentStatus]).toEqual([undefined, undefined, undefined]);
      expect(keepsLocalValue('folders', incoming, 'agentEnabled')).toBe(true);
    });
  });

  describe('lossless sanitizers', () => {
    it('keeps timeline-event and IOC comments in their EntityComment shape', () => {
      const comments = [
        { id: 'c1', content: 'Seen in proxy logs', userId: 'u1', userName: 'Ana', createdAt: 10, updatedAt: 20 },
        { id: 'c2', text: 'Legacy shape', createdAt: 30 },
        { id: 'c3', createdAt: 40 },
      ];
      const expected = [
        { id: 'c1', content: 'Seen in proxy logs', userId: 'u1', userName: 'Ana', createdAt: 10, updatedAt: 20 },
        { id: 'c2', content: 'Legacy shape', createdAt: 30 },
      ];
      expect(sanitized('timelineEvents', { id: 'e1', comments }).comments).toEqual(expected);
      expect(sanitized('standaloneIOCs', { id: 'i1', type: 'ipv4', value: '10.0.0.1', comments }).comments).toEqual(expected);
    });

    it('bounds comment dates to representable values', () => {
      const [comment] = sanitized('timelineEvents', { id: 'e1', comments: [{ id: 'c', content: 'x', createdAt: 1e300, updatedAt: -1e300 }] }).comments as Record<string, unknown>[];
      expect(comment.createdAt).toBeLessThanOrEqual(Date.now());
      expect(comment.createdAt).toBeGreaterThan(1e12);
      expect(comment.updatedAt).toBeUndefined();
    });

    it('keeps task checklists and comment/annotation authors', () => {
      const task = sanitized('tasks', { id: 't1', checklist: [{ id: 'a', text: 'Collect', done: true }, { id: 'b', text: 'Triage' }, { text: 'no id' }],
        comments: [{ id: 'k', text: 'hi', authorId: 'u2', authorName: 'Ben', createdAt: 1 }] });
      expect(task.checklist).toEqual([{ id: 'a', text: 'Collect', done: true }, { id: 'b', text: 'Triage', done: false }]);
      expect(task.comments).toEqual([{ id: 'k', text: 'hi', authorId: 'u2', authorName: 'Ben', createdAt: 1 }]);
      const note = sanitized('notes', { id: 'n1', annotations: [{ id: 'a1', text: 'check', authorId: 'u3', authorName: 'Cy', createdAt: 2 }] });
      expect(note.annotations).toEqual([{ id: 'a1', text: 'check', authorId: 'u3', authorName: 'Cy', createdAt: 2 }]);
    });

    it('accepts numeric-string coordinates from the server and rejects invalid ones', () => {
      expect(sanitizeSyncEntity('timelineEvents', { id: 'e', latitude: '51.5072', longitude: '-0.1276' })).toMatchObject({ latitude: 51.5072, longitude: -0.1276 });
      expect(sanitizeSyncEntity('timelineEvents', { id: 'e', latitude: 12, longitude: 34 })).toMatchObject({ latitude: 12, longitude: 34 });
      for (const [latitude, longitude] of [['', ' '], ['abc', 'NaN'], ['91', '-181'], [null, null]]) {
        const record = sanitized('timelineEvents', { id: 'e', latitude, longitude });
        expect([record.latitude, record.longitude]).toEqual([undefined, undefined]);
      }
    });

    it('keeps IOC and timeline provenance like the other synced tables', () => {
      expect(sanitized('standaloneIOCs', { id: 'i1', type: 'domain', value: 'x.test', createdBy: 'u1', updatedBy: 'u2' })).toMatchObject({ createdBy: 'u1', updatedBy: 'u2' });
      expect(sanitized('timelines', { id: 'tl', name: 'T', createdBy: 'u1', updatedBy: 'u2' })).toMatchObject({ createdBy: 'u1', updatedBy: 'u2' });
    });

    it('keeps validated chat message details and drops malformed ones', () => {
      const summary = { startedAt: 1, durationMs: 2, whyThisCycle: 'why', whatIDid: ['a'], entitiesTouched: [{ type: 'note', id: 'n1', label: 'N' }, { type: 'bogus' }],
        tokens: { input: 3, output: 4 }, costUSD: 0.01, toolCalls: { executed: 1, proposed: 0 }, toolHistogram: { read_note: 1, bad: 'x' }, errorHistogram: {},
        turns: 2, outcome: 'success', provider: 'anthropic', model: 'm' };
      const png = 'iVBORw0KGgo=';
      const thread = sanitized('chatThreads', { id: 'c1', messages: [{
        id: 'm1', role: 'assistant', content: 'done', createdAt: 5, userId: 'u1', tokenCount: { input: 7, output: 8 }, agentCycleSummary: summary,
        toolCalls: [
          { id: 't1', name: 'read_note', input: { id: 'n1' }, result: 'ok', isError: false },
          { id: 't2', name: 'x', input: JSON.parse('{"__proto__":{"polluted":true}}'), result: 'r', isError: false },
          { id: 't3', name: 'y', input: 'not an object', result: 'r', isError: false },
        ],
        attachments: [
          { type: 'image', data: png, mimeType: 'image/png', name: 'shot.png' },
          { type: 'image', data: png, mimeType: 'image/svg+xml' },
          { type: 'image', data: 'not base64!', mimeType: 'image/png' },
          { type: 'image', data: 'AAAAA', mimeType: 'image/png' },
          { type: 'image', data: 'AAAAA=', mimeType: 'image/png' },
          { type: 'image', data: png, mimeType: 'text/html' },
          { type: 'image', data: png, mimeType: 'image/png;base64,x' },
        ],
      }, { id: 'm2', role: 'user', content: 'hi', createdAt: 6, tokenCount: { input: null, output: 1 }, agentCycleSummary: { ...summary, outcome: 'unknown' } },
      { id: 'm3', role: 'assistant', content: 'cycle', createdAt: 7,
        agentCycleSummary: { ...summary, startedAt: 1e300, tokens: { input: null, output: 4 }, toolCalls: { executed: 'x' } } }] });
      const [first, second, third] = thread.messages as Record<string, unknown>[];
      expect(first).toMatchObject({ userId: 'u1', tokenCount: { input: 7, output: 8 } });
      expect(first.toolCalls).toEqual([{ id: 't1', name: 'read_note', input: { id: 'n1' }, result: 'ok', isError: false }]);
      expect(first.attachments).toEqual([
        { type: 'image', data: png, mimeType: 'image/png', name: 'shot.png' },
        { type: 'image', data: png, mimeType: 'image/svg+xml' },
      ]);
      expect(first.agentCycleSummary).toMatchObject({ outcome: 'success', tokens: { input: 3, output: 4 }, toolHistogram: { read_note: 1 },
        entitiesTouched: [{ type: 'note', id: 'n1', label: 'N' }] });
      expect(second.tokenCount).toBeUndefined();
      expect(second.agentCycleSummary).toBeUndefined();
      // One malformed counter must not drop the rest of the audit summary.
      expect(third.agentCycleSummary).toMatchObject({ whyThisCycle: 'why', startedAt: 0, tokens: { input: 0, output: 4 }, toolCalls: { executed: 0, proposed: 0 } });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
