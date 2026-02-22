import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import type { Tag } from '../types';
import { TAG_COLORS } from '../types';
import { nanoid } from 'nanoid';

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);

  const loadTags = useCallback(async () => {
    const all = await db.tags.toArray();
    setTags(all);
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const createTag = useCallback(async (name: string, color?: string): Promise<Tag> => {
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;

    const tag: Tag = {
      id: nanoid(),
      name,
      color: color || TAG_COLORS[tags.length % TAG_COLORS.length],
    };
    await db.tags.add(tag);
    setTags((prev) => [...prev, tag]);
    return tag;
  }, [tags]);

  const updateTag = useCallback(async (id: string, updates: Partial<Tag>) => {
    await db.tags.update(id, updates);
    // If renaming, update all notes and tasks that reference the old tag name
    if (updates.name) {
      const oldTag = tags.find((t) => t.id === id);
      if (oldTag && oldTag.name !== updates.name) {
        const notesWithTag = await db.notes.where('tags').equals(oldTag.name).toArray();
        const tasksWithTag = await db.tasks.where('tags').equals(oldTag.name).toArray();
        await Promise.all([
          ...notesWithTag.map((n) =>
            db.notes.update(n.id, { tags: n.tags.map((t) => (t === oldTag.name ? updates.name! : t)) })
          ),
          ...tasksWithTag.map((t) =>
            db.tasks.update(t.id, { tags: t.tags.map((tag) => (tag === oldTag.name ? updates.name! : tag)) })
          ),
        ]);
      }
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, [tags]);

  const deleteTag = useCallback(async (id: string) => {
    const tag = tags.find((t) => t.id === id);
    if (!tag) return;
    // Remove tag from all notes and tasks
    const notesWithTag = await db.notes.where('tags').equals(tag.name).toArray();
    const tasksWithTag = await db.tasks.where('tags').equals(tag.name).toArray();
    await Promise.all([
      ...notesWithTag.map((n) =>
        db.notes.update(n.id, { tags: n.tags.filter((t) => t !== tag.name) })
      ),
      ...tasksWithTag.map((t) =>
        db.tasks.update(t.id, { tags: t.tags.filter((tg) => tg !== tag.name) })
      ),
    ]);
    await db.tags.delete(id);
    setTags((prev) => prev.filter((t) => t.id !== id));
  }, [tags]);

  return {
    tags,
    createTag,
    updateTag,
    deleteTag,
    reload: loadTags,
  };
}
