import type { ChatThread, Note } from '../types';

/**
 * Display order for a note list: top-level notes, each followed by its children when the
 * folder-note is expanded. A note nests only under a folder-note present in the same list;
 * if its parent was removed, trashed or moved elsewhere (for example by a teammate), it is
 * listed at top level instead of disappearing.
 */
export function noteDisplayList(notes: Note[], expandedFolders: ReadonlySet<string>): Note[] {
  const folderIds = new Set(notes.filter(n => n.isFolder).map(n => n.id));
  const result: Note[] = [];
  for (const note of notes) {
    if (note.parentNoteId && folderIds.has(note.parentNoteId)) continue;
    result.push(note);
    if (note.isFolder && expandedFolders.has(note.id)) result.push(...notes.filter(n => n.parentNoteId === note.id));
  }
  return result;
}

/** Chat folders, threads shown at top level, and each folder's threads; same nesting rule as notes. */
export function chatThreadGroups(threads: ChatThread[]): { folders: ChatThread[]; topLevel: ChatThread[]; childrenOf: (folderId: string) => ChatThread[] } {
  const folders = threads.filter(t => t.isFolder);
  const folderIds = new Set(folders.map(f => f.id));
  return {
    folders,
    topLevel: threads.filter(t => !t.isFolder && (!t.parentThreadId || !folderIds.has(t.parentThreadId))),
    childrenOf: folderId => threads.filter(t => !t.isFolder && t.parentThreadId === folderId),
  };
}
