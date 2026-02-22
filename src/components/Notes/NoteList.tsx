import { ArrowUpDown, FileText } from 'lucide-react';
import type { Note, SortOption } from '../../types';
import { NoteCard } from './NoteCard';

interface NoteListProps {
  notes: Note[];
  selectedId?: string;
  onSelect: (id: string) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  title?: string;
}

export function NoteList({ notes, selectedId, onSelect, sort, onSortChange, title }: NoteListProps) {
  return (
    <div className="w-72 border-r border-gray-800 flex flex-col h-full shrink-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-300">{title || 'Notes'} ({notes.length})</span>
        <div className="relative group">
          <button className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <ArrowUpDown size={14} />
          </button>
          <div className="absolute right-0 top-full mt-1 w-36 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 hidden group-hover:block">
            {([['updatedAt', 'Last Modified'], ['createdAt', 'Created'], ['title', 'Title']] as [SortOption, string][]).map(([value, label]) => (
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

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <FileText size={32} className="mb-2" />
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Press Ctrl+N to create one</p>
          </div>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              active={note.id === selectedId}
              onClick={() => onSelect(note.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
