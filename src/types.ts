export interface Note {
  id: string;
  title: string;
  content: string;
  folderId?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  dueDate?: string;
  folderId?: string;
  tags: string[];
  status: TaskStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Folder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  order: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type ViewMode = 'notes' | 'tasks' | 'clips';
export type EditorMode = 'edit' | 'preview' | 'split';
export type TaskViewMode = 'list' | 'kanban';

export interface Settings {
  theme: 'dark' | 'light';
  defaultView: ViewMode;
  editorMode: EditorMode;
  sidebarCollapsed: boolean;
  taskViewMode: TaskViewMode;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultView: 'notes',
  editorMode: 'split',
  sidebarCollapsed: false,
  taskViewMode: 'list',
};

export type SortOption = 'updatedAt' | 'createdAt' | 'title';
export type SortDirection = 'asc' | 'desc';

export const NOTE_COLORS = [
  { name: 'None', value: '' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  none: '',
  low: '#3b82f6',
  medium: '#eab308',
  high: '#ef4444',
};

export const TAG_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f97316', '#ef4444',
  '#ec4899', '#a855f7',
];
