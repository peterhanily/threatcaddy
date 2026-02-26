import { useState, useEffect, useRef, useCallback } from 'react';
import { Pin, Archive, Trash2, RotateCcw, Eye, Edit3, Columns, ExternalLink, Palette, ArrowLeft, Shield, Upload, FolderOpen } from 'lucide-react';
import type { Note, Task, TimelineEvent, Tag, Folder, EditorMode, Settings } from '../../types';
import { NOTE_COLORS } from '../../types';
import { extractIOCs, mergeIOCAnalysis } from '../../lib/ioc-extractor';
import { getEffectiveClsLevels } from '../../lib/classification';
import { MarkdownPreview } from './MarkdownPreview';
import { TagInput } from '../Common/TagInput';
import { IOCPanel } from '../Analysis/IOCPanel';
import { ResizeHandle } from '../Common/ResizeHandle';
import { EntityLinker } from '../Common/EntityLinker';
import { useOCISync } from '../../hooks/useOCISync';
import { useResizable } from '../../hooks/useResizable';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import { useAutoIOCExtraction } from '../../hooks/useAutoIOCExtraction';
import { wordCount, formatFullDate, cn, isSafeUrl } from '../../lib/utils';

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
}: NoteEditorProps) {
  const iocCount = note.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [showColors, setShowColors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showIOCPanel, setShowIOCPanel] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMessage, setShareMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const oci = useOCISync();
  const logActivity = useLogActivity();
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shareMsgTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-extract IOCs on content changes
  useAutoIOCExtraction({
    entityId: note.id,
    content,
    existingAnalysis: note.iocAnalysis,
    onUpdate: (id, updates) => onUpdate(id, updates),
  });

  // Resizable: editor ↔ preview (split mode only)
  const editorPreview = useResizable({ initialRatio: 0.5, minRatio: 0.25, maxRatio: 0.75 });
  // Resizable: editor area ↔ IOC panel
  const editorIOC = useResizable({ initialRatio: 0.75, minRatio: 0.4, maxRatio: 0.85 });

  useEffect(() => {
    clearTimeout(saveTimeoutRef.current);
    setTitle(note.title);
    setContent(note.content);
  }, [note.id, note.title, note.content]);

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
      clearTimeout(saveTimeoutRef.current);
      clearTimeout(savedTimeoutRef.current);
      clearTimeout(shareMsgTimeoutRef.current);
    };
  }, []);

  const save = useCallback((updates: Partial<Note>) => {
    onUpdate(note.id, updates);
    setSaved(true);
    clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSaved(false), 1500);
  }, [note.id, onUpdate]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => save({ title: value }), 500);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => save({ content: value }), 500);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      setContent(newContent);
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

  // Show share feedback when oci finishes
  useEffect(() => {
    if (oci.syncing) return;
    if (oci.error) {
      setShareMessage({ type: 'error', text: oci.error });
    } else if (oci.progress && oci.progress.toLowerCase().includes('success')) {
      setShareMessage({ type: 'success', text: oci.progress });
      clearTimeout(shareMsgTimeoutRef.current);
      shareMsgTimeoutRef.current = setTimeout(() => setShareMessage(null), 5000);
    }
  }, [oci.syncing, oci.progress, oci.error]);

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
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 md:hidden"
            aria-label="Back to notes list"
            title="Back to list"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <button
          onClick={() => onEditorModeChange('edit')}
          className={cn('p-1.5 rounded', editorMode === 'edit' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Edit mode"
          aria-label="Edit mode"
        >
          <Edit3 size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('split')}
          className={cn('p-1.5 rounded hidden sm:block', editorMode === 'split' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Split mode"
          aria-label="Split mode"
        >
          <Columns size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('preview')}
          className={cn('p-1.5 rounded', editorMode === 'preview' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Preview mode"
          aria-label="Preview mode"
        >
          <Eye size={16} />
        </button>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button
          onClick={() => onTogglePin(note.id)}
          className={cn('p-1.5 rounded', note.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300')}
          title={note.pinned ? 'Unpin' : 'Pin'}
          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
        >
          <Pin size={16} />
        </button>
        <button
          onClick={() => onToggleArchive(note.id)}
          className={cn('p-1.5 rounded', note.archived ? 'text-accent' : 'text-gray-500 hover:text-gray-300')}
          title={note.archived ? 'Unarchive' : 'Archive'}
          aria-label={note.archived ? 'Unarchive note' : 'Archive note'}
        >
          <Archive size={16} />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowColors(!showColors)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300"
            title="Color"
            aria-label="Set note color"
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
                  aria-label={`Color: ${c.name}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <FolderOpen size={16} className="text-gray-500" />
          <select
            value={note.folderId || ''}
            onChange={(e) => onUpdate(note.id, { folderId: e.target.value || undefined })}
            className="bg-transparent text-xs text-gray-300 border-none focus:outline-none cursor-pointer"
            aria-label="Move to folder"
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

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
          title="IOC Analysis"
          aria-label="Toggle IOC analysis panel"
        >
          <Shield size={16} />
          {iocCount > 0 && (
            <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">
              {iocCount}
            </span>
          )}
        </button>

        {externalSettings?.ociWritePAR && (
          <div className="relative">
            <button
              onClick={() => {
                if (oci.syncing) return;
                if (note.iocAnalysis && iocCount > 0) {
                  setShowShareMenu(!showShareMenu);
                } else {
                  oci.shareNote(note, clipsFolderId);
                  logActivity('sync', 'share', `Shared note "${note.title}"`, note.id, note.title);
                }
              }}
              disabled={oci.syncing}
              className="p-1.5 rounded text-gray-500 hover:text-gray-300 disabled:opacity-50"
              title="Share to OCI"
              aria-label="Share to OCI Object Storage"
            >
              <Upload size={16} />
            </button>
            {showShareMenu && (
              <div className="absolute top-full right-0 mt-1 py-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 min-w-40">
                <button
                  onClick={() => { if (oci.syncing) return; oci.shareNote(note, clipsFolderId); logActivity('sync', 'share', `Shared note "${note.title}"`, note.id, note.title); setShowShareMenu(false); }}
                  disabled={oci.syncing}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  Share Note
                </button>
                <button
                  onClick={() => { if (oci.syncing) return; oci.shareIOCReport(note); logActivity('sync', 'share-ioc-report', `Shared IOC report for "${note.title}"`, note.id, note.title); setShowShareMenu(false); }}
                  disabled={oci.syncing}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  Share IOC Report
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
          {saved && !shareMessage && <span className="text-xs text-green-400" role="status">Saved</span>}
          {note.trashed ? (
            <button
              onClick={() => onRestore(note.id)}
              className="p-1.5 rounded text-gray-500 hover:text-green-400"
              title="Restore"
              aria-label="Restore note from trash"
            >
              <RotateCcw size={16} />
            </button>
          ) : (
            <button
              onClick={() => onTrash(note.id)}
              className="p-1.5 rounded text-red-500 hover:text-red-400"
              title="Move to trash"
              aria-label="Move note to trash"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="px-2 sm:px-4 pt-2 sm:pt-3 shrink-0">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full bg-transparent text-xl font-bold text-gray-100 placeholder-gray-600 focus:outline-none"
          placeholder="Note title..."
          readOnly={note.trashed}
          aria-label="Note title"
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
              className="flex flex-col overflow-hidden"
              style={editorMode === 'split' ? { width: `${editorPreview.ratio * 100}%` } : { flex: 1 }}
            >
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                className="note-editor flex-1 w-full p-2 sm:p-4 bg-transparent text-gray-200 placeholder-gray-600 focus:outline-none text-sm leading-relaxed"
                placeholder="Start writing in markdown..."
                readOnly={note.trashed}
                aria-label="Note content editor"
              />
            </div>
          )}
          {editorMode === 'split' && (
            <ResizeHandle isDragging={editorPreview.isDragging} onMouseDown={editorPreview.handleMouseDown} />
          )}
          {showPreview && (
            <div
              className="overflow-y-auto p-2 sm:p-4"
              style={editorMode === 'split' ? { width: `${(1 - editorPreview.ratio) * 100}%` } : { flex: 1 }}
            >
              {content ? (
                <MarkdownPreview content={content} />
              ) : (
                <p className="text-gray-600 text-sm italic">Nothing to preview</p>
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
              onPushIOCs={(entries, slug, typeSlug) => {
                logActivity('ioc', 'push-iocs', `Pushed ${entries.length} IOCs from "${note.title}"`, note.id, note.title);
                return oci.pushIOCs(entries, slug, typeSlug, externalSettings ? {
                  defaultClsLevel: externalSettings.tiDefaultClsLevel,
                  defaultReportSource: externalSettings.tiDefaultReportSource,
                } : undefined);
              }}
              ociWritePARConfigured={!!externalSettings?.ociWritePAR}
              ociPushing={oci.syncing}
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

      {/* Footer */}
      <div className="px-2 sm:px-4 py-1.5 sm:py-2 border-t border-gray-800 flex items-center gap-2 sm:gap-4 text-xs text-gray-500 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <TagInput
            selectedTags={note.tags}
            allTags={allTags}
            onChange={(tags) => onUpdate(note.id, { tags })}
            onCreateTag={onCreateTag}
          />
          <select
            value={note.clsLevel || ''}
            onChange={(e) => onUpdate(note.id, { clsLevel: e.target.value || undefined })}
            className="bg-transparent text-xs text-gray-300 border border-gray-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-accent cursor-pointer"
            aria-label="Classification level"
          >
            <option value="">No classification</option>
            {getEffectiveClsLevels(externalSettings?.tiClsLevels).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        {isSafeUrl(note.sourceUrl) && (
          <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-accent hover:text-accent-hover">
            <ExternalLink size={12} />
            <span className="truncate max-w-32">{note.sourceTitle || note.sourceUrl}</span>
          </a>
        )}
        <span className="hidden sm:inline">{stats.words} words, {stats.chars} chars</span>
        <span className="hidden md:inline">Created {formatFullDate(note.createdAt)}</span>
        <span className="hidden md:inline">Modified {formatFullDate(note.updatedAt)}</span>
      </div>
    </div>
  );
}
