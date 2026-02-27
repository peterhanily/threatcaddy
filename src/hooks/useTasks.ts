import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../db';
import type { Task, TaskStatus } from '../types';
import { nanoid } from 'nanoid';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    const allTasks = await db.tasks.toArray();
    setTasks(allTasks);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTasks();
  }, [loadTasks]);

  const createTask = useCallback(async (partial?: Partial<Task>): Promise<Task> => {
    const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order), 0);
    const task: Task = {
      id: nanoid(),
      title: '',
      completed: false,
      priority: 'none',
      tags: [],
      status: 'todo',
      order: maxOrder + 1,
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
      await db.tasks.delete(id);
      // Clean orphaned links from other entities
      await db.notes.filter(n => n.linkedTaskIds?.includes(id) ?? false).modify(n => {
        n.linkedTaskIds = (n.linkedTaskIds ?? []).filter(tid => tid !== id);
      });
      await db.tasks.filter(t => t.linkedTaskIds?.includes(id) ?? false).modify(t => {
        t.linkedTaskIds = (t.linkedTaskIds ?? []).filter(tid => tid !== id);
      });
      await db.timelineEvents.filter(e => e.linkedTaskIds.includes(id)).modify(e => {
        e.linkedTaskIds = e.linkedTaskIds.filter(tid => tid !== id);
      });
    } catch (err) {
      console.error('Failed to delete task:', err);
      throw err;
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleComplete = useCallback(async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const completed = !task.completed;
    await updateTask(id, {
      completed,
      status: completed ? 'done' : 'todo',
      completedAt: completed ? Date.now() : undefined,
    });
  }, [tasks, updateTask]);

  const getFilteredTasks = useCallback(
    (opts: {
      folderId?: string;
      tag?: string;
      status?: TaskStatus;
      search?: string;
    }) => {
      let filtered = tasks;

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
        .filter((t) => t.status === status && (!folderId || t.folderId === folderId))
        .sort((a, b) => a.order - b.order);
    },
    [tasks]
  );

  const taskCounts = useMemo(() => ({
    todo: tasks.filter((t) => t.status === 'todo').length,
    'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
    total: tasks.length,
  }), [tasks]);

  return {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    toggleComplete,
    getFilteredTasks,
    getTasksByStatus,
    taskCounts,
    reload: loadTasks,
  };
}
