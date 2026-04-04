import { ArrowUpDown, FileText, Download, FolderPlus } from 'lucide-react';
import type { Note, SortOption, IOCType, Folder } from '../../types';
import { cn } from '../../lib/utils';
import { NoteCard } from './NoteCard';
import { IOCFilterBar } from '../Clips/IOCFilterBar';
import { useState, useRef, useEffect, useMemo } from 'react';
import { formatIOCsJSON, formatIOCsCSV, formatIOCsFlatJSON, formatIOCsFlatCSV } from '../../lib/ioc-export';
import type { IOCExportEntry, ThreatIntelExportConfig } from '../../lib/ioc-export';
import { downloadFile } from '../../lib/export';
import { Virtuoso } from 'react-virtuoso';

interface NoteListProps {
  notes: Note[];
  selectedId?: string;
  onSelect: (id: string) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  title?: string;
  selectedIOCTypes?: IOCType[];
  onIOCTypesChange?: (types: IOCType[]) => void;
  folders?: Folder[];
  tiExportConfig?: ThreatIntelExportConfig;
  onTrash?: (id: string) => void;
  onCreateFolder?: (name: string) => void;
  onMoveToFolder?: (noteId: string, parentNoteId: string | null) => void;
}

export function NoteList({ notes, selectedId, onSelect, sort, onSortChange, title, selectedIOCTypes, onIOCTypesChange, folders, tiExportConfig, onTrash, onCreateFolder, onMoveToFolder }: NoteListProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const notesWithIOCs = useMemo(
    () => notes.filter((n) => n.iocAnalysis && n.iocAnalysis.iocs.some((ioc) => !ioc.dismissed)),
    [notes]
  );

  const folderMap = useMemo(() => {
    const map = new Map<string, Folder>();
    if (folders) {
      for (const f of folders) map.set(f.id, f);
    }
    return map;
  }, [folders]);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  useEffect(() => {
    if (!showSortMenu) return;
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSortMenu]);

  const handleBulkExport = (format: 'json' | 'csv' | 'flat-json' | 'flat-csv') => {
    setShowExportMenu(false);
    const entries: IOCExportEntry[] = notesWithIOCs.map((n) => ({
      clipTitle: n.title,
      sourceUrl: n.sourceUrl,
      iocs: n.iocAnalysis?.iocs ?? [],
      tags: n.tags,
      entityClsLevel: n.clsLevel,
    }));
    const dateStr = new Date().toISOString().slice(0, 10);
    if (format === 'flat-json') {
      downloadFile(formatIOCsFlatJSON(entries, tiExportConfig), `iocs-export-${dateStr}-flat.json`, 'application/json');
    } else if (format === 'flat-csv') {
      downloadFile(formatIOCsFlatCSV(entries, tiExportConfig), `iocs-export-${dateStr}-flat.csv`, 'text/csv');
    } else if (format === 'json') {
      downloadFile(formatIOCsJSON(entries), `iocs-export-${dateStr}.json`, 'application/json');
    } else {
      downloadFile(formatIOCsCSV(entries), `iocs-export-${dateStr}.csv`, 'text/csv');
    }
  };

  return (
    <div className="w-full border-r border-gray-800 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-300">{title || 'Notes'} ({notes.length})</span>
        <div className="flex items-center gap-1">
          {onCreateFolder && (
            <button
              onClick={() => {
                const name = prompt('Folder name:');
                if (name?.trim()) onCreateFolder(name.trim());
              }}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
              title="New folder"
              aria-label="Create note folder"
            >
              <FolderPlus size={14} />
            </button>
          )}
          {notesWithIOCs.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
                title="Download IOCs"
                aria-label="Download IOCs"
              >
                <Download size={14} />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                  <button onClick={() => handleBulkExport('flat-json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-t-lg">Export JSON (flat)</button>
                  <button onClick={() => handleBulkExport('flat-csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Export CSV (flat)</button>
                  <button onClick={() => handleBulkExport('json')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Export JSON (grouped)</button>
                  <button onClick={() => handleBulkExport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-b-lg">Export CSV (grouped)</button>
                </div>
              )}
            </div>
          )}
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
              aria-label="Sort notes"
              title="Sort notes"
            >
              <ArrowUpDown size={14} />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                {([['updatedAt', 'Last Modified'], ['createdAt', 'Created'], ['title', 'Title'], ['iocCount', 'IOC Count']] as [SortOption, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { onSortChange(value); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 ${sort === value ? 'text-accent' : 'text-gray-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(notesWithIOCs.length > 0 || (selectedIOCTypes && selectedIOCTypes.length > 0)) && selectedIOCTypes && onIOCTypesChange && (
        <IOCFilterBar selectedTypes={selectedIOCTypes} onChange={onIOCTypesChange} />
      )}

      <div className="flex-1 overflow-hidden p-2">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <FileText size={32} className="mb-2" />
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Press Ctrl+N to create one</p>
          </div>
        ) : (
          <Virtuoso
            data={(() => {
              // Build display list: top-level notes + expanded folder children
              const topLevel = notes.filter(n => !n.parentNoteId);
              const result: Note[] = [];
              for (const note of topLevel) {
                result.push(note);
                if (note.isFolder && expandedFolders.has(note.id)) {
                  const children = notes.filter(n => n.parentNoteId === note.id);
                  result.push(...children);
                }
              }
              return result;
            })()}
            itemContent={(_index, note) => {
              const folder = note.folderId ? folderMap.get(note.folderId) : undefined;
              const isSubNote = !!note.parentNoteId;
              const childCount = note.isFolder ? notes.filter(n => n.parentNoteId === note.id).length : 0;
              return (
                <div className={cn('pb-1.5', isSubNote && 'ml-4')}>
                  {note.isFolder ? (
                    <div
                      onClick={() => {
                        const next = new Set(expandedFolders);
                        if (next.has(note.id)) next.delete(note.id);
                        else next.add(note.id);
                        setExpandedFolders(next);
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-accent-blue'); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('ring-2', 'ring-accent-blue'); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('ring-2', 'ring-accent-blue');
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if (draggedId && draggedId !== note.id && onMoveToFolder) {
                          onMoveToFolder(draggedId, note.id);
                        }
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer',
                        selectedId === note.id ? 'bg-purple/10 border border-purple/30' : 'hover:bg-bg-hover border border-transparent',
                      )}
                    >
                      <span className="text-text-muted">{expandedFolders.has(note.id) ? '📂' : '📁'}</span>
                      <span className="text-xs font-medium text-text-primary flex-1 truncate">{note.title}</span>
                      <span className="text-[10px] text-text-muted">{childCount}</span>
                      {isSubNote && onMoveToFolder && (
                        <button onClick={(e) => { e.stopPropagation(); onMoveToFolder(note.id, null); }}
                          className="text-[9px] text-text-muted hover:text-text-secondary opacity-0 group-hover:opacity-100" title="Move to top level">↑</button>
                      )}
                    </div>
                  ) : (
                    <NoteCard
                      note={note}
                      active={note.id === selectedId}
                      onSelect={onSelect}
                      onTrash={onTrash}
                      folderColor={folder?.color}
                      folderName={folder?.name}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', note.id)}
                    />
                  )}
                </div>
              );
            }}
          />
        )}
      </div>

    </div>
  );
}
