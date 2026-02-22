import { useState, useEffect, useRef, useCallback } from 'react';
import { Pin, Archive, Trash2, RotateCcw, Eye, Edit3, Columns, ExternalLink, Palette } from 'lucide-react';
import type { Note, Tag, EditorMode } from '../../types';
import { NOTE_COLORS } from '../../types';
import { MarkdownPreview } from './MarkdownPreview';
import { TagInput } from '../Common/TagInput';
import { wordCount, formatFullDate, cn } from '../../lib/utils';

interface NoteEditorProps {
  note: Note;
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (id: string) => void;
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag>;
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
}

export function NoteEditor({
  note,
  onUpdate,
  onTrash,
  onRestore,
  onTogglePin,
  onToggleArchive,
  allTags,
  onCreateTag,
  editorMode,
  onEditorModeChange,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [showColors, setShowColors] = useState(false);
  const [saved, setSaved] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
  }, [note.id, note.title, note.content]);

  const save = useCallback((updates: Partial<Note>) => {
    onUpdate(note.id, updates);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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

  const stats = wordCount(content);
  const showEditor = editorMode === 'edit' || editorMode === 'split';
  const showPreview = editorMode === 'preview' || editorMode === 'split';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={() => onEditorModeChange('edit')}
          className={cn('p-1.5 rounded', editorMode === 'edit' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Edit mode"
        >
          <Edit3 size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('split')}
          className={cn('p-1.5 rounded', editorMode === 'split' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Split mode"
        >
          <Columns size={16} />
        </button>
        <button
          onClick={() => onEditorModeChange('preview')}
          className={cn('p-1.5 rounded', editorMode === 'preview' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
          title="Preview mode"
        >
          <Eye size={16} />
        </button>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        <button
          onClick={() => onTogglePin(note.id)}
          className={cn('p-1.5 rounded', note.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300')}
          title={note.pinned ? 'Unpin' : 'Pin'}
        >
          <Pin size={16} />
        </button>
        <button
          onClick={() => onToggleArchive(note.id)}
          className={cn('p-1.5 rounded', note.archived ? 'text-accent' : 'text-gray-500 hover:text-gray-300')}
          title={note.archived ? 'Unarchive' : 'Archive'}
        >
          <Archive size={16} />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowColors(!showColors)}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300"
            title="Color"
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
                />
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-xs text-green-400">Saved</span>}
          {note.trashed ? (
            <button
              onClick={() => onRestore(note.id)}
              className="p-1.5 rounded text-gray-500 hover:text-green-400"
              title="Restore"
            >
              <RotateCcw size={16} />
            </button>
          ) : (
            <button
              onClick={() => onTrash(note.id)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400"
              title="Move to trash"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="px-4 pt-3 shrink-0">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full bg-transparent text-xl font-bold text-gray-100 placeholder-gray-600 focus:outline-none"
          placeholder="Note title..."
          readOnly={note.trashed}
        />
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 flex overflow-hidden">
        {showEditor && (
          <div className={cn('flex-1 flex flex-col', showPreview && 'border-r border-gray-800')}>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              className="note-editor flex-1 w-full p-4 bg-transparent text-gray-200 placeholder-gray-600 focus:outline-none text-sm leading-relaxed"
              placeholder="Start writing in markdown..."
              readOnly={note.trashed}
            />
          </div>
        )}
        {showPreview && (
          <div className="flex-1 overflow-y-auto p-4">
            {content ? (
              <MarkdownPreview content={content} />
            ) : (
              <p className="text-gray-600 text-sm italic">Nothing to preview</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-500 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <TagInput
            selectedTags={note.tags}
            allTags={allTags}
            onChange={(tags) => onUpdate(note.id, { tags })}
            onCreateTag={onCreateTag}
          />
        </div>
        {note.sourceUrl && (
          <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-accent hover:text-accent-hover">
            <ExternalLink size={12} />
            <span className="truncate max-w-32">{note.sourceTitle || note.sourceUrl}</span>
          </a>
        )}
        <span>{stats.words} words, {stats.chars} chars</span>
        <span>Created {formatFullDate(note.createdAt)}</span>
        <span>Modified {formatFullDate(note.updatedAt)}</span>
      </div>
    </div>
  );
}
