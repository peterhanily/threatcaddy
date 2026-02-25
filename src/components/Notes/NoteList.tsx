import { ArrowUpDown, FileText, Trash2, Download } from 'lucide-react';
import type { Note, SortOption, IOCType, Folder } from '../../types';
import { NoteCard } from './NoteCard';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { IOCFilterBar } from '../Clips/IOCFilterBar';
import { useState, useRef, useEffect, useMemo } from 'react';
import { formatIOCsJSON, formatIOCsCSV, formatIOCsFlatJSON, formatIOCsFlatCSV } from '../../lib/ioc-export';
import type { IOCExportEntry, ThreatIntelExportConfig } from '../../lib/ioc-export';
import { downloadFile } from '../../lib/export';

interface NoteListProps {
  notes: Note[];
  selectedId?: string;
  onSelect: (id: string) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  title?: string;
  showTrash?: boolean;
  onEmptyTrash?: () => void;
  selectedIOCTypes?: IOCType[];
  onIOCTypesChange?: (types: IOCType[]) => void;
  folders?: Folder[];
  tiExportConfig?: ThreatIntelExportConfig;
  onTrash?: (id: string) => void;
}

export function NoteList({ notes, selectedId, onSelect, sort, onSortChange, title, showTrash, onEmptyTrash, selectedIOCTypes, onIOCTypesChange, folders, tiExportConfig, onTrash }: NoteListProps) {
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const notesWithIOCs = notes.filter((n) => n.iocAnalysis && n.iocAnalysis.iocs.some((ioc) => !ioc.dismissed));

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

  const handleBulkExport = (format: 'json' | 'csv' | 'flat-json' | 'flat-csv') => {
    setShowExportMenu(false);
    const entries: IOCExportEntry[] = notesWithIOCs.map((n) => ({
      clipTitle: n.title,
      sourceUrl: n.sourceUrl,
      iocs: n.iocAnalysis?.iocs ?? [],
      tags: n.tags,
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
          {showTrash && notes.length > 0 && (
            <button
              onClick={() => setConfirmEmptyTrash(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-gray-800 hover:text-red-300 transition-colors"
              aria-label="Empty trash"
              title="Empty trash"
            >
              <Trash2 size={12} />
              <span className="hidden sm:inline">Empty</span>
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
          <div className="relative group">
            <button className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300" aria-label="Sort notes" title="Sort notes">
              <ArrowUpDown size={14} />
            </button>
            <div className="absolute right-0 top-full mt-1 w-36 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 hidden group-hover:block">
              {([['updatedAt', 'Last Modified'], ['createdAt', 'Created'], ['title', 'Title'], ['iocCount', 'IOC Count']] as [SortOption, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onSortChange(value)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 ${sort === value ? 'text-accent' : 'text-gray-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {notesWithIOCs.length > 0 && selectedIOCTypes && onIOCTypesChange && (
        <IOCFilterBar selectedTypes={selectedIOCTypes} onChange={onIOCTypesChange} />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <FileText size={32} className="mb-2" />
            <p className="text-sm">{showTrash ? 'Trash is empty' : 'No notes yet'}</p>
            {!showTrash && <p className="text-xs mt-1">Press Ctrl+N to create one</p>}
          </div>
        ) : (
          notes.map((note) => {
            const folder = note.folderId ? folderMap.get(note.folderId) : undefined;
            return (
              <NoteCard
                key={note.id}
                note={note}
                active={note.id === selectedId}
                onClick={() => onSelect(note.id)}
                onTrash={onTrash}
                folderColor={folder?.color}
                folderName={folder?.name}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', note.id)}
              />
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={confirmEmptyTrash}
        onClose={() => setConfirmEmptyTrash(false)}
        onConfirm={() => { onEmptyTrash?.(); setConfirmEmptyTrash(false); }}
        title="Empty Trash"
        message="All notes in trash will be permanently deleted. This cannot be undone."
        confirmLabel="Empty Trash"
        danger
      />
    </div>
  );
}
