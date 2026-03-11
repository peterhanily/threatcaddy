import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { PlaybookTemplate, NoteTemplate, Note, Task, Folder, Timeline, PlaybookExecution } from '../types';
import { BUILTIN_PLAYBOOKS } from '../lib/builtin-playbooks';
import { BUILTIN_NOTE_TEMPLATES } from '../lib/builtin-templates';
import { nanoid } from 'nanoid';

export function usePlaybooks() {
  const [userPlaybooks, setUserPlaybooks] = useState<PlaybookTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlaybooks = useCallback(async () => {
    const all = await db.playbookTemplates.toArray();
    setUserPlaybooks(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlaybooks();
  }, [loadPlaybooks]);

  const allPlaybooks = useMemo(
    () => [...BUILTIN_PLAYBOOKS, ...userPlaybooks],
    [userPlaybooks],
  );

  const createPlaybook = useCallback(async (partial: Partial<PlaybookTemplate> & { name: string; steps: PlaybookTemplate['steps'] }): Promise<PlaybookTemplate> => {
    const now = Date.now();
    const playbook: PlaybookTemplate = {
      id: nanoid(),
      name: partial.name,
      description: partial.description,
      icon: partial.icon,
      investigationType: partial.investigationType || 'custom',
      defaultTags: partial.defaultTags,
      defaultClsLevel: partial.defaultClsLevel,
      defaultPapLevel: partial.defaultPapLevel,
      steps: partial.steps,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    };
    await db.playbookTemplates.add(playbook);
    setUserPlaybooks((prev) => [...prev, playbook]);
    return playbook;
  }, []);

  const updatePlaybook = useCallback(async (id: string, updates: Partial<PlaybookTemplate>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.playbookTemplates.update(id, patched);
    setUserPlaybooks((prev) => prev.map((p) => (p.id === id ? { ...p, ...patched } : p)));
  }, []);

  const deletePlaybook = useCallback(async (id: string) => {
    await db.playbookTemplates.delete(id);
    setUserPlaybooks((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /** Instantiate a playbook into a folder, creating all notes and tasks. */
  const instantiate = useCallback(async (
    playbookId: string,
    folder: Folder,
    allNoteTemplates: NoteTemplate[],
  ): Promise<{ notes: Note[]; tasks: Task[] }> => {
    const playbook = allPlaybooks.find((p) => p.id === playbookId);
    if (!playbook) throw new Error('Playbook not found');

    const now = Date.now();
    const notes: Note[] = [];
    const tasks: Task[] = [];

    // Build a lookup of note templates (builtins + user)
    const templateMap = new Map<string, NoteTemplate>();
    for (const t of BUILTIN_NOTE_TEMPLATES) templateMap.set(t.id, t);
    for (const t of allNoteTemplates) templateMap.set(t.id, t);

    // Create a timeline for this investigation (skip if folder already has one)
    let timelineId = folder.timelineId;
    let timeline: Timeline | undefined;
    if (!timelineId) {
      timelineId = nanoid();
      const maxTimelineOrder = (await db.timelines.toArray()).reduce((max, t) => Math.max(max, t.order), 0);
      timeline = {
        id: timelineId,
        name: folder.name,
        order: maxTimelineOrder + 1,
        createdAt: now,
        updatedAt: now,
      };
    }

    for (const step of playbook.steps) {
      if (step.entityType === 'note') {
        let content = step.content;
        if (step.noteTemplateId) {
          const tpl = templateMap.get(step.noteTemplateId);
          if (tpl) content = tpl.content;
        }
        notes.push({
          id: nanoid(),
          title: step.title,
          content,
          folderId: folder.id,
          tags: [...(step.tags || []), ...(step.phase ? [step.phase.toLowerCase()] : [])],
          pinned: false,
          archived: false,
          trashed: false,
          createdAt: now,
          updatedAt: now,
        });
      } else if (step.entityType === 'task') {
        tasks.push({
          id: nanoid(),
          title: step.title,
          description: step.content,
          completed: false,
          priority: step.priority || 'none',
          tags: [...(step.tags || []), ...(step.phase ? [step.phase.toLowerCase()] : [])],
          status: step.status || 'todo',
          order: step.order,
          trashed: false,
          archived: false,
          folderId: folder.id,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Build playbook execution tracker
    const playbookExecution: PlaybookExecution = {
      templateId: playbook.id,
      templateName: playbook.name,
      startedAt: now,
      steps: playbook.steps.map((_, i) => ({
        stepIndex: i,
        completed: false,
      })),
    };

    // Update folder with playbook metadata
    const folderUpdates: Partial<Folder> = { updatedAt: now, playbookExecution };
    if (!folder.timelineId) folderUpdates.timelineId = timelineId;
    if (playbook.defaultClsLevel && !folder.clsLevel) folderUpdates.clsLevel = playbook.defaultClsLevel;
    if (playbook.defaultPapLevel && !folder.papLevel) folderUpdates.papLevel = playbook.defaultPapLevel;
    if (playbook.defaultTags) folderUpdates.tags = [...new Set([...(folder.tags || []), ...playbook.defaultTags])];

    await db.transaction('rw', [db.folders, db.notes, db.tasks, db.timelines], async () => {
      if (timeline) await db.timelines.add(timeline);
      await db.folders.update(folder.id, folderUpdates);
      if (notes.length > 0) await db.notes.bulkAdd(notes);
      if (tasks.length > 0) await db.tasks.bulkAdd(tasks);
    });

    return { notes, tasks };
  }, [allPlaybooks]);

  return {
    playbooks: allPlaybooks,
    userPlaybooks,
    builtinPlaybooks: BUILTIN_PLAYBOOKS,
    loading,
    createPlaybook,
    updatePlaybook,
    deletePlaybook,
    instantiate,
    reload: loadPlaybooks,
  };
}
