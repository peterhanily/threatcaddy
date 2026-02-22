import { db } from '../db';
import type { Note, Task, Folder, Tag } from '../types';

interface ExportData {
  version: 1;
  exportedAt: number;
  notes: Note[];
  tasks: Task[];
  folders: Folder[];
  tags: Tag[];
}

export async function exportJSON(): Promise<string> {
  const [notes, tasks, folders, tags] = await Promise.all([
    db.notes.toArray(),
    db.tasks.toArray(),
    db.folders.toArray(),
    db.tags.toArray(),
  ]);

  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    notes,
    tasks,
    folders,
    tags,
  };

  return JSON.stringify(data, null, 2);
}

export async function importJSON(json: string): Promise<{ notes: number; tasks: number; folders: number; tags: number }> {
  const data: ExportData = JSON.parse(json);

  if (!data.version || !data.notes || !data.tasks || !data.folders || !data.tags) {
    throw new Error('Invalid backup file format');
  }

  await db.transaction('rw', db.notes, db.tasks, db.folders, db.tags, async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();

    await db.notes.bulkAdd(data.notes);
    await db.tasks.bulkAdd(data.tasks);
    await db.folders.bulkAdd(data.folders);
    await db.tags.bulkAdd(data.tags);
  });

  return {
    notes: data.notes.length,
    tasks: data.tasks.length,
    folders: data.folders.length,
    tags: data.tags.length,
  };
}

export function exportNotesMarkdown(notes: Note[]): string {
  return notes
    .map((note) => {
      let md = `# ${note.title}\n\n`;
      if (note.tags.length > 0) {
        md += `Tags: ${note.tags.join(', ')}\n`;
      }
      md += `Created: ${new Date(note.createdAt).toISOString()}\n`;
      md += `Modified: ${new Date(note.updatedAt).toISOString()}\n\n`;
      md += `---\n\n${note.content}\n`;
      return md;
    })
    .join('\n\n---\n\n');
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
