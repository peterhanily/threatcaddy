import { useCallback } from 'react';
import type { Note, Task, TimelineEvent, StandaloneIOC, ChatThread, Folder, Tag, Timeline, Whiteboard } from '../types';

import type { ActivityCategory, ActivityAction } from '../types';

type LogFn = (category: ActivityCategory, action: ActivityAction, detail: string, itemId?: string, itemTitle?: string) => void;

/**
 * Wraps all data mutation hooks with activity logging.
 * Extracts ~280 lines of boilerplate from App.tsx.
 */
export function useLoggedActions(
  log: LogFn,
  notes: {
    notes: Note[];
    createNote(p?: Partial<Note>): Promise<Note>;
    trashNote(id: string): Promise<void>;
    restoreNote(id: string): Promise<void>;
    togglePin(id: string): Promise<void>;
    toggleArchive(id: string): Promise<void>;
    emptyTrash(): Promise<void>;
    reload(): void;
  },
  tasks: {
    tasks: Task[];
    createTask(p?: Partial<Task>): Promise<Task>;
    deleteTask(id: string): Promise<void>;
    toggleComplete(id: string): Promise<void>;
    trashTask(id: string): Promise<void>;
    restoreTask(id: string): Promise<void>;
    toggleArchiveTask(id: string): Promise<void>;
    emptyTrashTasks(): Promise<void>;
    reload(): void;
  },
  timeline: {
    events: TimelineEvent[];
    createEvent(data: Partial<TimelineEvent>): Promise<TimelineEvent>;
    deleteEvent(id: string): Promise<void>;
    toggleStar(id: string): Promise<void>;
    trashEvent(id: string): Promise<void>;
    restoreEvent(id: string): Promise<void>;
    toggleArchiveEvent(id: string): Promise<void>;
    emptyTrashEvents(): Promise<void>;
    reload(): void;
  },
  timelinesOps: {
    timelines: Timeline[];
    createTimeline(name: string): Promise<Timeline>;
    deleteTimeline(id: string): Promise<void>;
  },
  whiteboardOps: {
    whiteboards: Whiteboard[];
    createWhiteboard(name?: string, folderId?: string): Promise<Whiteboard>;
    deleteWhiteboard(id: string): Promise<void>;
    trashWhiteboard(id: string): Promise<void>;
    restoreWhiteboard(id: string): Promise<void>;
    toggleArchiveWhiteboard(id: string): Promise<void>;
    emptyTrashWhiteboards(): Promise<void>;
    reload(): void;
  },
  standaloneIOCs: {
    iocs: StandaloneIOC[];
    createIOC(p?: Partial<StandaloneIOC>): Promise<StandaloneIOC>;
    trashIOC(id: string): Promise<void>;
    restoreIOC(id: string): Promise<void>;
    toggleArchiveIOC(id: string): Promise<void>;
    deleteIOC(id: string): Promise<void>;
    emptyTrashIOCs(): Promise<void>;
    reload(): void;
  },
  chats: {
    createThread(p?: Partial<ChatThread>): Promise<ChatThread>;
    reload(): void;
  },
  foldersOps: {
    folders: Folder[];
    createFolder(name: string): Promise<Folder>;
    deleteFolder(id: string): Promise<void>;
    deleteFolderWithContents(id: string): Promise<void>;
    trashFolderContents(id: string): Promise<void>;
    archiveFolder(id: string): Promise<void>;
    unarchiveFolder(id: string): Promise<void>;
  },
  tagsOps: {
    tags: Tag[];
    createTag(name: string): Promise<Tag>;
    deleteTag(id: string): Promise<void>;
  },
) {
  // ─── Notes ─────────────────────────────────────────────────────

  const loggedCreateNote = useCallback(async (partial?: Partial<Note>) => {
    const note = await notes.createNote(partial);
    log('note', 'create', `Created note "${note.title}"`, note.id, note.title);
    return note;
  }, [notes, log]);

  const loggedTrashNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.trashNote(id);
    log('note', 'trash', `Trashed note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, log]);

  const loggedRestoreNote = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.restoreNote(id);
    log('note', 'restore', `Restored note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, log]);

  const loggedTogglePin = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.togglePin(id);
    const action = note?.pinned ? 'unpin' : 'pin';
    log('note', action, `${action === 'pin' ? 'Pinned' : 'Unpinned'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, log]);

  const loggedToggleArchive = useCallback(async (id: string) => {
    const note = notes.notes.find((n) => n.id === id);
    await notes.toggleArchive(id);
    const action = note?.archived ? 'unarchive' : 'archive';
    log('note', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} note "${note?.title || 'Untitled'}"`, id, note?.title);
  }, [notes, log]);

  const loggedEmptyTrash = useCallback(async () => {
    const count = notes.notes.filter((n) => n.trashed).length;
    await notes.emptyTrash();
    log('note', 'empty-trash', `Emptied trash (${count} notes)`);
  }, [notes, log]);

  // ─── Tasks ─────────────────────────────────────────────────────

  const loggedCreateTask = useCallback(async (partial?: Partial<Task>) => {
    const task = await tasks.createTask(partial);
    log('task', 'create', `Created task "${task.title || 'Untitled'}"`, task.id, task.title);
    return task;
  }, [tasks, log]);

  const loggedDeleteTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.deleteTask(id);
    log('task', 'delete', `Deleted task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, log]);

  const loggedToggleComplete = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.toggleComplete(id);
    const action = task?.completed ? 'reopen' : 'complete';
    log('task', action, `${action === 'complete' ? 'Completed' : 'Reopened'} task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, log]);

  const loggedTrashTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.trashTask(id);
    log('task', 'trash', `Trashed task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, log]);

  const loggedRestoreTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.restoreTask(id);
    log('task', 'restore', `Restored task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, log]);

  const loggedToggleArchiveTask = useCallback(async (id: string) => {
    const task = tasks.tasks.find((t) => t.id === id);
    await tasks.toggleArchiveTask(id);
    const action = task?.archived ? 'unarchive' : 'archive';
    log('task', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} task "${task?.title || 'Untitled'}"`, id, task?.title);
  }, [tasks, log]);

  const loggedEmptyTrashTasks = useCallback(async () => {
    const count = tasks.tasks.filter((t) => t.trashed).length;
    await tasks.emptyTrashTasks();
    log('task', 'empty-trash', `Emptied task trash (${count} tasks)`);
  }, [tasks, log]);

  // ─── Timeline Events ──────────────────────────────────────────

  const loggedCreateEvent = useCallback(async (data: Partial<TimelineEvent>) => {
    const event = await timeline.createEvent(data);
    log('timeline', 'create', `Created timeline event "${event.title || 'Untitled'}"`, event.id, event.title);
    return event;
  }, [timeline, log]);

  const loggedDeleteEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.deleteEvent(id);
    log('timeline', 'delete', `Deleted timeline event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, log]);

  const loggedToggleStar = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.toggleStar(id);
    const action = event?.starred ? 'unstar' : 'star';
    log('timeline', action, `${action === 'star' ? 'Starred' : 'Unstarred'} event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, log]);

  const loggedTrashEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.trashEvent(id);
    log('timeline', 'trash', `Trashed event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, log]);

  const loggedRestoreEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.restoreEvent(id);
    log('timeline', 'restore', `Restored event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, log]);

  const loggedToggleArchiveEvent = useCallback(async (id: string) => {
    const event = timeline.events.find((e) => e.id === id);
    await timeline.toggleArchiveEvent(id);
    const action = event?.archived ? 'unarchive' : 'archive';
    log('timeline', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} event "${event?.title || 'Untitled'}"`, id, event?.title);
  }, [timeline, log]);

  const loggedEmptyTrashEvents = useCallback(async () => {
    const count = timeline.events.filter((e) => e.trashed).length;
    await timeline.emptyTrashEvents();
    log('timeline', 'empty-trash', `Emptied event trash (${count} events)`);
  }, [timeline, log]);

  // ─── Timelines ─────────────────────────────────────────────────

  const loggedCreateTimeline = useCallback(async (name: string) => {
    const tl = await timelinesOps.createTimeline(name);
    log('timeline', 'create', `Created timeline "${name}"`, tl.id, name);
    return tl;
  }, [timelinesOps, log]);

  const loggedDeleteTimeline = useCallback(async (id: string) => {
    const tl = timelinesOps.timelines.find((t) => t.id === id);
    await timelinesOps.deleteTimeline(id);
    log('timeline', 'delete', `Deleted timeline "${tl?.name || 'Untitled'}"`, id, tl?.name);
  }, [timelinesOps, log]);

  // ─── Whiteboards ──────────────────────────────────────────────

  const loggedCreateWhiteboard = useCallback(async (name?: string, folderId?: string) => {
    const wb = await whiteboardOps.createWhiteboard(name, folderId);
    log('whiteboard', 'create', `Created whiteboard "${wb.name}"`, wb.id, wb.name);
    return wb;
  }, [whiteboardOps, log]);

  const loggedDeleteWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboardOps.whiteboards.find((w) => w.id === id);
    await whiteboardOps.deleteWhiteboard(id);
    log('whiteboard', 'delete', `Deleted whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [whiteboardOps, log]);

  const loggedTrashWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboardOps.whiteboards.find((w) => w.id === id);
    await whiteboardOps.trashWhiteboard(id);
    log('whiteboard', 'trash', `Trashed whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [whiteboardOps, log]);

  const loggedRestoreWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboardOps.whiteboards.find((w) => w.id === id);
    await whiteboardOps.restoreWhiteboard(id);
    log('whiteboard', 'restore', `Restored whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [whiteboardOps, log]);

  const loggedToggleArchiveWhiteboard = useCallback(async (id: string) => {
    const wb = whiteboardOps.whiteboards.find((w) => w.id === id);
    await whiteboardOps.toggleArchiveWhiteboard(id);
    const action = wb?.archived ? 'unarchive' : 'archive';
    log('whiteboard', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} whiteboard "${wb?.name || 'Untitled'}"`, id, wb?.name);
  }, [whiteboardOps, log]);

  const loggedEmptyTrashWhiteboards = useCallback(async () => {
    const count = whiteboardOps.whiteboards.filter((w) => w.trashed).length;
    await whiteboardOps.emptyTrashWhiteboards();
    log('whiteboard', 'empty-trash', `Emptied whiteboard trash (${count} whiteboards)`);
  }, [whiteboardOps, log]);

  // ─── Standalone IOCs ──────────────────────────────────────────

  const loggedCreateIOC = useCallback(async (partial?: Partial<StandaloneIOC>) => {
    const ioc = await standaloneIOCs.createIOC(partial);
    log('ioc', 'create', `Created standalone IOC "${ioc.value}"`, ioc.id, ioc.value);
    return ioc;
  }, [standaloneIOCs, log]);

  const loggedTrashIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCs.iocs.find((i) => i.id === id);
    await standaloneIOCs.trashIOC(id);
    log('ioc', 'trash', `Trashed IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCs, log]);

  const loggedRestoreIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCs.iocs.find((i) => i.id === id);
    await standaloneIOCs.restoreIOC(id);
    log('ioc', 'restore', `Restored IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCs, log]);

  const loggedToggleArchiveIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCs.iocs.find((i) => i.id === id);
    await standaloneIOCs.toggleArchiveIOC(id);
    const action = ioc?.archived ? 'unarchive' : 'archive';
    log('ioc', action, `${action === 'archive' ? 'Archived' : 'Unarchived'} IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCs, log]);

  const loggedDeleteIOC = useCallback(async (id: string) => {
    const ioc = standaloneIOCs.iocs.find((i) => i.id === id);
    await standaloneIOCs.deleteIOC(id);
    log('ioc', 'delete', `Deleted IOC "${ioc?.value || ''}"`, id, ioc?.value);
  }, [standaloneIOCs, log]);

  const loggedEmptyTrashIOCs = useCallback(async () => {
    const count = standaloneIOCs.iocs.filter((i) => i.trashed).length;
    await standaloneIOCs.emptyTrashIOCs();
    log('ioc', 'empty-trash', `Emptied IOC trash (${count} IOCs)`);
  }, [standaloneIOCs, log]);

  // ─── Folders ──────────────────────────────────────────────────

  const loggedCreateFolder = useCallback(async (name: string) => {
    const folder = await foldersOps.createFolder(name);
    log('folder', 'create', `Created investigation "${name}"`, folder.id, name);
    return folder;
  }, [foldersOps, log]);

  const loggedDeleteFolder = useCallback(async (id: string) => {
    const folder = foldersOps.folders.find((f) => f.id === id);
    await foldersOps.deleteFolderWithContents(id);
    // Reload all hooks so React state reflects the DB deletions
    notes.reload();
    tasks.reload();
    timeline.reload();
    whiteboardOps.reload();
    standaloneIOCs.reload();
    chats.reload();
    log('folder', 'delete', `Deleted investigation "${folder?.name || 'Untitled'}"`, id, folder?.name);
  }, [foldersOps, notes, tasks, timeline, whiteboardOps, standaloneIOCs, chats, log]);

  const loggedTrashFolderContents = useCallback(async (id: string) => {
    const folder = foldersOps.folders.find((f) => f.id === id);
    await foldersOps.trashFolderContents(id);
    log('folder', 'trash', `Trashed contents of investigation "${folder?.name || 'Untitled'}" and removed folder`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    whiteboardOps.reload();
    standaloneIOCs.reload();
    chats.reload();
  }, [foldersOps, log, notes, tasks, timeline, whiteboardOps, standaloneIOCs, chats]);

  const loggedArchiveFolder = useCallback(async (id: string) => {
    const folder = foldersOps.folders.find((f) => f.id === id);
    await foldersOps.archiveFolder(id);
    log('folder', 'archive', `Archived investigation "${folder?.name || 'Untitled'}" and all contents`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    whiteboardOps.reload();
    standaloneIOCs.reload();
    chats.reload();
  }, [foldersOps, log, notes, tasks, timeline, whiteboardOps, standaloneIOCs, chats]);

  const loggedUnarchiveFolder = useCallback(async (id: string) => {
    const folder = foldersOps.folders.find((f) => f.id === id);
    await foldersOps.unarchiveFolder(id);
    log('folder', 'unarchive', `Unarchived investigation "${folder?.name || 'Untitled'}" and all contents`, id, folder?.name);
    notes.reload();
    tasks.reload();
    timeline.reload();
    whiteboardOps.reload();
    standaloneIOCs.reload();
    chats.reload();
  }, [foldersOps, log, notes, tasks, timeline, whiteboardOps, standaloneIOCs, chats]);

  // ─── Tags ─────────────────────────────────────────────────────

  const loggedCreateTag = useCallback(async (name: string) => {
    const tag = await tagsOps.createTag(name);
    log('tag', 'create', `Created tag "${name}"`, tag.id, name);
    return tag;
  }, [tagsOps, log]);

  const loggedDeleteTag = useCallback(async (id: string) => {
    const tag = tagsOps.tags.find((t) => t.id === id);
    await tagsOps.deleteTag(id);
    log('tag', 'delete', `Deleted tag "${tag?.name || ''}"`, id, tag?.name);
  }, [tagsOps, log]);

  // ─── Chat Threads ─────────────────────────────────────────────

  const loggedCreateChatThread = useCallback(async (partial?: Partial<ChatThread>) => {
    const thread = await chats.createThread(partial);
    log('chat', 'create', `Created chat thread "${thread.title}"`, thread.id, thread.title);
    return thread;
  }, [chats, log]);

  // ─── Composite ────────────────────────────────────────────────

  const emptyAllTrash = useCallback(async () => {
    await loggedEmptyTrash();
    await loggedEmptyTrashTasks();
    await loggedEmptyTrashEvents();
    await loggedEmptyTrashWhiteboards();
    await loggedEmptyTrashIOCs();
  }, [loggedEmptyTrash, loggedEmptyTrashTasks, loggedEmptyTrashEvents, loggedEmptyTrashWhiteboards, loggedEmptyTrashIOCs]);

  return {
    // Notes
    loggedCreateNote, loggedTrashNote, loggedRestoreNote,
    loggedTogglePin, loggedToggleArchive, loggedEmptyTrash,
    // Tasks
    loggedCreateTask, loggedDeleteTask, loggedToggleComplete,
    loggedTrashTask, loggedRestoreTask, loggedToggleArchiveTask, loggedEmptyTrashTasks,
    // Timeline events
    loggedCreateEvent, loggedDeleteEvent, loggedToggleStar,
    loggedTrashEvent, loggedRestoreEvent, loggedToggleArchiveEvent, loggedEmptyTrashEvents,
    // Timelines
    loggedCreateTimeline, loggedDeleteTimeline,
    // Whiteboards
    loggedCreateWhiteboard, loggedDeleteWhiteboard,
    loggedTrashWhiteboard, loggedRestoreWhiteboard, loggedToggleArchiveWhiteboard, loggedEmptyTrashWhiteboards,
    // IOCs
    loggedCreateIOC, loggedTrashIOC, loggedRestoreIOC,
    loggedToggleArchiveIOC, loggedDeleteIOC, loggedEmptyTrashIOCs,
    // Folders
    loggedCreateFolder, loggedDeleteFolder,
    loggedTrashFolderContents, loggedArchiveFolder, loggedUnarchiveFolder,
    // Tags
    loggedCreateTag, loggedDeleteTag,
    // Chat
    loggedCreateChatThread,
    // Composite
    emptyAllTrash,
  };
}
