import { describe, it, expect } from 'vitest';
import { sanitizeSyncEntity, sanitizeSyncBatch } from '../lib/sync-sanitize';

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
});
