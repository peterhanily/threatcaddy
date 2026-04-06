import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { Task, TaskStatus } from '../types';
import { nanoid } from 'nanoid';
import { purgeOldTrash } from '../lib/trash-purge';

/** Manages CRUD operations and state for investigation tasks, including status transitions and kanban ordering. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    const allTasks = await db.tasks.toArray();
    const remaining = await purgeOldTrash(allTasks, db.tasks);
    setTasks(remaining);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, [loadTasks]);

  const createTask = useCallback(async (partial?: Partial<Task>): Promise<Task> => {
    const { getCurrentUserName } = await import('../lib/utils');
    const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order), 0);
    const task: Task = {
      id: nanoid(),
      title: '',
      completed: false,
      priority: 'none',
      tags: [],
      status: 'todo',
      order: maxOrder + 1,
      trashed: false,
      archived: false,
      createdBy: partial?.createdBy || getCurrentUserName(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...partial,
    };
    try {
      await db.tasks.add(task);
    } catch (err) {
      console.error('Failed to create task:', err);
      throw err;
    }
    setTasks((prev) => [...prev, task]);
    return task;
  }, [tasks]);

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    if (updates.status === 'done' && !updates.completedAt) {
      patched.completed = true;
      patched.completedAt = Date.now();
    }
    if (updates.status && updates.status !== 'done') {
      patched.completed = false;
      patched.completedAt = undefined;
    }
    try {
      await db.tasks.update(id, patched);
    } catch (err) {
      console.error('Failed to update task:', err);
      throw err;
    }
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patched } : t)));
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    try {
      await db.transaction('rw', [db.tasks, db.notes, db.timelineEvents], async () => {
        await db.tasks.delete(id);
        // Batch orphan link cleanup: collect affected entities then update in bulk
        const [linkedNotes, linkedTasks, linkedEvents] = await Promise.all([
          db.notes.toArray().then(items => items.filter(n => n.linkedTaskIds?.includes(id))),
          db.tasks.toArray().then(items => items.filter(t => t.linkedTaskIds?.includes(id))),
          db.timelineEvents.toArray().then(items => items.filter(e => e.linkedTaskIds.includes(id))),
        ]);
        const ops: Promise<unknown>[] = [];
        for (const n of linkedNotes) {
          ops.push(db.notes.update(n.id, { linkedTaskIds: (n.linkedTaskIds ?? []).filter(tid => tid !== id) }));
        }
        for (const t of linkedTasks) {
          ops.push(db.tasks.update(t.id, { linkedTaskIds: (t.linkedTaskIds ?? []).filter(tid => tid !== id) }));
        }
        for (const e of linkedEvents) {
          ops.push(db.timelineEvents.update(e.id, { linkedTaskIds: e.linkedTaskIds.filter(tid => tid !== id) }));
        }
        await Promise.all(ops);
      });
    } catch (err) {
      console.error('Failed to delete task:', err);
      throw err;
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const trashTask = useCallback(async (id: string) => {
    await updateTask(id, { trashed: true, trashedAt: Date.now() });
  }, [updateTask]);

  const restoreTask = useCallback(async (id: string) => {
    await updateTask(id, { trashed: false, trashedAt: undefined });
  }, [updateTask]);

  const toggleArchiveTask = useCallback(async (id: string) => {
    const task = await db.tasks.get(id);
    if (task) await updateTask(id, { archived: !task.archived });
  }, [updateTask]);

  const emptyTrashTasks = useCallback(async () => {
    const trashedIds = tasks.filter((t) => t.trashed).map((t) => t.id);
    if (trashedIds.length === 0) return;
    try {
      await db.transaction('rw', [db.tasks, db.notes, db.timelineEvents], async () => {
        await db.tasks.bulkDelete(trashedIds);
        // Batch orphan link cleanup in a single pass per table
        const idSet = new Set(trashedIds);
        const [allNotes, allEvents] = await Promise.all([
          db.notes.toArray(),
          db.timelineEvents.toArray(),
        ]);
        const ops: Promise<unknown>[] = [];
        for (const n of allNotes) {
          if (n.linkedTaskIds?.some(tid => idSet.has(tid))) {
            ops.push(db.notes.update(n.id, { linkedTaskIds: (n.linkedTaskIds ?? []).filter(tid => !idSet.has(tid)) }));
          }
        }
        for (const e of allEvents) {
          if (e.linkedTaskIds.some(tid => idSet.has(tid))) {
            ops.push(db.timelineEvents.update(e.id, { linkedTaskIds: e.linkedTaskIds.filter(tid => !idSet.has(tid)) }));
          }
        }
        await Promise.all(ops);
      });
    } catch (err) {
      console.error('Failed to empty task trash:', err);
      throw err;
    }
    setTasks((prev) => prev.filter((t) => !t.trashed));
  }, [tasks]);

  const toggleComplete = useCallback(async (id: string) => {
    const task = await db.tasks.get(id);
    if (!task) return;
    const completed = !task.completed;
    await updateTask(id, {
      completed,
      status: completed ? 'done' : 'todo',
      completedAt: completed ? Date.now() : undefined,
    });
  }, [updateTask]);

  const getFilteredTasks = useCallback(
    (opts: {
      folderId?: string;
      tag?: string;
      status?: TaskStatus;
      search?: string;
      showTrashed?: boolean;
      showArchived?: boolean;
      assigneeId?: string;
    }) => {
      let filtered = tasks;

      if (opts.showTrashed) {
        filtered = filtered.filter((t) => t.trashed);
      } else if (opts.showArchived) {
        filtered = filtered.filter((t) => t.archived && !t.trashed);
      } else {
        filtered = filtered.filter((t) => !t.trashed && !t.archived);
      }

      if (opts.folderId) {
        filtered = filtered.filter((t) => t.folderId === opts.folderId);
      }

      if (opts.tag) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        filtered = filtered.filter((t) => t.tags.includes(opts.tag!));
      }

      if (opts.status) {
        filtered = filtered.filter((t) => t.status === opts.status);
      }

      if (opts.assigneeId) {
        filtered = filtered.filter((t) => t.assigneeId === opts.assigneeId);
      }

      if (opts.search) {
        const lower = opts.search.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.title.toLowerCase().includes(lower) ||
            (t.description?.toLowerCase().includes(lower) ?? false)
        );
      }

      return filtered.sort((a, b) => a.order - b.order);
    },
    [tasks]
  );

  const getTasksByStatus = useCallback(
    (status: TaskStatus, folderId?: string) => {
      return tasks
        .filter((t) => t.status === status && !t.trashed && !t.archived && (!folderId || t.folderId === folderId))
        .sort((a, b) => a.order - b.order);
    },
    [tasks]
  );

  const taskCounts = useMemo(() => {
    const active = tasks.filter((t) => !t.trashed && !t.archived);
    return {
      todo: active.filter((t) => t.status === 'todo').length,
      'in-progress': active.filter((t) => t.status === 'in-progress').length,
      done: active.filter((t) => t.status === 'done').length,
      total: active.length,
      trashed: tasks.filter((t) => t.trashed).length,
      archived: tasks.filter((t) => t.archived && !t.trashed).length,
    };
  }, [tasks]);

  return {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    trashTask,
    restoreTask,
    toggleArchiveTask,
    emptyTrashTasks,
    toggleComplete,
    getFilteredTasks,
    getTasksByStatus,
    taskCounts,
    reload: loadTasks,
  };
}
