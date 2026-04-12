/* eslint-disable react-refresh/only-export-components -- context + provider + hook co-located by design */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
  type RefObject,
  type MutableRefObject,
} from 'react';
import type {
  ViewMode,
  SortOption,
  EditorMode,
  TaskViewMode,
  Folder,
  TimelineEvent,
  Settings,
} from '../types';
import type { LayoutName } from '../components/Graph/GraphCanvas';
import { useNavigationHistory, type NavState } from '../hooks/useNavigationHistory';

// ---------------------------------------------------------------------------
// Module-level initialization (runs once at import time)
// ---------------------------------------------------------------------------

const NAV_STORAGE_KEY = 'threatcaddy-nav-state';

function loadNavState(): NavState | null {
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Parse share hash to prevent entity hash conflict. */
function parseShareHash(): string | null {
  const match = window.location.hash.match(/^#share=(.+)$/);
  return match?.[1] ?? null;
}

function parseEntityHash(): { type: 'note' | 'task' | 'event'; id: string } | null {
  if (parseShareHash()) return null;
  const match = window.location.hash.match(/^#entity=(note|task|event):(.+)$/);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return { type: match[1] as 'note' | 'task' | 'event', id: match[2] };
}

const initialDeepLink = parseEntityHash();
/** @internal Exported so AppDataLayer can seed InvestigationProvider's initial folder. */
export const savedNavState = loadNavState();

const deepLinkView: ViewMode | undefined = initialDeepLink
  ? ({ note: 'notes', task: 'tasks', event: 'timeline' } as const)[initialDeepLink.type]
  : undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavigationContextValue {
  // State
  activeView: ViewMode;
  selectedNoteId: string | undefined;
  selectedTimelineId: string | undefined;
  selectedWhiteboardId: string | undefined;
  selectedChatThreadId: string | undefined;
  sort: SortOption;
  editorMode: EditorMode;
  taskViewMode: TaskViewMode;
  graphLayout: LayoutName;
  noteListWidth: number;
  noteListCollapsed: boolean;
  noteListDragging: boolean;
  pendingNewTask: boolean;
  pendingNewEvent: boolean;

  // Refs
  notesContainerRef: RefObject<HTMLDivElement | null>;
  noteNavGraceRef: MutableRefObject<boolean>;

  // Deep link (consumed once by App.tsx)
  initialDeepLink: { type: 'note' | 'task' | 'event'; id: string } | null;

  // Setters
  setActiveView: React.Dispatch<React.SetStateAction<ViewMode>>;
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedTimelineId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedWhiteboardId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSelectedChatThreadId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSort: React.Dispatch<React.SetStateAction<SortOption>>;
  setEditorMode: React.Dispatch<React.SetStateAction<EditorMode>>;
  setTaskViewMode: React.Dispatch<React.SetStateAction<TaskViewMode>>;
  setGraphLayout: React.Dispatch<React.SetStateAction<LayoutName>>;
  setNoteListWidth: React.Dispatch<React.SetStateAction<number>>;
  setNoteListCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingNewTask: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingNewEvent: React.Dispatch<React.SetStateAction<boolean>>;

  // Navigation actions
  navigateTo: (view: ViewMode, opts?: {
    selectedNoteId?: string;
    selectedTimelineId?: string;
    selectedWhiteboardId?: string;
  }) => void;
  handleNavRestore: (state: NavState) => void;
  handleNoteListDragStart: (e: React.MouseEvent) => void;
  toggleNoteListCollapse: () => void;
  handleToggleEditorMode: () => void;

  // Search navigation handlers
  searchNavigateToNote: (id: string) => void;
  searchNavigateToTask: (id: string) => void;
  searchNavigateToTimeline: (id: string) => void;
  searchNavigateToWhiteboard: (id: string) => void;
  searchNavigateToIOC: () => void;
  searchNavigateToChat: (id: string) => void;
}

interface NavigationProviderProps {
  folders: Folder[];
  selectedFolderId?: string;
  timelineEvents: TimelineEvent[];
  initialSettings: Pick<Settings, 'editorMode' | 'taskViewMode' | 'noteListCollapsed'>;
  updateSettings: (s: Partial<Settings>) => void;
  onClearFilters?: () => void;
  onCloseSettings?: () => void;
  onRestoreFolderId?: (id?: string) => void;
  defaultView?: ViewMode;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NavigationContext = createContext<NavigationContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function NavigationProvider({
  folders,
  selectedFolderId,
  timelineEvents,
  initialSettings,
  updateSettings,
  onClearFilters,
  onCloseSettings,
  onRestoreFolderId,
  defaultView = 'notes',
  children,
}: NavigationProviderProps) {
  // -- Core navigation state --
  const [activeView, setActiveView] = useState<ViewMode>(
    deepLinkView ?? savedNavState?.view ?? defaultView,
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(
    initialDeepLink?.type === 'note' ? initialDeepLink.id : savedNavState?.selectedNoteId,
  );
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | undefined>(
    savedNavState?.selectedTimelineId,
  );
  const [selectedWhiteboardId, setSelectedWhiteboardId] = useState<string | undefined>(
    savedNavState?.selectedWhiteboardId,
  );
  const [selectedChatThreadId, setSelectedChatThreadId] = useState<string | undefined>(
    () => sessionStorage.getItem('tc-chat-thread') ?? undefined,
  );

  // -- UI state --
  const [sort, setSort] = useState<SortOption>('updatedAt');
  const [editorMode, setEditorMode] = useState<EditorMode>(initialSettings.editorMode ?? 'edit');
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>(initialSettings.taskViewMode ?? 'list');
  const [graphLayout, setGraphLayout] = useState<LayoutName>('cose-bilkent');
  const [noteListWidth, setNoteListWidth] = useState(288);
  const [noteListCollapsed, setNoteListCollapsed] = useState(initialSettings.noteListCollapsed ?? false);
  const [noteListDragging, setNoteListDragging] = useState(false);
  const [pendingNewTask, setPendingNewTask] = useState(false);
  const [pendingNewEvent, setPendingNewEvent] = useState(false);

  // -- Refs --
  const notesContainerRef = useRef<HTMLDivElement | null>(null);
  const noteNavGraceRef = useRef(false);

  // -- Navigation history (browser back/forward) --
  const handleNavRestore = useCallback((state: NavState) => {
    setActiveView(state.view);
    if (state.selectedNoteId !== undefined) setSelectedNoteId(state.selectedNoteId);
    if (state.selectedTimelineId !== undefined) setSelectedTimelineId(state.selectedTimelineId);
    if (state.selectedWhiteboardId !== undefined) setSelectedWhiteboardId(state.selectedWhiteboardId);
    if (state.selectedFolderId !== undefined) onRestoreFolderId?.(state.selectedFolderId);
    onCloseSettings?.();
  }, [onCloseSettings, onRestoreFolderId]);

  const { navigate: navPush } = useNavigationHistory({ onViewChange: handleNavRestore });

  // -- Navigation --
  const navigateTo = useCallback(
    (view: ViewMode, opts?: {
      selectedNoteId?: string;
      selectedTimelineId?: string;
      selectedWhiteboardId?: string;
    }) => {
      setActiveView(view);
      onCloseSettings?.();

      if (opts?.selectedNoteId !== undefined) setSelectedNoteId(opts.selectedNoteId);
      if (opts?.selectedWhiteboardId !== undefined) setSelectedWhiteboardId(opts.selectedWhiteboardId);

      // Auto-select investigation timeline when switching to timeline view
      if (view === 'timeline' && !opts?.selectedTimelineId && selectedFolderId) {
        const folder = folders.find((f) => f.id === selectedFolderId);
        if (folder?.timelineId) {
          setSelectedTimelineId(folder.timelineId);
        }
      } else if (opts?.selectedTimelineId !== undefined) {
        setSelectedTimelineId(opts.selectedTimelineId);
      }

      navPush({
        view,
        selectedNoteId: opts?.selectedNoteId,
        selectedTimelineId: opts?.selectedTimelineId,
        selectedWhiteboardId: opts?.selectedWhiteboardId,
        selectedFolderId,
      });
    },
    [folders, selectedFolderId, navPush, onCloseSettings],
  );

  // -- Note list drag resize --
  const handleNoteListDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setNoteListDragging(true);

      const onMove = (ev: MouseEvent) => {
        const container = notesContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const width = Math.min(480, Math.max(180, ev.clientX - rect.left));
        setNoteListWidth(width);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setNoteListDragging(false);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [],
  );

  // -- Note list collapse toggle --
  const toggleNoteListCollapse = useCallback(() => {
    setNoteListCollapsed((prev) => {
      updateSettings({ noteListCollapsed: !prev });
      return !prev;
    });
  }, [updateSettings]);

  // -- Editor mode cycling --
  const handleToggleEditorMode = useCallback(() => {
    setEditorMode((prev) => {
      const next = prev === 'edit' ? 'split' : prev === 'split' ? 'preview' : 'edit';
      return next;
    });
  }, []);

  // -- Search navigation handlers --
  const searchNavigateToNote = useCallback(
    (id: string) => {
      onClearFilters?.();
      setSelectedNoteId(id);
      navigateTo('notes');
    },
    [onClearFilters, navigateTo],
  );

  const searchNavigateToTask = useCallback(
    (id: string) => {
      void id; // accepted for signature compatibility; task view doesn't pre-select
      onClearFilters?.();
      navigateTo('tasks');
    },
    [onClearFilters, navigateTo],
  );

  const searchNavigateToTimeline = useCallback(
    (id: string) => {
      onClearFilters?.();
      const event = timelineEvents.find((e) => e.id === id);
      if (event?.timelineId) setSelectedTimelineId(event.timelineId);
      navigateTo('timeline');
    },
    [onClearFilters, timelineEvents, navigateTo],
  );

  const searchNavigateToWhiteboard = useCallback(
    (id: string) => {
      onClearFilters?.();
      setSelectedWhiteboardId(id);
      navigateTo('whiteboard');
    },
    [onClearFilters, navigateTo],
  );

  const searchNavigateToIOC = useCallback(() => {
    onClearFilters?.();
    navigateTo('ioc-stats');
  }, [onClearFilters, navigateTo]);

  const searchNavigateToChat = useCallback(
    (id: string) => {
      onClearFilters?.();
      setSelectedChatThreadId(id);
      navigateTo('chat');
    },
    [onClearFilters, navigateTo],
  );

  // -- Effects: session storage persistence --
  useEffect(() => {
    sessionStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({
        view: activeView,
        selectedNoteId,
        selectedFolderId,
        selectedTimelineId,
        selectedWhiteboardId,
      }),
    );
  }, [activeView, selectedNoteId, selectedFolderId, selectedTimelineId, selectedWhiteboardId]);

  useEffect(() => {
    if (selectedChatThreadId) {
      sessionStorage.setItem('tc-chat-thread', selectedChatThreadId);
    } else {
      sessionStorage.removeItem('tc-chat-thread');
    }
  }, [selectedChatThreadId]);

  // -- Memoized context value --
  const value = useMemo<NavigationContextValue>(
    () => ({
      activeView,
      selectedNoteId,
      selectedTimelineId,
      selectedWhiteboardId,
      selectedChatThreadId,
      sort,
      editorMode,
      taskViewMode,
      graphLayout,
      noteListWidth,
      noteListCollapsed,
      noteListDragging,
      pendingNewTask,
      pendingNewEvent,
      notesContainerRef,
      noteNavGraceRef,
      initialDeepLink,
      setActiveView,
      setSelectedNoteId,
      setSelectedTimelineId,
      setSelectedWhiteboardId,
      setSelectedChatThreadId,
      setSort,
      setEditorMode,
      setTaskViewMode,
      setGraphLayout,
      setNoteListWidth,
      setNoteListCollapsed,
      setPendingNewTask,
      setPendingNewEvent,
      navigateTo,
      handleNavRestore,
      handleNoteListDragStart,
      toggleNoteListCollapse,
      handleToggleEditorMode,
      searchNavigateToNote,
      searchNavigateToTask,
      searchNavigateToTimeline,
      searchNavigateToWhiteboard,
      searchNavigateToIOC,
      searchNavigateToChat,
    }),
    [
      activeView,
      selectedNoteId,
      selectedTimelineId,
      selectedWhiteboardId,
      selectedChatThreadId,
      sort,
      editorMode,
      taskViewMode,
      graphLayout,
      noteListWidth,
      noteListCollapsed,
      noteListDragging,
      pendingNewTask,
      pendingNewEvent,
      navigateTo,
      handleNavRestore,
      handleNoteListDragStart,
      toggleNoteListCollapse,
      handleToggleEditorMode,
      searchNavigateToNote,
      searchNavigateToTask,
      searchNavigateToTimeline,
      searchNavigateToWhiteboard,
      searchNavigateToIOC,
      searchNavigateToChat,
    ],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
