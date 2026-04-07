import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Archive, Trash2, RotateCcw, Eye, Edit3, Columns, ExternalLink, Palette, ArrowLeft, Upload, Briefcase, MessageSquare, Search, Lock, LockOpen, Share2, FileText, Download } from 'lucide-react';
import type { Note, Task, TimelineEvent, Tag, Folder, EditorMode, Settings, NoteAnnotation } from '../../types';
import { NOTE_COLORS } from '../../types';
import { nanoid } from 'nanoid';
import { extractIOCs, mergeIOCAnalysis } from '../../lib/ioc-extractor';
import { mergeText, adjustCursor } from '../../lib/text-merge';
import { markPending, clearPending } from '../../lib/pending-changes';
import { ClsSelect } from '../Common/ClsSelect';
import { MarkdownPreview } from './MarkdownPreview';
import { TagInput } from '../Common/TagInput';
import { IOCPanel } from '../Analysis/IOCPanel';
import { ResizeHandle } from '../Common/ResizeHandle';
import { EntityLinker } from '../Common/EntityLinker';
import { SlashCommandMenu } from './SlashCommandMenu';
import { LinkAutocompleteMenu } from './LinkAutocompleteMenu';
import type { LinkCandidate } from './LinkAutocompleteMenu';
import { SLASH_COMMANDS, getCaretCoordinates } from './slashCommands';
import { useCloudSync } from '../../hooks/useCloudSync';
import { useResizable } from '../../hooks/useResizable';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import { useAutoIOCExtraction } from '../../hooks/useAutoIOCExtraction';
import { wordCount, formatFullDate, formatDate, cn, isSafeUrl } from '../../lib/utils';
import { downloadFile } from '../../lib/export';
import { InlineConflictBanner } from '../Common/InlineConflictBanner';
import type { ConflictInfo } from '../Common/InlineConflictBanner';

interface NoteEditorProps {
  note: Note;
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (id: string) => void;
  allTags: Tag[];
  folders: Folder[];
  onCreateTag: (name: string) => Promise<Tag>;
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  onBack?: () => void;
  clipsFolderId?: string;
  settings?: Settings;
  allNotes?: Note[];
  allTasks?: Task[];
  allTimelineEvents?: TimelineEvent[];
  onNavigateToNote?: (noteId: string) => void;
  onShareLink?: (note: Note) => void;
  onSaveAsTemplate?: (note: Note) => void;
}

export function NoteEditor({
  note,
  onUpdate,
  onTrash,
  onRestore,
  onTogglePin,
  onToggleArchive,
  allTags,
  folders,
  onCreateTag,
  editorMode,
  onEditorModeChange,
  onBack,
  clipsFolderId,
  settings: externalSettings,
  allNotes = [],
  allTasks = [],
  allTimelineEvents = [],
  onNavigateToNote,
  onShareLink,
  onSaveAsTemplate,
}: NoteEditorProps) {
  const { t } = useTranslation('notes');
  const iocCount = note.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [showColors, setShowColors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mergeIndicator, setMergeIndicator] = useState<'merged' | null>(null);
  const [inlineConflict, setInlineConflict] = useState<ConflictInfo | null>(null);
  /** Stashed local content so user can recover it after accepting remote */
  const stashedLocalRef = useRef<string | null>(null);
  const [showIOCPanel, setShowIOCPanel] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMessage, setShareMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [defangPreview, setDefangPreview] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [scrollLocked, setScrollLocked] = useState(true);
  const [showBacklinks, setShowBacklinks] = useState(false);
  const cloud = useCloudSync(externalSettings?.backupDestinations);
  const logActivity = useLogActivity();
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shareMsgTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mergeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const baseContentRef = useRef(note.content);
  const baseTitleRef = useRef(note.title);
  const lastSavedContentRef = useRef(note.content);
  const lastSavedTitleRef = useRef(note.title);
  const prevNoteIdRef = useRef(note.id);
  const localContentRef = useRef(content);
  localContentRef.current = content;
  const localTitleRef = useRef(title);
  localTitleRef.current = title;

  // Line numbers — single string instead of N divs, memoized (used for both editor and preview gutters)
  const lineCount = useMemo(() => (content.match(/\n/g) || []).length + 1, [content]);
  const lineNumberText = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount]);

  // Sync gutter scroll with textarea (proper useEffect, not ref callback)
  useEffect(() => {
    const ta = textareaRef.current;
    const gutter = gutterRef.current;
    if (!ta || !gutter) return;
    const sync = () => { gutter.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashTriggerPos, setSlashTriggerPos] = useState<number | null>(null);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });

  // Link autocomplete menu state
  const linkMenuRef = useRef<HTMLDivElement>(null);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [linkTriggerPos, setLinkTriggerPos] = useState<number | null>(null);
  const [linkFilter, setLinkFilter] = useState('');
  const [linkActiveIndex, setLinkActiveIndex] = useState(0);
  const [linkMenuPosition, setLinkMenuPosition] = useState({ top: 0, left: 0 });

  // Auto-extract IOCs on content changes
  useAutoIOCExtraction({
    entityId: note.id,
    content,
    existingAnalysis: note.iocAnalysis,
    onUpdate: (id, updates) => onUpdate(id, updates),
    enabled: externalSettings?.tiAutoExtractEnabled !== false,
    enabledTypes: externalSettings?.tiEnabledIOCTypes,
    defaultConfidence: externalSettings?.tiDefaultConfidence,
    debounceMs: externalSettings?.tiAutoExtractDebounceMs,
  });

  // Resizable: editor ↔ preview (split mode only)
  const editorPreview = useResizable({ initialRatio: 0.5, minRatio: 0.25, maxRatio: 0.75 });
  // Resizable: editor area ↔ IOC panel
  const editorIOC = useResizable({ initialRatio: 0.75, minRatio: 0.4, maxRatio: 0.85 });

  const save = useCallback((updates: Partial<Note>) => {
    onUpdate(note.id, updates);
    if (updates.content !== undefined) {
      lastSavedContentRef.current = updates.content;
      baseContentRef.current = updates.content;
    }
    if (updates.title !== undefined) {
      lastSavedTitleRef.current = updates.title;
      baseTitleRef.current = updates.title;
    }
    setSaved(true);
    clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSaved(false), 1500);
  }, [note.id, onUpdate]);

  useEffect(() => {
    // Note switched — full reset
    if (note.id !== prevNoteIdRef.current) {
      clearTimeout(saveTimeoutRef.current);
      prevNoteIdRef.current = note.id;
      baseContentRef.current = note.content;
      baseTitleRef.current = note.title;
      lastSavedContentRef.current = note.content;
      lastSavedTitleRef.current = note.title;
      setTitle(note.title);
      setContent(note.content);
      setInlineConflict(null);
      stashedLocalRef.current = null;
      return;
    }

    let contentMerged = false;
    let titleMerged = false;
    const mergedUpdates: Partial<Note> = {};

    // Same note — 3-way merge for content
    if (note.content !== baseContentRef.current) {
      const local = localContentRef.current;
      const hasLocalEdits = local !== baseContentRef.current;
      // Cancel any pending save — its closure has stale pre-merge content
      clearTimeout(saveTimeoutRef.current);

      if (!hasLocalEdits) {
        // No unsaved local edits — accept remote
        setContent(note.content);
      } else {
        // Merge remote changes with local edits
        const result = mergeText(baseContentRef.current, local, note.content);
        if (!result.ok) {
          // Patch conflict — stash local, accept remote, show inline conflict banner
          stashedLocalRef.current = local;
          setContent(note.content);
          setInlineConflict({
            entityId: note.id,
            table: 'notes',
            localContent: local,
            remoteContent: note.content,
          });
        } else if (result.merged !== local) {
          // Successful merge — adjust cursor and auto-save
          const textarea = textareaRef.current;
          if (textarea) {
            const oldCursor = textarea.selectionStart;
            const newCursor = adjustCursor(local, result.merged, oldCursor);
            setContent(result.merged);
            requestAnimationFrame(() => {
              textarea.selectionStart = textarea.selectionEnd = newCursor;
            });
          } else {
            setContent(result.merged);
          }
          mergedUpdates.content = result.merged;
          contentMerged = true;
        }
      }
      baseContentRef.current = note.content;
    }

    // Same note — 3-way merge for title
    if (note.title !== baseTitleRef.current) {
      const localTitle = localTitleRef.current;
      const hasLocalTitleEdits = localTitle !== baseTitleRef.current;
      if (!hasLocalTitleEdits) {
        setTitle(note.title);
      } else {
        const result = mergeText(baseTitleRef.current, localTitle, note.title);
        if (!result.ok) {
          // Patch conflict — accept remote
          setTitle(note.title);
        } else if (result.merged !== localTitle) {
          // Adjust cursor in title input
          const input = titleRef.current;
          if (input) {
            const oldCursor = input.selectionStart ?? localTitle.length;
            const newCursor = adjustCursor(localTitle, result.merged, oldCursor);
            setTitle(result.merged);
            requestAnimationFrame(() => {
              input.selectionStart = input.selectionEnd = newCursor;
            });
          } else {
            setTitle(result.merged);
          }
          mergedUpdates.title = result.merged;
          titleMerged = true;
        }
      }
      baseTitleRef.current = note.title;
    }

    // Auto-save merged result and show indicator
    if (contentMerged || titleMerged) {
      save(mergedUpdates);
      setMergeIndicator('merged');
      clearTimeout(mergeTimeoutRef.current);
      mergeTimeoutRef.current = setTimeout(() => setMergeIndicator(null), 2000);
    }
  }, [note.id, note.title, note.content, save]);

  // Auto-focus title for new/empty notes
  useEffect(() => {
    if (note.content === '' && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); clearPending(); }
      clearTimeout(savedTimeoutRef.current);
      clearTimeout(shareMsgTimeoutRef.current);
      clearTimeout(mergeTimeoutRef.current);
    };
  }, []);

  const scheduleSave = useCallback((updates: Partial<Note>) => {
    clearTimeout(saveTimeoutRef.current);
    markPending();
    saveTimeoutRef.current = setTimeout(() => { clearPending(); save(updates); }, 500);
  }, [save]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    scheduleSave({ title: value });
  };

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    scheduleSave({ content: value });
  }, [scheduleSave]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Link autocomplete menu keyboard navigation
    if (linkMenuOpen && linkCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setLinkActiveIndex(i => Math.min(i + 1, linkCandidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setLinkActiveIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        executeLinkSelection(linkCandidates[linkActiveIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setLinkMenuOpen(false);
        return;
      }
    }

    // Slash command menu keyboard navigation
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashActiveIndex(i => Math.min(i + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashActiveIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        executeSlashCommand(filteredSlashCommands[slashActiveIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

    const textarea = e.currentTarget;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'b') {
      e.preventDefault();
      wrapSelection(textarea, '**', '**');
    }
    if (ctrl && e.key === 'i') {
      e.preventDefault();
      wrapSelection(textarea, '_', '_');
    }
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      wrapSelection(textarea, '[', '](url)');
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.slice(0, start) + '  ' + content.slice(end);
      handleContentChange(newContent);
      setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = start + 2; }, 0);
    }
  };

  const wrapSelection = (textarea: HTMLTextAreaElement, before: string, after: string) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end) || 'text';
    const newContent = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(newContent);
    handleContentChange(newContent);
    setTimeout(() => {
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + selected.length;
      textarea.focus();
    }, 0);
  };

  // Slash commands: filtered list
  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q))
    );
  }, [slashFilter]);

  // Reset active index when filter changes
  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashFilter]);

  // Slash commands: detect "/" trigger
  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    for (let i = cursorPos - 1; i >= Math.max(0, cursorPos - 31); i--) {
      const ch = value[i];
      if (ch === ' ' || ch === '\n') {
        setSlashMenuOpen(false);
        return;
      }
      if (ch === '/') {
        if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
          const filter = value.slice(i + 1, cursorPos);
          setSlashMenuOpen(true);
          setSlashTriggerPos(i);
          setSlashFilter(filter);
          // Update menu position
          if (textareaRef.current) {
            setSlashMenuPosition(getCaretCoordinates(textareaRef.current, i));
          }
          return;
        }
        setSlashMenuOpen(false);
        return;
      }
    }
    setSlashMenuOpen(false);
  }, []);

  // Slash commands: execute selected command
  const executeSlashCommand = useCallback((command: typeof SLASH_COMMANDS[number]) => {
    const textarea = textareaRef.current;
    if (!textarea || slashTriggerPos === null) return;

    const cursor = textarea.selectionStart;
    let insertText = command.insert;

    // Handle dynamic inserts
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (insertText === '__DATE__') {
      insertText = dateStr;
    } else if (insertText === '__DATETIME__') {
      insertText = `${dateStr} ${timeStr} UTC`;
    }

    const newContent = content.slice(0, slashTriggerPos) + insertText + content.slice(cursor);
    handleContentChange(newContent);

    setSlashMenuOpen(false);
    setSlashTriggerPos(null);
    setSlashFilter('');
    setSlashActiveIndex(0);

    // Reposition cursor
    const newCursorPos = slashTriggerPos + insertText.length + (command.cursorOffset ?? 0);
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = newCursorPos;
      textarea.focus();
    }, 0);
  }, [content, slashTriggerPos, handleContentChange]);

  // Slash commands: click-outside to close
  useEffect(() => {
    if (!slashMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setSlashMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [slashMenuOpen]);

  // Link autocomplete: filtered candidates
  const linkCandidates = useMemo<LinkCandidate[]>(() => {
    if (!linkMenuOpen) return [];
    const q = linkFilter.toLowerCase();
    return allNotes
      .filter(n => !n.trashed && n.id !== note.id)
      .filter(n => !q || n.title.toLowerCase().includes(q))
      .sort((a, b) => {
        if (!q) return a.title.localeCompare(b.title);
        const aPrefix = a.title.toLowerCase().startsWith(q);
        const bPrefix = b.title.toLowerCase().startsWith(q);
        if (aPrefix && !bPrefix) return -1;
        if (!aPrefix && bPrefix) return 1;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 20)
      .map(n => ({ id: n.id, title: n.title }));
  }, [linkMenuOpen, linkFilter, allNotes, note.id]);

  // Reset link active index when filter changes
  useEffect(() => {
    setLinkActiveIndex(0);
  }, [linkFilter]);

  // Link autocomplete: detect "[[" trigger
  const detectLinkTrigger = useCallback((value: string, cursorPos: number) => {
    // Count backticks before cursor to detect inline code
    let backtickCount = 0;
    for (let i = 0; i < cursorPos; i++) {
      if (value[i] === '`') backtickCount++;
    }
    // If inside inline code (odd backtick count), skip
    if (backtickCount % 2 === 1) {
      setLinkMenuOpen(false);
      return;
    }

    // Check if inside a code fence
    const beforeCursor = value.slice(0, cursorPos);
    const fenceMatches = beforeCursor.match(/```/g);
    if (fenceMatches && fenceMatches.length % 2 === 1) {
      setLinkMenuOpen(false);
      return;
    }

    // Scan backwards from cursor for [[ — max 100 chars back
    for (let i = cursorPos - 1; i >= Math.max(0, cursorPos - 100); i--) {
      const ch = value[i];
      // Stop on newline
      if (ch === '\n') {
        setLinkMenuOpen(false);
        return;
      }
      // Stop if we hit ]] (already closed)
      if (ch === ']' && i > 0 && value[i - 1] === ']') {
        setLinkMenuOpen(false);
        return;
      }
      // Found [[
      if (ch === '[' && i > 0 && value[i - 1] === '[') {
        const filter = value.slice(i + 1, cursorPos);
        setLinkMenuOpen(true);
        setLinkTriggerPos(i - 1); // position of first [
        setLinkFilter(filter);
        if (textareaRef.current) {
          setLinkMenuPosition(getCaretCoordinates(textareaRef.current, i - 1));
        }
        return;
      }
    }
    setLinkMenuOpen(false);
  }, []);

  // Link autocomplete: execute selection
  const executeLinkSelection = useCallback((candidate: LinkCandidate) => {
    const textarea = textareaRef.current;
    if (!textarea || linkTriggerPos === null) return;

    const cursor = textarea.selectionStart;
    const insertText = `[[${candidate.title}]]`;
    const newContent = content.slice(0, linkTriggerPos) + insertText + content.slice(cursor);
    handleContentChange(newContent);

    setLinkMenuOpen(false);
    setLinkTriggerPos(null);
    setLinkFilter('');
    setLinkActiveIndex(0);

    const newCursorPos = linkTriggerPos + insertText.length;
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = newCursorPos;
      textarea.focus();
    }, 0);
  }, [content, linkTriggerPos, handleContentChange]);

  // Link autocomplete: click-outside to close
  useEffect(() => {
    if (!linkMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (linkMenuRef.current && !linkMenuRef.current.contains(e.target as Node)) {
        setLinkMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [linkMenuOpen]);

  // Show share feedback when cloud sync finishes
  useEffect(() => {
    if (cloud.syncing) return;
    if (cloud.error) {
      setShareMessage({ type: 'error', text: cloud.error });
    } else if (cloud.progress && cloud.progress.toLowerCase().includes('success')) {
      setShareMessage({ type: 'success', text: cloud.progress });
      clearTimeout(shareMsgTimeoutRef.current);
      shareMsgTimeoutRef.current = setTimeout(() => setShareMessage(null), 5000);
    }
  }, [cloud.syncing, cloud.progress, cloud.error]);

  // Scroll sync between editor and preview in split mode
  useEffect(() => {
    if (!scrollLocked || editorMode !== 'split') return;
    const editor = textareaRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    let syncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (syncing) return;
      syncing = true;
      const maxScroll = source.scrollHeight - source.clientHeight;
      const ratio = maxScroll > 0 ? source.scrollTop / maxScroll : 0;
      const targetMax = target.scrollHeight - target.clientHeight;
      target.scrollTop = ratio * targetMax;
      requestAnimationFrame(() => { syncing = false; });
    };

    const onEditorScroll = () => syncScroll(editor, preview);
    const onPreviewScroll = () => syncScroll(preview, editor);

    editor.addEventListener('scroll', onEditorScroll);
    preview.addEventListener('scroll', onPreviewScroll);
    return () => {
      editor.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
    };
  }, [scrollLocked, editorMode]);

  const stats = wordCount(content);
  const showEditor = editorMode === 'edit' || editorMode === 'split';
  const showPreview = editorMode === 'preview' || editorMode === 'split';

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 sm:gap-1 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-gray-800 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label={t('editor.backToListAria')}
            title={t('editor.backToList')}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <button
          onClick={() => onEditorModeChange('edit')}
          className={cn('p-1.5 rounded', editorMode === 'edit' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title={t('editor.editMode')}
          aria-label={t('editor.editMode')}
        >
          <Edit3 size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('split')}
          className={cn('p-1.5 rounded hidden sm:block', editorMode === 'split' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title={t('editor.splitMode')}
          aria-label={t('editor.splitMode')}
        >
          <Columns size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('preview')}
          className={cn('p-1.5 rounded', editorMode === 'preview' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title={t('editor.previewMode')}
          aria-label={t('editor.previewMode')}
        >
          <Eye size={16} />
        </button>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button
          onClick={() => onTogglePin(note.id)}
          className={cn('p-1.5 rounded', note.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300')}
          title={note.pinned ? t('editor.unpin') : t('editor.pin')}
          aria-label={note.pinned ? t('editor.unpinAria') : t('editor.pinAria')}
        >
          <Pin size={16} />
        </button>
        <button
          onClick={() => onToggleArchive(note.id)}
          className={cn('p-1.5 rounded', note.archived ? 'text-accent' : 'text-gray-500 hover:text-gray-300')}
          title={note.archived ? t('editor.unarchive') : t('editor.archive')}
          aria-label={note.archived ? t('editor.unarchiveAria') : t('editor.archiveAria')}
        >
          <Archive size={16} />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowColors(!showColors)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300"
            title={t('editor.color')}
            aria-label={t('editor.colorAria')}
          >
            <Palette size={16} />
          </button>
          {showColors && (
            <div className="absolute top-full left-0 mt-1 p-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 flex gap-1.5">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.value || 'none'}
                  onClick={() => { onUpdate(note.id, { color: c.value }); setShowColors(false); }}
                  className={cn('w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                    note.color === c.value ? 'border-white' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c.value || '#374151' }}
                  title={c.name}
                  aria-label={t('editor.colorOption', { name: c.name })}
                />
              ))}
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-1">
          <Briefcase size={16} className="text-gray-500" />
          <select
            value={note.folderId || ''}
            onChange={(e) => onUpdate(note.id, { folderId: e.target.value || undefined })}
            className="bg-transparent text-xs text-gray-300 border-none focus:outline-none cursor-pointer"
            aria-label={t('editor.assignInvestigation')}
          >
            <option value="">{t('editor.noInvestigation')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <ClsSelect
          value={note.clsLevel}
          onChange={(clsLevel) => onUpdate(note.id, { clsLevel })}
          clsLevels={externalSettings?.tiClsLevels}
        />

        <EntityLinker
          currentEntityId={note.id}
          linkedNoteIds={note.linkedNoteIds || []}
          linkedTaskIds={note.linkedTaskIds || []}
          linkedTimelineEventIds={note.linkedTimelineEventIds || []}
          allNotes={allNotes}
          allTasks={allTasks}
          allTimelineEvents={allTimelineEvents}
          onUpdateLinks={(links) => onUpdate(note.id, links)}
        />

        <button
          onClick={() => {
            if (!showIOCPanel) {
              const fresh = extractIOCs(content);
              const merged = mergeIOCAnalysis(note.iocAnalysis, fresh);
              const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
              onUpdate(note.id, { iocAnalysis: merged, iocTypes });
              logActivity('ioc', 'analyze', `Analyzed IOCs in "${note.title}" (${merged.iocs.length} found)`, note.id, note.title);
            }
            setShowIOCPanel(!showIOCPanel);
          }}
          className={cn('p-1.5 rounded hidden md:flex items-center gap-1', showIOCPanel ? 'bg-gray-700 text-accent' : 'text-gray-500 hover:text-gray-300')}
          title={t('editor.iocAnalysis')}
          aria-label={t('editor.iocAnalysisAria')}
        >
          <Search size={14} />
          {iocCount > 0 && (
            <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">
              {iocCount}
            </span>
          )}
        </button>

        {showPreview && (
          <label className="relative inline-flex items-center cursor-pointer" title={defangPreview ? t('editor.showOriginalIOCs') : t('editor.defangIOCs')}>
            <input type="checkbox" checked={defangPreview} onChange={() => setDefangPreview(!defangPreview)} className="sr-only peer" />
            <div className="w-7 h-4 bg-gray-700 peer-checked:bg-accent/60 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-3" />
            <span className="ml-1.5 text-[10px] text-gray-500 peer-checked:text-accent select-none">{t('editor.defang')}</span>
          </label>
        )}

        <button
          onClick={() => setShowAnnotations(!showAnnotations)}
          className={cn('p-1.5 rounded flex items-center gap-1', showAnnotations ? 'bg-gray-700 text-accent' : 'text-gray-500 hover:text-gray-300')}
          title={t('editor.annotations')}
          aria-label={t('editor.annotationsAria')}
        >
          <MessageSquare size={16} />
          {(note.annotations?.length ?? 0) > 0 && (
            <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">
              {note.annotations?.length}
            </span>
          )}
        </button>

        {onShareLink && (
          <button
            onClick={() => onShareLink(note)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300"
            title={t('editor.shareLink')}
            aria-label={t('editor.shareLinkAria')}
          >
            <Share2 size={16} />
          </button>
        )}

        {onSaveAsTemplate && !note.trashed && (
          <button
            onClick={() => onSaveAsTemplate(note)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300"
            title={t('editor.saveAsTemplate')}
            aria-label={t('editor.saveAsTemplateAria')}
          >
            <FileText size={16} />
          </button>
        )}

        <button
          onClick={() => {
            const mdContent = `# ${note.title || t('common:untitled')}\n\n${note.content}`;
            const safeTitle = (note.title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
            downloadFile(mdContent, `${safeTitle}.md`, 'text/markdown');
          }}
          className="p-1.5 rounded text-gray-500 hover:text-gray-300"
          title={t('editor.downloadMarkdown')}
          aria-label={t('editor.downloadMarkdownAria')}
        >
          <Download size={16} />
        </button>

        {cloud.hasDestinations && (
          <div className="relative">
            <button
              onClick={() => {
                if (cloud.syncing) return;
                if (note.iocAnalysis && iocCount > 0) {
                  setShowShareMenu(!showShareMenu);
                } else {
                  cloud.shareNote(note, clipsFolderId);
                  logActivity('sync', 'share', `Shared note "${note.title}"`, note.id, note.title);
                }
              }}
              disabled={cloud.syncing}
              className="p-1.5 rounded text-gray-500 hover:text-gray-300 disabled:opacity-50"
              title={t('editor.shareToCloud')}
              aria-label={t('editor.shareToCloudAria')}
            >
              <Upload size={16} />
            </button>
            {showShareMenu && (
              <div className="absolute top-full right-0 mt-1 py-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 min-w-40">
                <button
                  onClick={() => { if (cloud.syncing) return; cloud.shareNote(note, clipsFolderId); logActivity('sync', 'share', `Shared note "${note.title}"`, note.id, note.title); setShowShareMenu(false); }}
                  disabled={cloud.syncing}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  {t('editor.shareNote')}
                </button>
                <button
                  onClick={() => { if (cloud.syncing) return; cloud.shareIOCReport(note); logActivity('sync', 'share-ioc-report', `Shared IOC report for "${note.title}"`, note.id, note.title); setShowShareMenu(false); }}
                  disabled={cloud.syncing}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  {t('editor.shareIOCReport')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {shareMessage && (
            <span className={cn('text-xs', shareMessage.type === 'success' ? 'text-green-400' : 'text-red-400')} role="status">
              {shareMessage.text}
            </span>
          )}
          {mergeIndicator === 'merged' && !shareMessage && <span className="text-xs text-blue-400" role="status">{t('editor.merged')}</span>}
          {saved && !shareMessage && !mergeIndicator && <span className="text-xs text-green-400" role="status">{t('editor.saved')}</span>}
          {note.trashed ? (
            <button
              onClick={() => onRestore(note.id)}
              className="p-1.5 rounded text-gray-500 hover:text-green-400"
              title={t('editor.restore')}
              aria-label={t('editor.restoreAria')}
            >
              <RotateCcw size={16} />
            </button>
          ) : (
            <button
              onClick={() => onTrash(note.id)}
              className="p-1.5 rounded text-red-500 hover:text-red-400"
              title={t('editor.moveToTrash')}
              aria-label={t('editor.moveToTrashAria')}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Inline conflict banner — shown when 3-way merge fails */}
      {inlineConflict && (
        <InlineConflictBanner
          conflict={inlineConflict}
          onAcceptTheirs={() => {
            // Already showing remote content — just dismiss
            setInlineConflict(null);
            stashedLocalRef.current = null;
            // Persist by saving
            save({ content });
          }}
          onKeepMine={() => {
            if (stashedLocalRef.current != null) {
              setContent(stashedLocalRef.current);
              save({ content: stashedLocalRef.current });
            }
            setInlineConflict(null);
            stashedLocalRef.current = null;
          }}
          onManualMerge={() => {
            // Insert both versions into the editor with conflict markers
            if (stashedLocalRef.current != null) {
              const merged = `<<<<<<< YOUR VERSION\n${stashedLocalRef.current}\n=======\n${content}\n>>>>>>> REMOTE VERSION`;
              setContent(merged);
            }
            setInlineConflict(null);
            stashedLocalRef.current = null;
          }}
        />
      )}

      {/* Title */}
      <div className="px-2 sm:px-4 pt-2 sm:pt-3 shrink-0">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full bg-transparent text-xl font-bold text-gray-100 placeholder-gray-600 focus:outline-none"
          placeholder={t('editor.titlePlaceholder')}
          readOnly={note.trashed}
          aria-label={t('editor.titleAria')}
        />
      </div>

      {/* Editor / Preview + IOC Panel */}
      <div className="flex-1 flex overflow-hidden" ref={showIOCPanel ? editorIOC.containerRef : undefined}>
        <div
          className="flex overflow-hidden min-w-0"
          ref={editorMode === 'split' ? editorPreview.containerRef : undefined}
          style={showIOCPanel ? { width: `${editorIOC.ratio * 100}%` } : { flex: 1 }}
        >
          {showEditor && (
            <div
              className="relative flex overflow-hidden"
              style={editorMode === 'split' ? { width: `${editorPreview.ratio * 100}%` } : { flex: 1 }}
            >
              {/* Line number gutter — uses CSS counters instead of N divs */}
              <div
                ref={gutterRef}
                className="shrink-0 pt-2 sm:pt-4 pr-2 pl-2 text-right select-none overflow-hidden text-gray-500 font-mono whitespace-pre border-r border-gray-800"
                style={{ minWidth: '2.5rem', fontSize: '12px', lineHeight: 'calc(0.875rem * 1.625)' }}
                aria-hidden="true"
              >{lineNumberText}</div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  handleContentChange(e.target.value);
                  const val = e.target.value;
                  setTimeout(() => {
                    if (textareaRef.current) {
                      const pos = textareaRef.current.selectionStart;
                      detectSlashTrigger(val, pos);
                      detectLinkTrigger(val, pos);
                    }
                  }, 0);
                }}
                onKeyDown={handleEditorKeyDown}
                className="note-editor flex-1 w-full p-2 sm:p-4 pl-1 bg-transparent text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-0 border-none text-sm leading-relaxed"
                placeholder={t('editor.contentPlaceholder')}
                readOnly={note.trashed}
                aria-label={t('editor.contentAria')}
              />
              {slashMenuOpen && filteredSlashCommands.length > 0 && (
                <SlashCommandMenu
                  commands={filteredSlashCommands}
                  activeIndex={slashActiveIndex}
                  position={slashMenuPosition}
                  onSelect={executeSlashCommand}
                  menuRef={slashMenuRef}
                />
              )}
              {linkMenuOpen && linkCandidates.length > 0 && (
                <LinkAutocompleteMenu
                  items={linkCandidates}
                  activeIndex={linkActiveIndex}
                  position={linkMenuPosition}
                  onSelect={executeLinkSelection}
                  menuRef={linkMenuRef}
                />
              )}
            </div>
          )}
          {editorMode === 'split' && (
            <ResizeHandle
              isDragging={editorPreview.isDragging}
              onMouseDown={editorPreview.handleMouseDown}
              lockButton={
                <button
                  onClick={(e) => { e.stopPropagation(); setScrollLocked(!scrollLocked); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-gray-800 border border-gray-600 hover:border-accent/50 text-gray-400 hover:text-gray-200 transition-colors"
                  title={scrollLocked ? t('editor.unlockScroll') : t('editor.lockScroll')}
                  aria-label={scrollLocked ? t('editor.unlockScrollAria') : t('editor.lockScrollAria')}
                >
                  {scrollLocked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
              }
            />
          )}
          {showPreview && (
            <div
              ref={editorMode === 'split' ? previewRef : undefined}
              className="overflow-y-auto p-2 sm:p-4"
              style={editorMode === 'split' ? { width: `${(1 - editorPreview.ratio) * 100}%` } : { flex: 1 }}
            >
              {content ? (
                <MarkdownPreview content={content} defanged={defangPreview} allNotes={allNotes} onNavigateToNote={onNavigateToNote} iocs={note.iocAnalysis?.iocs} />
              ) : (
                <p className="text-gray-600 text-sm italic">{t('editor.nothingToPreview')}</p>
              )}
            </div>
          )}
        </div>
        {showIOCPanel && (
          <>
            <ResizeHandle isDragging={editorIOC.isDragging} onMouseDown={editorIOC.handleMouseDown} />
            <IOCPanel
              item={{ id: note.id, title: note.title, content, sourceUrl: note.sourceUrl, clsLevel: note.clsLevel, iocAnalysis: note.iocAnalysis, iocTypes: note.iocTypes }}
              onUpdate={(id, updates) => onUpdate(id, updates)}
              onClose={() => setShowIOCPanel(false)}
              attributionActors={externalSettings?.attributionActors}
              threatIntelConfig={externalSettings ? {
                clsLevels: externalSettings.tiClsLevels,
                iocSubtypes: externalSettings.tiIocSubtypes,
                relationshipTypes: externalSettings.tiRelationshipTypes,
                iocStatuses: externalSettings.tiIocStatuses,
              } : undefined}
              tiExportConfig={externalSettings ? {
                defaultClsLevel: externalSettings.tiDefaultClsLevel,
                defaultReportSource: externalSettings.tiDefaultReportSource,
              } : undefined}
              onPushIOCs={(entries, slug, typeSlug, exportFilter) => {
                logActivity('ioc', 'push-iocs', `Pushed ${entries.length} IOCs from "${note.title}"`, note.id, note.title);
                return cloud.pushIOCs(entries, slug, typeSlug, externalSettings ? {
                  defaultClsLevel: externalSettings.tiDefaultClsLevel,
                  defaultReportSource: externalSettings.tiDefaultReportSource,
                } : undefined, exportFilter);
              }}
              cloudBackupConfigured={cloud.hasDestinations}
              cloudPushing={cloud.syncing}
              lastPushedAt={note.iocAnalysis?.lastPushedAt}
              onPushComplete={() => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const updated = { ...note.iocAnalysis!, lastPushedAt: Date.now() };
                onUpdate(note.id, { iocAnalysis: updated });
              }}
              style={{ width: `${(1 - editorIOC.ratio) * 100}%` }}
            />
          </>
        )}
      </div>

      {/* Annotations Panel */}
      {showAnnotations && (
        <div className="border-t border-gray-800 shrink-0 max-h-48 overflow-y-auto">
          <div className="px-3 py-2 space-y-2">
            {(note.annotations || []).length === 0 && (
              <p className="text-xs text-gray-600 italic">{t('editor.noAnnotations')}</p>
            )}
            {(note.annotations || []).map((ann) => (
              <div key={ann.id} className="flex items-start gap-2 text-xs">
                <span className="text-gray-300 flex-1">{ann.text}</span>
                <span className="text-gray-600 shrink-0">{formatDate(ann.createdAt)}</span>
                <button
                  onClick={() => {
                    const updated = (note.annotations || []).filter((a) => a.id !== ann.id);
                    onUpdate(note.id, { annotations: updated });
                  }}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                  aria-label={t('editor.deleteAnnotation')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && annotationText.trim()) {
                    const newAnnotation: NoteAnnotation = { id: nanoid(), text: annotationText.trim(), createdAt: Date.now() };
                    onUpdate(note.id, { annotations: [...(note.annotations || []), newAnnotation] });
                    setAnnotationText('');
                  }
                }}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent"
                placeholder={t('editor.addAnnotationPlaceholder')}
              />
              <button
                onClick={() => {
                  if (!annotationText.trim()) return;
                  const newAnnotation: NoteAnnotation = { id: nanoid(), text: annotationText.trim(), createdAt: Date.now() };
                  onUpdate(note.id, { annotations: [...(note.annotations || []), newAnnotation] });
                  setAnnotationText('');
                }}
                disabled={!annotationText.trim()}
                className="px-2 py-1 rounded bg-accent/20 text-accent text-xs hover:bg-accent/30 disabled:opacity-50"
              >
                {t('common:add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backlinks panel */}
      {(() => {
        const backlinks = allNotes.filter(
          (n) => n.id !== note.id && !n.trashed && n.content.includes(`[[${note.title}]]`)
        );
        if (backlinks.length === 0 && !showBacklinks) return null;
        return (
          <div className="border-t border-gray-800 shrink-0">
            <button
              onClick={() => setShowBacklinks(!showBacklinks)}
              className="w-full px-4 py-1.5 flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              <span>{showBacklinks ? '\u25BE' : '\u25B8'}</span>
              <span>{t('editor.backlinks', { count: backlinks.length })}</span>
            </button>
            {showBacklinks && backlinks.length > 0 && (
              <div className="px-4 pb-2 space-y-1">
                {backlinks.map((bl) => (
                  <button
                    key={bl.id}
                    onClick={() => onNavigateToNote?.(bl.id)}
                    className="block w-full text-left text-xs text-accent hover:text-accent-hover hover:bg-gray-800/50 px-2 py-1 rounded truncate"
                  >
                    {bl.title || t('common:untitled')}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Footer */}
      <div className="px-2 sm:px-4 py-1.5 sm:py-2 border-t border-gray-800 flex items-center gap-2 sm:gap-4 text-xs text-gray-500 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <TagInput
            selectedTags={note.tags}
            allTags={allTags}
            onChange={(tags) => onUpdate(note.id, { tags })}
            onCreateTag={onCreateTag}
          />
        </div>
        {isSafeUrl(note.sourceUrl) && (
          <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-accent hover:text-accent-hover">
            <ExternalLink size={12} />
            <span className="truncate max-w-32">{note.sourceTitle || note.sourceUrl}</span>
          </a>
        )}
        <span className="hidden sm:inline">{t('editor.wordsChars', { words: stats.words, chars: stats.chars })}</span>
        <span className="hidden md:inline">{t('editor.created', { date: formatFullDate(note.createdAt) })}</span>
        <span className="hidden md:inline">{t('editor.modified', { date: formatFullDate(note.updatedAt) })}</span>
      </div>
    </div>
  );
}
