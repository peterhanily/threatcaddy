import { db } from '../db';
import type { Note, Task, Folder, Tag, ExportData } from '../types';

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

const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ITEMS = 100_000;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function sanitizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    title: str(r.title),
    content: str(r.content),
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    pinned: bool(r.pinned),
    archived: bool(r.archived),
    trashed: bool(r.trashed),
    trashedAt: r.trashedAt != null ? num(r.trashedAt) : undefined,
    sourceUrl: r.sourceUrl != null ? str(r.sourceUrl) : undefined,
    sourceTitle: r.sourceTitle != null ? str(r.sourceTitle) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    iocAnalysis: r.iocAnalysis != null && typeof r.iocAnalysis === 'object' ? r.iocAnalysis as Note['iocAnalysis'] : undefined,
    iocTypes: Array.isArray(r.iocTypes) ? strArr(r.iocTypes) as Note['iocTypes'] : undefined,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
}

function sanitizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    title: str(r.title),
    description: r.description != null ? str(r.description) : undefined,
    completed: bool(r.completed),
    priority: (['none', 'low', 'medium', 'high'].includes(str(r.priority)) ? str(r.priority) : 'none') as Task['priority'],
    dueDate: r.dueDate != null ? str(r.dueDate) : undefined,
    folderId: r.folderId != null ? str(r.folderId) : undefined,
    tags: strArr(r.tags),
    status: (['todo', 'in-progress', 'done'].includes(str(r.status)) ? str(r.status) : 'todo') as Task['status'],
    order: num(r.order),
    iocAnalysis: r.iocAnalysis != null && typeof r.iocAnalysis === 'object' ? r.iocAnalysis as Task['iocAnalysis'] : undefined,
    iocTypes: Array.isArray(r.iocTypes) ? strArr(r.iocTypes) as Task['iocTypes'] : undefined,
    comments: Array.isArray(r.comments) ? (r.comments as unknown[]).filter(
      (c): c is { id: string; text: string; createdAt: number } =>
        !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).id === 'string'
    ) : undefined,
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
    completedAt: r.completedAt != null ? num(r.completedAt) : undefined,
  };
}

function sanitizeFolder(raw: unknown): Folder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    icon: r.icon != null ? str(r.icon) : undefined,
    color: r.color != null ? str(r.color) : undefined,
    order: num(r.order),
    createdAt: num(r.createdAt, Date.now()),
  };
}

function sanitizeTag(raw: unknown): Tag | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    color: str(r.color, '#6366f1'),
  };
}

export async function importJSON(json: string): Promise<{ notes: number; tasks: number; folders: number; tags: number }> {
  if (json.length > MAX_IMPORT_SIZE) {
    throw new Error(`Backup file too large (max ${MAX_IMPORT_SIZE / 1024 / 1024} MB)`);
  }

  const data = JSON.parse(json);

  if (!data || typeof data !== 'object' || !Array.isArray(data.notes) || !Array.isArray(data.tasks) || !Array.isArray(data.folders) || !Array.isArray(data.tags)) {
    throw new Error('Invalid backup file format');
  }

  if (data.notes.length > MAX_ITEMS || data.tasks.length > MAX_ITEMS) {
    throw new Error(`Too many items (max ${MAX_ITEMS.toLocaleString()} per type)`);
  }

  // Sanitize all imported objects through allowlisted field extractors
  const notes = data.notes.map(sanitizeNote).filter((n: Note | null): n is Note => n !== null && !!n.id);
  const tasks = data.tasks.map(sanitizeTask).filter((t: Task | null): t is Task => t !== null && !!t.id);
  const folders = data.folders.map(sanitizeFolder).filter((f: Folder | null): f is Folder => f !== null && !!f.id);
  const tags = data.tags.map(sanitizeTag).filter((t: Tag | null): t is Tag => t !== null && !!t.id);

  await db.transaction('rw', db.notes, db.tasks, db.folders, db.tags, async () => {
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();

    await db.notes.bulkAdd(notes);
    await db.tasks.bulkAdd(tasks);
    await db.folders.bulkAdd(folders);
    await db.tags.bulkAdd(tags);
  });

  return {
    notes: notes.length,
    tasks: tasks.length,
    folders: folders.length,
    tags: tags.length,
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
