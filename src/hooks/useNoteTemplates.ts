import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { NoteTemplate } from '../types';
import { BUILTIN_NOTE_TEMPLATES } from '../lib/builtin-templates';
import { nanoid } from 'nanoid';

export function useNoteTemplates() {
  const [userTemplates, setUserTemplates] = useState<NoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    const all = await db.noteTemplates.toArray();
    setUserTemplates(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTemplates();
  }, [loadTemplates]);

  const allTemplates = useMemo(
    () => [...BUILTIN_NOTE_TEMPLATES, ...userTemplates],
    [userTemplates],
  );

  const createTemplate = useCallback(async (partial: Partial<NoteTemplate> & { name: string; content: string }): Promise<NoteTemplate> => {
    const now = Date.now();
    const template: NoteTemplate = {
      id: nanoid(),
      name: partial.name,
      content: partial.content,
      category: partial.category || 'Custom',
      source: 'user',
      icon: partial.icon,
      description: partial.description,
      tags: partial.tags,
      clsLevel: partial.clsLevel,
      createdAt: now,
      updatedAt: now,
    };
    await db.noteTemplates.add(template);
    setUserTemplates((prev) => [...prev, template]);
    return template;
  }, []);

  const updateTemplate = useCallback(async (id: string, updates: Partial<NoteTemplate>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.noteTemplates.update(id, patched);
    setUserTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patched } : t)));
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    await db.noteTemplates.delete(id);
    setUserTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const duplicateBuiltin = useCallback(async (builtinId: string): Promise<NoteTemplate | null> => {
    const builtin = BUILTIN_NOTE_TEMPLATES.find((t) => t.id === builtinId);
    if (!builtin) return null;
    return createTemplate({
      name: `${builtin.name} (Custom)`,
      content: builtin.content,
      category: 'Custom',
      icon: builtin.icon,
      description: builtin.description,
      tags: builtin.tags,
      clsLevel: builtin.clsLevel,
    });
  }, [createTemplate]);

  const saveNoteAsTemplate = useCallback(async (note: { title: string; content: string; tags?: string[]; clsLevel?: string }): Promise<NoteTemplate> => {
    return createTemplate({
      name: note.title,
      content: note.content,
      category: 'Custom',
      tags: note.tags,
      clsLevel: note.clsLevel,
    });
  }, [createTemplate]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of allTemplates) cats.add(t.category);
    return Array.from(cats);
  }, [allTemplates]);

  return {
    templates: allTemplates,
    userTemplates,
    builtinTemplates: BUILTIN_NOTE_TEMPLATES,
    categories,
    loading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateBuiltin,
    saveNoteAsTemplate,
    reload: loadTemplates,
  };
}
