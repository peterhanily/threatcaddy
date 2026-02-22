import type { Note, Task } from '../types';

export function searchNotes(notes: Note[], query: string): Note[] {
  if (!query.trim()) return notes;
  const lower = query.toLowerCase();
  return notes.filter(
    (n) =>
      n.title.toLowerCase().includes(lower) ||
      n.content.toLowerCase().includes(lower) ||
      n.tags.some((t) => t.toLowerCase().includes(lower))
  );
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return tasks;
  const lower = query.toLowerCase();
  return tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(lower) ||
      (t.description?.toLowerCase().includes(lower) ?? false) ||
      t.tags.some((tag) => tag.toLowerCase().includes(lower))
  );
}
