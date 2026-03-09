/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoggedActions } from '../hooks/useLoggedActions';
import type { Note, Task, TimelineEvent, StandaloneIOC, ChatThread, Folder, Tag, Timeline, Whiteboard } from '../types';
import type { ActivityCategory, ActivityAction } from '../types';

type LogFn = (category: ActivityCategory, action: ActivityAction, detail: string, itemId?: string, itemTitle?: string) => void;

/**
 * Helper to build all the mock data/ops arguments for useLoggedActions.
 * Returns mocks for each entity domain so tests can verify calls and stub return values.
 */
function buildMocks() {
  const sampleNote: Note = {
    id: 'n1', title: 'Test Note', content: '', tags: [], pinned: false,
    archived: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleTask: Task = {
    id: 't1', title: 'Test Task', tags: [], completed: false, priority: 'none',
    status: 'todo', order: 1, trashed: false, archived: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleEvent: TimelineEvent = {
    id: 'e1', title: 'Test Event', timestamp: Date.now(), eventType: 'other',
    source: '', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [],
    linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
    trashed: false, archived: false, timelineId: 'tl1',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleTimeline: Timeline = {
    id: 'tl1', name: 'Test Timeline', order: 1,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleWhiteboard: Whiteboard = {
    id: 'w1', name: 'Test Whiteboard', elements: '[]', tags: [], order: 1,
    trashed: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleIOC: StandaloneIOC = {
    id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
    tags: [], trashed: false, archived: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleThread: ChatThread = {
    id: 'ch1', title: 'Test Thread', messages: [], model: 'test',
    provider: 'anthropic', tags: [], trashed: false, archived: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const sampleFolder: Folder = {
    id: 'f1', name: 'Test Folder', order: 1, createdAt: Date.now(),
  };
  const sampleTag: Tag = {
    id: 'tag1', name: 'test-tag', color: '#3b82f6',
  };

  const log: LogFn = vi.fn();

  const notes = {
    notes: [sampleNote],
    createNote: vi.fn().mockResolvedValue(sampleNote),
    trashNote: vi.fn().mockResolvedValue(undefined),
    restoreNote: vi.fn().mockResolvedValue(undefined),
    togglePin: vi.fn().mockResolvedValue(undefined),
    toggleArchive: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
  };

  const tasks = {
    tasks: [sampleTask],
    createTask: vi.fn().mockResolvedValue(sampleTask),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    toggleComplete: vi.fn().mockResolvedValue(undefined),
    trashTask: vi.fn().mockResolvedValue(undefined),
    restoreTask: vi.fn().mockResolvedValue(undefined),
    toggleArchiveTask: vi.fn().mockResolvedValue(undefined),
    emptyTrashTasks: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
  };

  const timeline = {
    events: [sampleEvent],
    createEvent: vi.fn().mockResolvedValue(sampleEvent),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    toggleStar: vi.fn().mockResolvedValue(undefined),
    trashEvent: vi.fn().mockResolvedValue(undefined),
    restoreEvent: vi.fn().mockResolvedValue(undefined),
    toggleArchiveEvent: vi.fn().mockResolvedValue(undefined),
    emptyTrashEvents: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
  };

  const timelinesOps = {
    timelines: [sampleTimeline],
    createTimeline: vi.fn().mockResolvedValue(sampleTimeline),
    deleteTimeline: vi.fn().mockResolvedValue(undefined),
  };

  const whiteboardOps = {
    whiteboards: [sampleWhiteboard],
    createWhiteboard: vi.fn().mockResolvedValue(sampleWhiteboard),
    deleteWhiteboard: vi.fn().mockResolvedValue(undefined),
    trashWhiteboard: vi.fn().mockResolvedValue(undefined),
    restoreWhiteboard: vi.fn().mockResolvedValue(undefined),
    toggleArchiveWhiteboard: vi.fn().mockResolvedValue(undefined),
    emptyTrashWhiteboards: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
  };

  const standaloneIOCs = {
    iocs: [sampleIOC],
    createIOC: vi.fn().mockResolvedValue(sampleIOC),
    trashIOC: vi.fn().mockResolvedValue(undefined),
    restoreIOC: vi.fn().mockResolvedValue(undefined),
    toggleArchiveIOC: vi.fn().mockResolvedValue(undefined),
    deleteIOC: vi.fn().mockResolvedValue(undefined),
    emptyTrashIOCs: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
  };

  const chats = {
    createThread: vi.fn().mockResolvedValue(sampleThread),
    reload: vi.fn(),
  };

  const foldersOps = {
    folders: [sampleFolder],
    createFolder: vi.fn().mockResolvedValue(sampleFolder),
    deleteFolder: vi.fn().mockResolvedValue(undefined),
    deleteFolderWithContents: vi.fn().mockResolvedValue(undefined),
    trashFolderContents: vi.fn().mockResolvedValue(undefined),
    archiveFolder: vi.fn().mockResolvedValue(undefined),
    unarchiveFolder: vi.fn().mockResolvedValue(undefined),
  };

  const tagsOps = {
    tags: [sampleTag],
    createTag: vi.fn().mockResolvedValue(sampleTag),
    deleteTag: vi.fn().mockResolvedValue(undefined),
  };

  return {
    log, notes, tasks, timeline, timelinesOps, whiteboardOps,
    standaloneIOCs, chats, foldersOps, tagsOps,
    sampleNote, sampleTask, sampleEvent, sampleTimeline,
    sampleWhiteboard, sampleIOC, sampleThread, sampleFolder, sampleTag,
  };
}

describe('useLoggedActions', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    mocks = buildMocks();
  });

  function renderLoggedActions() {
    return renderHook(() =>
      useLoggedActions(
        mocks.log,
        mocks.notes,
        mocks.tasks,
        mocks.timeline,
        mocks.timelinesOps,
        mocks.whiteboardOps,
        mocks.standaloneIOCs,
        mocks.chats,
        mocks.foldersOps,
        mocks.tagsOps,
      ),
    );
  }

  // ─── Notes ─────────────────────────────────────────────────────

  describe('note operations', () => {
    it('loggedCreateNote calls createNote and logs with note title', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateNote({ title: 'My Note' });
      });

      expect(mocks.notes.createNote).toHaveBeenCalledWith({ title: 'My Note' });
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'create',
        expect.stringContaining('Test Note'),
        'n1', 'Test Note',
      );
    });

    it('loggedTrashNote calls trashNote and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashNote('n1');
      });

      expect(mocks.notes.trashNote).toHaveBeenCalledWith('n1');
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'trash',
        expect.stringContaining('Trashed note'),
        'n1', 'Test Note',
      );
    });

    it('loggedRestoreNote calls restoreNote and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedRestoreNote('n1');
      });

      expect(mocks.notes.restoreNote).toHaveBeenCalledWith('n1');
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'restore',
        expect.stringContaining('Restored note'),
        'n1', 'Test Note',
      );
    });

    it('loggedTogglePin logs "pin" when note is not pinned', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTogglePin('n1');
      });

      expect(mocks.notes.togglePin).toHaveBeenCalledWith('n1');
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'pin',
        expect.stringContaining('Pinned'),
        'n1', 'Test Note',
      );
    });

    it('loggedTogglePin logs "unpin" when note is already pinned', async () => {
      mocks.notes.notes = [{ ...mocks.sampleNote, pinned: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTogglePin('n1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'unpin',
        expect.stringContaining('Unpinned'),
        'n1', 'Test Note',
      );
    });

    it('loggedToggleArchive logs "archive" when note is not archived', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchive('n1');
      });

      expect(mocks.notes.toggleArchive).toHaveBeenCalledWith('n1');
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'archive',
        expect.stringContaining('Archived'),
        'n1', 'Test Note',
      );
    });

    it('loggedToggleArchive logs "unarchive" when note is already archived', async () => {
      mocks.notes.notes = [{ ...mocks.sampleNote, archived: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchive('n1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'unarchive',
        expect.stringContaining('Unarchived'),
        'n1', 'Test Note',
      );
    });

    it('loggedEmptyTrash counts trashed notes and logs', async () => {
      mocks.notes.notes = [
        { ...mocks.sampleNote, trashed: true },
        { ...mocks.sampleNote, id: 'n2', trashed: true },
        { ...mocks.sampleNote, id: 'n3', trashed: false },
      ];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedEmptyTrash();
      });

      expect(mocks.notes.emptyTrash).toHaveBeenCalled();
      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'empty-trash',
        expect.stringContaining('2 notes'),
      );
    });

    it('loggedTrashNote uses "Untitled" when note not found', async () => {
      mocks.notes.notes = [];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashNote('nonexistent');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'note', 'trash',
        expect.stringContaining('Untitled'),
        'nonexistent', undefined,
      );
    });
  });

  // ─── Tasks ─────────────────────────────────────────────────────

  describe('task operations', () => {
    it('loggedCreateTask calls createTask and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateTask({ title: 'My Task' });
      });

      expect(mocks.tasks.createTask).toHaveBeenCalledWith({ title: 'My Task' });
      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'create',
        expect.stringContaining('Test Task'),
        't1', 'Test Task',
      );
    });

    it('loggedDeleteTask calls deleteTask and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteTask('t1');
      });

      expect(mocks.tasks.deleteTask).toHaveBeenCalledWith('t1');
      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'delete',
        expect.stringContaining('Deleted task'),
        't1', 'Test Task',
      );
    });

    it('loggedToggleComplete logs "complete" when task is not completed', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleComplete('t1');
      });

      expect(mocks.tasks.toggleComplete).toHaveBeenCalledWith('t1');
      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'complete',
        expect.stringContaining('Completed'),
        't1', 'Test Task',
      );
    });

    it('loggedToggleComplete logs "reopen" when task is already completed', async () => {
      mocks.tasks.tasks = [{ ...mocks.sampleTask, completed: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleComplete('t1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'reopen',
        expect.stringContaining('Reopened'),
        't1', 'Test Task',
      );
    });

    it('loggedTrashTask calls trashTask and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashTask('t1');
      });

      expect(mocks.tasks.trashTask).toHaveBeenCalledWith('t1');
      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'trash',
        expect.stringContaining('Trashed task'),
        't1', 'Test Task',
      );
    });

    it('loggedRestoreTask calls restoreTask and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedRestoreTask('t1');
      });

      expect(mocks.tasks.restoreTask).toHaveBeenCalledWith('t1');
      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'restore',
        expect.stringContaining('Restored task'),
        't1', 'Test Task',
      );
    });

    it('loggedToggleArchiveTask logs "archive" when not archived', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveTask('t1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'archive',
        expect.stringContaining('Archived'),
        't1', 'Test Task',
      );
    });

    it('loggedToggleArchiveTask logs "unarchive" when already archived', async () => {
      mocks.tasks.tasks = [{ ...mocks.sampleTask, archived: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveTask('t1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'unarchive',
        expect.stringContaining('Unarchived'),
        't1', 'Test Task',
      );
    });

    it('loggedEmptyTrashTasks counts trashed tasks and logs', async () => {
      mocks.tasks.tasks = [
        { ...mocks.sampleTask, trashed: true },
        { ...mocks.sampleTask, id: 't2', trashed: false },
      ];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedEmptyTrashTasks();
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'task', 'empty-trash',
        expect.stringContaining('1 tasks'),
      );
    });
  });

  // ─── Timeline Events ──────────────────────────────────────────

  describe('timeline event operations', () => {
    it('loggedCreateEvent calls createEvent and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateEvent({ title: 'New Event' });
      });

      expect(mocks.timeline.createEvent).toHaveBeenCalledWith({ title: 'New Event' });
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'create',
        expect.stringContaining('Test Event'),
        'e1', 'Test Event',
      );
    });

    it('loggedDeleteEvent calls deleteEvent and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteEvent('e1');
      });

      expect(mocks.timeline.deleteEvent).toHaveBeenCalledWith('e1');
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'delete',
        expect.stringContaining('Deleted timeline event'),
        'e1', 'Test Event',
      );
    });

    it('loggedToggleStar logs "star" when event is not starred', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleStar('e1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'star',
        expect.stringContaining('Starred'),
        'e1', 'Test Event',
      );
    });

    it('loggedToggleStar logs "unstar" when event is already starred', async () => {
      mocks.timeline.events = [{ ...mocks.sampleEvent, starred: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleStar('e1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'unstar',
        expect.stringContaining('Unstarred'),
        'e1', 'Test Event',
      );
    });

    it('loggedTrashEvent calls trashEvent and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashEvent('e1');
      });

      expect(mocks.timeline.trashEvent).toHaveBeenCalledWith('e1');
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'trash',
        expect.stringContaining('Trashed event'),
        'e1', 'Test Event',
      );
    });

    it('loggedRestoreEvent calls restoreEvent and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedRestoreEvent('e1');
      });

      expect(mocks.timeline.restoreEvent).toHaveBeenCalledWith('e1');
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'restore',
        expect.stringContaining('Restored event'),
        'e1', 'Test Event',
      );
    });

    it('loggedToggleArchiveEvent logs "archive" when not archived', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveEvent('e1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'archive',
        expect.stringContaining('Archived'),
        'e1', 'Test Event',
      );
    });

    it('loggedToggleArchiveEvent logs "unarchive" when already archived', async () => {
      mocks.timeline.events = [{ ...mocks.sampleEvent, archived: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveEvent('e1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'unarchive',
        expect.stringContaining('Unarchived'),
        'e1', 'Test Event',
      );
    });

    it('loggedEmptyTrashEvents counts trashed events and logs', async () => {
      mocks.timeline.events = [
        { ...mocks.sampleEvent, trashed: true },
        { ...mocks.sampleEvent, id: 'e2', trashed: true },
        { ...mocks.sampleEvent, id: 'e3', trashed: true },
      ];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedEmptyTrashEvents();
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'empty-trash',
        expect.stringContaining('3 events'),
      );
    });
  });

  // ─── Timelines ────────────────────────────────────────────────

  describe('timeline operations', () => {
    it('loggedCreateTimeline calls createTimeline and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateTimeline('My Timeline');
      });

      expect(mocks.timelinesOps.createTimeline).toHaveBeenCalledWith('My Timeline');
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'create',
        expect.stringContaining('My Timeline'),
        'tl1', 'My Timeline',
      );
    });

    it('loggedDeleteTimeline calls deleteTimeline and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteTimeline('tl1');
      });

      expect(mocks.timelinesOps.deleteTimeline).toHaveBeenCalledWith('tl1');
      expect(mocks.log).toHaveBeenCalledWith(
        'timeline', 'delete',
        expect.stringContaining('Test Timeline'),
        'tl1', 'Test Timeline',
      );
    });
  });

  // ─── Whiteboards ──────────────────────────────────────────────

  describe('whiteboard operations', () => {
    it('loggedCreateWhiteboard calls createWhiteboard and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateWhiteboard('My Board', 'f1');
      });

      expect(mocks.whiteboardOps.createWhiteboard).toHaveBeenCalledWith('My Board', 'f1');
      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'create',
        expect.stringContaining('Test Whiteboard'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedDeleteWhiteboard calls deleteWhiteboard and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteWhiteboard('w1');
      });

      expect(mocks.whiteboardOps.deleteWhiteboard).toHaveBeenCalledWith('w1');
      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'delete',
        expect.stringContaining('Test Whiteboard'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedTrashWhiteboard calls trashWhiteboard and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashWhiteboard('w1');
      });

      expect(mocks.whiteboardOps.trashWhiteboard).toHaveBeenCalledWith('w1');
      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'trash',
        expect.stringContaining('Trashed whiteboard'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedRestoreWhiteboard calls restoreWhiteboard and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedRestoreWhiteboard('w1');
      });

      expect(mocks.whiteboardOps.restoreWhiteboard).toHaveBeenCalledWith('w1');
      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'restore',
        expect.stringContaining('Restored whiteboard'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedToggleArchiveWhiteboard logs "archive" when not archived', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveWhiteboard('w1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'archive',
        expect.stringContaining('Archived'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedToggleArchiveWhiteboard logs "unarchive" when already archived', async () => {
      mocks.whiteboardOps.whiteboards = [{ ...mocks.sampleWhiteboard, archived: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveWhiteboard('w1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'unarchive',
        expect.stringContaining('Unarchived'),
        'w1', 'Test Whiteboard',
      );
    });

    it('loggedEmptyTrashWhiteboards counts trashed whiteboards and logs', async () => {
      mocks.whiteboardOps.whiteboards = [
        { ...mocks.sampleWhiteboard, trashed: true },
      ];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedEmptyTrashWhiteboards();
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'whiteboard', 'empty-trash',
        expect.stringContaining('1 whiteboards'),
      );
    });
  });

  // ─── IOCs ─────────────────────────────────────────────────────

  describe('standalone IOC operations', () => {
    it('loggedCreateIOC calls createIOC and logs with value', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateIOC({ value: '192.168.1.1' });
      });

      expect(mocks.standaloneIOCs.createIOC).toHaveBeenCalledWith({ value: '192.168.1.1' });
      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'create',
        expect.stringContaining('10.0.0.1'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedTrashIOC calls trashIOC and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashIOC('ioc1');
      });

      expect(mocks.standaloneIOCs.trashIOC).toHaveBeenCalledWith('ioc1');
      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'trash',
        expect.stringContaining('10.0.0.1'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedRestoreIOC calls restoreIOC and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedRestoreIOC('ioc1');
      });

      expect(mocks.standaloneIOCs.restoreIOC).toHaveBeenCalledWith('ioc1');
      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'restore',
        expect.stringContaining('10.0.0.1'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedToggleArchiveIOC logs "archive" when not archived', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveIOC('ioc1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'archive',
        expect.stringContaining('Archived'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedToggleArchiveIOC logs "unarchive" when already archived', async () => {
      mocks.standaloneIOCs.iocs = [{ ...mocks.sampleIOC, archived: true }];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedToggleArchiveIOC('ioc1');
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'unarchive',
        expect.stringContaining('Unarchived'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedDeleteIOC calls deleteIOC and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteIOC('ioc1');
      });

      expect(mocks.standaloneIOCs.deleteIOC).toHaveBeenCalledWith('ioc1');
      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'delete',
        expect.stringContaining('10.0.0.1'),
        'ioc1', '10.0.0.1',
      );
    });

    it('loggedEmptyTrashIOCs counts trashed IOCs and logs', async () => {
      mocks.standaloneIOCs.iocs = [
        { ...mocks.sampleIOC, trashed: true },
        { ...mocks.sampleIOC, id: 'ioc2', trashed: true },
      ];
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedEmptyTrashIOCs();
      });

      expect(mocks.log).toHaveBeenCalledWith(
        'ioc', 'empty-trash',
        expect.stringContaining('2 IOCs'),
      );
    });
  });

  // ─── Folders ──────────────────────────────────────────────────

  describe('folder operations', () => {
    it('loggedCreateFolder calls createFolder and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateFolder('New Investigation');
      });

      expect(mocks.foldersOps.createFolder).toHaveBeenCalledWith('New Investigation');
      expect(mocks.log).toHaveBeenCalledWith(
        'folder', 'create',
        expect.stringContaining('New Investigation'),
        'f1', 'New Investigation',
      );
    });

    it('loggedDeleteFolder calls deleteFolderWithContents, reloads hooks, and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteFolder('f1');
      });

      expect(mocks.foldersOps.deleteFolderWithContents).toHaveBeenCalledWith('f1');
      expect(mocks.notes.reload).toHaveBeenCalled();
      expect(mocks.tasks.reload).toHaveBeenCalled();
      expect(mocks.timeline.reload).toHaveBeenCalled();
      expect(mocks.whiteboardOps.reload).toHaveBeenCalled();
      expect(mocks.standaloneIOCs.reload).toHaveBeenCalled();
      expect(mocks.chats.reload).toHaveBeenCalled();
      expect(mocks.log).toHaveBeenCalledWith(
        'folder', 'delete',
        expect.stringContaining('Test Folder'),
        'f1', 'Test Folder',
      );
    });

    it('loggedTrashFolderContents calls trashFolderContents and reloads all entity hooks', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedTrashFolderContents('f1');
      });

      expect(mocks.foldersOps.trashFolderContents).toHaveBeenCalledWith('f1');
      expect(mocks.log).toHaveBeenCalledWith(
        'folder', 'trash',
        expect.stringContaining('Test Folder'),
        'f1', 'Test Folder',
      );
      // Should reload all entity hooks
      expect(mocks.notes.reload).toHaveBeenCalled();
      expect(mocks.tasks.reload).toHaveBeenCalled();
      expect(mocks.timeline.reload).toHaveBeenCalled();
      expect(mocks.whiteboardOps.reload).toHaveBeenCalled();
      expect(mocks.standaloneIOCs.reload).toHaveBeenCalled();
    });

    it('loggedArchiveFolder calls archiveFolder and reloads all entity hooks', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedArchiveFolder('f1');
      });

      expect(mocks.foldersOps.archiveFolder).toHaveBeenCalledWith('f1');
      expect(mocks.log).toHaveBeenCalledWith(
        'folder', 'archive',
        expect.stringContaining('Archived investigation'),
        'f1', 'Test Folder',
      );
      expect(mocks.notes.reload).toHaveBeenCalled();
      expect(mocks.tasks.reload).toHaveBeenCalled();
      expect(mocks.timeline.reload).toHaveBeenCalled();
      expect(mocks.whiteboardOps.reload).toHaveBeenCalled();
      expect(mocks.standaloneIOCs.reload).toHaveBeenCalled();
    });

    it('loggedUnarchiveFolder calls unarchiveFolder and reloads all entity hooks', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedUnarchiveFolder('f1');
      });

      expect(mocks.foldersOps.unarchiveFolder).toHaveBeenCalledWith('f1');
      expect(mocks.log).toHaveBeenCalledWith(
        'folder', 'unarchive',
        expect.stringContaining('Unarchived investigation'),
        'f1', 'Test Folder',
      );
      expect(mocks.notes.reload).toHaveBeenCalled();
      expect(mocks.tasks.reload).toHaveBeenCalled();
    });
  });

  // ─── Tags ─────────────────────────────────────────────────────

  describe('tag operations', () => {
    it('loggedCreateTag calls createTag and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateTag('new-tag');
      });

      expect(mocks.tagsOps.createTag).toHaveBeenCalledWith('new-tag');
      expect(mocks.log).toHaveBeenCalledWith(
        'tag', 'create',
        expect.stringContaining('new-tag'),
        'tag1', 'new-tag',
      );
    });

    it('loggedDeleteTag calls deleteTag and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedDeleteTag('tag1');
      });

      expect(mocks.tagsOps.deleteTag).toHaveBeenCalledWith('tag1');
      expect(mocks.log).toHaveBeenCalledWith(
        'tag', 'delete',
        expect.stringContaining('test-tag'),
        'tag1', 'test-tag',
      );
    });
  });

  // ─── Chat ─────────────────────────────────────────────────────

  describe('chat thread operations', () => {
    it('loggedCreateChatThread calls createThread and logs', async () => {
      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.loggedCreateChatThread({ title: 'My Chat' });
      });

      expect(mocks.chats.createThread).toHaveBeenCalledWith({ title: 'My Chat' });
      expect(mocks.log).toHaveBeenCalledWith(
        'chat', 'create',
        expect.stringContaining('Test Thread'),
        'ch1', 'Test Thread',
      );
    });
  });

  // ─── Composite ────────────────────────────────────────────────

  describe('emptyAllTrash', () => {
    it('calls all empty trash functions and logs for each', async () => {
      mocks.notes.notes = [{ ...mocks.sampleNote, trashed: true }];
      mocks.tasks.tasks = [{ ...mocks.sampleTask, trashed: true }];
      mocks.timeline.events = [{ ...mocks.sampleEvent, trashed: true }];
      mocks.whiteboardOps.whiteboards = [{ ...mocks.sampleWhiteboard, trashed: true }];
      mocks.standaloneIOCs.iocs = [{ ...mocks.sampleIOC, trashed: true }];

      const { result } = renderLoggedActions();
      await act(async () => {
        await result.current.emptyAllTrash();
      });

      expect(mocks.notes.emptyTrash).toHaveBeenCalled();
      expect(mocks.tasks.emptyTrashTasks).toHaveBeenCalled();
      expect(mocks.timeline.emptyTrashEvents).toHaveBeenCalled();
      expect(mocks.whiteboardOps.emptyTrashWhiteboards).toHaveBeenCalled();
      expect(mocks.standaloneIOCs.emptyTrashIOCs).toHaveBeenCalled();

      // Should have logged 5 separate empty-trash actions
      const logCalls = (mocks.log as ReturnType<typeof vi.fn>).mock.calls;
      const emptyTrashCalls = logCalls.filter((c: unknown[]) => c[1] === 'empty-trash');
      expect(emptyTrashCalls).toHaveLength(5);
    });
  });
});
