import { describe, it, expect } from 'vitest';
import { unifiedSearch, generateSnippet, parseAdvancedQuery } from '../lib/search';
import type { Note, Task, TimelineEvent, Whiteboard } from '../types';
import type { FieldSet } from '../lib/search';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '1',
    title: 'Test Note',
    content: 'Some content here',
    tags: [],
    pinned: false,
    archived: false,
    trashed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '1',
    title: 'Test Task',
    completed: false,
    priority: 'none',
    tags: [],
    status: 'todo',
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'te1',
    timestamp: Date.now(),
    title: 'Test Event',
    description: '',
    eventType: 'other',
    source: '',
    confidence: 'medium',
    linkedIOCIds: [],
    linkedNoteIds: [],
    linkedTaskIds: [],
    mitreAttackIds: [],
    assets: [],
    tags: [],
    starred: false,
    timelineId: 'tl1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeWhiteboard(overrides: Partial<Whiteboard> = {}): Whiteboard {
  return {
    id: 'wb1',
    name: 'Test Board',
    elements: '[]',
    tags: [],
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('unifiedSearch', () => {
  const now = Date.now();
  const notes: Note[] = [
    makeNote({ id: 'n1', title: 'Meeting Notes', content: 'Discuss project timeline', updatedAt: now - 1000 }),
    makeNote({ id: 'n2', title: 'Recipe', content: 'Chocolate cake recipe', tags: ['food'], updatedAt: now - 2000 }),
    makeNote({ id: 'n3', title: 'Ideas', content: 'App ideas for 2024', updatedAt: now - 3000 }),
    makeNote({ id: 'c1', title: 'Clipped article', content: 'From the web', folderId: 'clips-folder', updatedAt: now - 500 }),
    makeNote({ id: 'trashed', title: 'Meeting old', content: 'Old meeting notes', trashed: true, updatedAt: now }),
    makeNote({ id: 'archived', title: 'Meeting archived', content: 'Archived meeting', archived: true, updatedAt: now }),
  ];

  const tasks: Task[] = [
    makeTask({ id: 't1', title: 'Fix auth bug', description: 'Login page crashes on submit', updatedAt: now - 1500 }),
    makeTask({ id: 't2', title: 'Write documentation', tags: ['docs'], updatedAt: now - 2500 }),
  ];

  it('returns empty for blank query', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: '' });
    expect(result.results).toHaveLength(0);
  });

  it('searches across notes and tasks in simple mode', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: 'meeting' });
    // Should find n1 (Meeting Notes) but NOT trashed/archived
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe('n1');
    expect(result.results[0].type).toBe('note');
  });

  it('identifies clips by folderId', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: 'web' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('c1');
    expect(result.results[0].type).toBe('clip');
  });

  it('excludes trashed and archived notes', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: 'meeting' });
    const ids = result.results.map((r) => r.id);
    expect(ids).not.toContain('trashed');
    expect(ids).not.toContain('archived');
  });

  it('finds tasks', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: 'auth' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe('task');
    expect(result.results[0].id).toBe('t1');
  });

  it('sorts results by type group then updatedAt', () => {
    const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'simple', raw: 'a' });
    // Notes should come before clips, clips before tasks
    const types = result.results.map((r) => r.type);
    const noteIdx = types.indexOf('note');
    const clipIdx = types.indexOf('clip');
    const taskIdx = types.indexOf('task');
    if (noteIdx >= 0 && clipIdx >= 0) expect(noteIdx).toBeLessThan(clipIdx);
    if (clipIdx >= 0 && taskIdx >= 0) expect(clipIdx).toBeLessThan(taskIdx);
    if (noteIdx >= 0 && taskIdx >= 0) expect(noteIdx).toBeLessThan(taskIdx);
  });

  describe('regex mode', () => {
    it('matches with regex pattern', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'regex', raw: '\\d{4}' });
      // Should match "App ideas for 2024"
      expect(result.results.some((r) => r.id === 'n3')).toBe(true);
    });

    it('returns error for invalid regex', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'regex', raw: '[invalid' });
      expect(result.results).toHaveLength(0);
      expect(result.error).toBe('Invalid regular expression');
    });

    it('matches across fields', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'regex', raw: 'food' });
      expect(result.results.some((r) => r.id === 'n2')).toBe(true);
    });
  });

  describe('advanced mode', () => {
    it('supports field:contains queries', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'advanced', raw: 'title:contains("Meeting")' });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('n1');
    });

    it('supports AND operator', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', {
        mode: 'advanced',
        raw: 'title:contains("Recipe") AND tags:contains("food")',
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('n2');
    });

    it('supports OR operator', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', {
        mode: 'advanced',
        raw: 'title:contains("Meeting") OR title:contains("Recipe")',
      });
      expect(result.results).toHaveLength(2);
    });

    it('falls back to simple mode on parse error', () => {
      const result = unifiedSearch(notes, tasks, 'clips-folder', { mode: 'advanced', raw: 'cake' });
      // "cake" is a bare term, should search all fields
      expect(result.results.some((r) => r.id === 'n2')).toBe(true);
    });
  });
});

describe('unifiedSearch — timeline events', () => {
  const now = Date.now();
  const events: TimelineEvent[] = [
    makeTimelineEvent({ id: 'ev1', title: 'Phishing email received', source: 'email-gateway', updatedAt: now - 100 }),
    makeTimelineEvent({ id: 'ev2', title: 'Malware executed', eventType: 'execution', updatedAt: now - 200 }),
    makeTimelineEvent({ id: 'ev3', title: 'Data collected', tags: ['sensitive'], updatedAt: now - 300 }),
  ];

  it('finds timeline event by title', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'Phishing' }, events);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe('timeline');
    expect(result.results[0].id).toBe('ev1');
  });

  it('finds timeline event by source', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'email-gateway' }, events);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ev1');
  });

  it('finds timeline event by eventType label', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'Execution' }, events);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ev2');
  });

  it('finds timeline event by tag', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'sensitive' }, events);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ev3');
  });
});

describe('unifiedSearch — whiteboards', () => {
  const now = Date.now();
  const boards: Whiteboard[] = [
    makeWhiteboard({ id: 'wb1', name: 'Network Diagram', updatedAt: now - 100 }),
    makeWhiteboard({ id: 'wb2', name: 'Attack Flow', tags: ['incident'], updatedAt: now - 200 }),
  ];

  it('finds whiteboard by name', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'Network' }, undefined, boards);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe('whiteboard');
    expect(result.results[0].id).toBe('wb1');
  });

  it('finds whiteboard by tag', () => {
    const result = unifiedSearch([], [], undefined, { mode: 'simple', raw: 'incident' }, undefined, boards);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('wb2');
  });
});

describe('unifiedSearch — sort ordering with all types', () => {
  const now = Date.now();
  it('sorts timeline after tasks and whiteboards after timeline', () => {
    const notes = [makeNote({ id: 'n1', title: 'alpha test', updatedAt: now })];
    const tasks = [makeTask({ id: 't1', title: 'alpha fix', updatedAt: now })];
    const events = [makeTimelineEvent({ id: 'ev1', title: 'alpha event', updatedAt: now })];
    const boards = [makeWhiteboard({ id: 'wb1', name: 'alpha board', updatedAt: now })];

    const result = unifiedSearch(notes, tasks, 'no-clips', { mode: 'simple', raw: 'alpha' }, events, boards);
    const types = result.results.map((r) => r.type);
    expect(types).toEqual(['note', 'task', 'timeline', 'whiteboard']);
  });
});

describe('generateSnippet', () => {
  it('returns text around the match', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river';
    const snippet = generateSnippet(text, 'fox', 30);
    expect(snippet).toContain('fox');
  });

  it('adds leading ellipsis when match is not at start', () => {
    const text = 'A '.repeat(50) + 'TARGET' + ' B'.repeat(50);
    const snippet = generateSnippet(text, 'TARGET', 30);
    expect(snippet.startsWith('...')).toBe(true);
  });

  it('adds trailing ellipsis when match is not at end', () => {
    const text = 'TARGET' + ' and more text that goes on and on and on and on';
    const snippet = generateSnippet(text, 'TARGET', 20);
    expect(snippet.endsWith('...')).toBe(true);
  });

  it('handles no match gracefully', () => {
    const snippet = generateSnippet('Some text here', 'missing', 50);
    expect(snippet).toBe('Some text here');
  });

  it('truncates long text when no match found', () => {
    const text = 'A'.repeat(200);
    const snippet = generateSnippet(text, 'missing', 50);
    expect(snippet.length).toBeLessThanOrEqual(53); // 50 + '...'
  });
});

describe('parseAdvancedQuery', () => {
  const testFields: FieldSet = {
    title: 'Meeting Notes for Project Alpha',
    content: 'We discussed the timeline and budget for Q1',
    tags: 'work project alpha',
  };

  it('returns null for empty input', () => {
    expect(parseAdvancedQuery('')).toBeNull();
  });

  it('parses title:contains', () => {
    const pred = parseAdvancedQuery('title:contains("Meeting")');
    expect(pred).not.toBeNull();
    expect(pred!(testFields)).toBe(true);
    expect(pred!({ ...testFields, title: 'Recipe' })).toBe(false);
  });

  it('parses content:startsWith', () => {
    const pred = parseAdvancedQuery('content:startsWith("We discussed")');
    expect(pred!(testFields)).toBe(true);
  });

  it('parses tags:endsWith', () => {
    const pred = parseAdvancedQuery('tags:endsWith("alpha")');
    expect(pred!(testFields)).toBe(true);
  });

  it('parses AND (explicit)', () => {
    const pred = parseAdvancedQuery('title:contains("Meeting") AND tags:contains("work")');
    expect(pred!(testFields)).toBe(true);
    expect(pred!({ ...testFields, tags: 'personal' })).toBe(false);
  });

  it('parses OR', () => {
    const pred = parseAdvancedQuery('title:contains("Recipe") OR title:contains("Meeting")');
    expect(pred!(testFields)).toBe(true);
  });

  it('parses parenthesized groups', () => {
    const pred = parseAdvancedQuery('(title:contains("Recipe") OR title:contains("Meeting")) AND tags:contains("work")');
    expect(pred!(testFields)).toBe(true);
    expect(pred!({ ...testFields, tags: '' })).toBe(false);
  });

  it('handles bare terms as contains-all-fields', () => {
    const pred = parseAdvancedQuery('timeline');
    expect(pred!(testFields)).toBe(true); // "timeline" is in content
    expect(pred!({ title: '', content: '', tags: '' })).toBe(false);
  });

  it('handles implicit AND between bare terms', () => {
    const pred = parseAdvancedQuery('Meeting timeline');
    expect(pred!(testFields)).toBe(true); // both are in different fields
  });

  it('is case-insensitive', () => {
    const pred = parseAdvancedQuery('title:contains("meeting")');
    expect(pred!(testFields)).toBe(true);
  });

  it('throws on unterminated quotes', () => {
    expect(() => parseAdvancedQuery('"unterminated')).toThrow();
  });
});
