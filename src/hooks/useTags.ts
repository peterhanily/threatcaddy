import { useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { changeTagEverywhere } from '../lib/entity-relations';
import type { Tag } from '../types';
import { TAG_COLORS } from '../types';
import { nanoid } from 'nanoid';

/** Manages investigation tags (create, update, delete). Propagates renames across all entity types that reference the tag. */
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);

  const loadTags = useCallback(async () => {
    const all = await db.tags.toArray();
    setTags(all);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    await changeTagEverywhere(id, updates);
    await loadTags();
  }, [loadTags]);

  const deleteTag = useCallback(async (id: string) => {
    await changeTagEverywhere(id);
    await loadTags();
  }, [loadTags]);

  return {
    tags,
    createTag,
    updateTag,
    deleteTag,
    reload: loadTags,
  };
}
