import { describe, expect, it } from 'vitest';
import { chatThreadGroups, noteDisplayList } from '../lib/folder-tree';
import type { ChatThread, Note } from '../types';

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id, title: id, content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra,
});
const ids = (notes: Note[]) => notes.map(n => n.id);

describe('noteDisplayList', () => {
  it('nests children under a listed folder-note, shown when expanded', () => {
    const notes = [note('P', { isFolder: true }), note('A', { parentNoteId: 'P' }), note('B')];
    expect(ids(noteDisplayList(notes, new Set()))).toEqual(['P', 'B']);
    expect(ids(noteDisplayList(notes, new Set(['P'])))).toEqual(['P', 'A', 'B']);
  });

  it('lists a note at top level when its parent folder-note is missing or is not a folder', () => {
    // e.g. a teammate deleted, trashed or moved the parent; the note must not disappear.
    expect(ids(noteDisplayList([note('A', { parentNoteId: 'gone' }), note('B')], new Set()))).toEqual(['A', 'B']);
    expect(ids(noteDisplayList([note('P'), note('A', { parentNoteId: 'P' })], new Set(['P'])))).toEqual(['P', 'A']);
  });
});

describe('chatThreadGroups', () => {
  const thread = (id: string, extra: Partial<ChatThread> = {}): ChatThread => ({
    id, title: id, messages: [], model: 'm', provider: 'anthropic', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra,
  });

  it('nests threads under listed chat folders and lists orphans at top level', () => {
    const groups = chatThreadGroups([thread('F', { isFolder: true }), thread('a', { parentThreadId: 'F' }), thread('b', { parentThreadId: 'gone' }), thread('c')]);
    expect(groups.folders.map(t => t.id)).toEqual(['F']);
    expect(groups.childrenOf('F').map(t => t.id)).toEqual(['a']);
    expect(groups.topLevel.map(t => t.id)).toEqual(['b', 'c']);
  });
});

