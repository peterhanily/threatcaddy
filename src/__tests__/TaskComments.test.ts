import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTasks } from '../hooks/useTasks';
import { db } from '../db';
import type { TaskComment } from '../types';

describe('Task Comments', () => {
  beforeEach(async () => {
    await db.tasks.clear();
  });

  it('creates a task with no comments by default', async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    await act(async () => {
      await result.current.createTask({ title: 'Test task' });
    });

    const task = result.current.tasks[0];
    expect(task.comments).toBeUndefined();
  });

  it('adds a comment to a task via updateTask', async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    let taskId = '';
    await act(async () => {
      const task = await result.current.createTask({ title: 'Task with comments' });
      taskId = task.id;
    });

    const comment: TaskComment = {
      id: 'comment-1',
      text: 'First comment',
      createdAt: Date.now(),
    };

    await act(async () => {
      await result.current.updateTask(taskId, { comments: [comment] });
    });

    const updated = result.current.tasks.find((t) => t.id === taskId);
    expect(updated?.comments).toHaveLength(1);
    expect(updated?.comments?.[0].text).toBe('First comment');
  });

  it('adds multiple comments to a task', async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    let taskId = '';
    await act(async () => {
      const task = await result.current.createTask({ title: 'Multi comment task' });
      taskId = task.id;
    });

    const comments: TaskComment[] = [
      { id: 'c1', text: 'Comment one', createdAt: Date.now() },
      { id: 'c2', text: 'Comment two', createdAt: Date.now() },
      { id: 'c3', text: 'Comment three', createdAt: Date.now() },
    ];

    await act(async () => {
      await result.current.updateTask(taskId, { comments });
    });

    const updated = result.current.tasks.find((t) => t.id === taskId);
    expect(updated?.comments).toHaveLength(3);
  });

  it('deletes a comment by updating with filtered array', async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    let taskId = '';
    await act(async () => {
      const task = await result.current.createTask({ title: 'Delete comment task' });
      taskId = task.id;
    });

    const comments: TaskComment[] = [
      { id: 'c1', text: 'Keep this', createdAt: Date.now() },
      { id: 'c2', text: 'Delete this', createdAt: Date.now() },
    ];

    await act(async () => {
      await result.current.updateTask(taskId, { comments });
    });

    // Remove second comment
    await act(async () => {
      await result.current.updateTask(taskId, { comments: [comments[0]] });
    });

    const updated = result.current.tasks.find((t) => t.id === taskId);
    expect(updated?.comments).toHaveLength(1);
    expect(updated?.comments?.[0].id).toBe('c1');
  });

  it('persists comments to IndexedDB', async () => {
    const { result } = renderHook(() => useTasks());
    await act(async () => {});

    let taskId = '';
    await act(async () => {
      const task = await result.current.createTask({ title: 'Persist test' });
      taskId = task.id;
    });

    const comment: TaskComment = {
      id: 'persist-1',
      text: 'Persisted comment',
      createdAt: Date.now(),
    };

    await act(async () => {
      await result.current.updateTask(taskId, { comments: [comment] });
    });

    // Read directly from DB to verify persistence
    const dbTask = await db.tasks.get(taskId);
    expect(dbTask?.comments).toHaveLength(1);
    expect(dbTask?.comments?.[0].text).toBe('Persisted comment');
  });
});
