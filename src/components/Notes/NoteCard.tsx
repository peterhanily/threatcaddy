import { Pin } from 'lucide-react';
import type { Note } from '../../types';
import { formatDate, truncate, cn } from '../../lib/utils';

interface NoteCardProps {
  note: Note;
  active: boolean;
  onClick: () => void;
}

export function NoteCard({ note, active, onClick }: NoteCardProps) {
  const preview = note.content.replace(/[#*`_\[\]()>-]/g, '').trim();

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-colors',
        active
          ? 'bg-accent/10 border-accent/30'
          : 'bg-gray-800/50 border-gray-800 hover:bg-gray-800 hover:border-gray-700'
      )}
    >
      {note.color && (
        <div className="w-full h-0.5 rounded-full mb-2" style={{ backgroundColor: note.color }} />
      )}
      <div className="flex items-start gap-2">
        <h3 className="font-medium text-sm text-gray-200 flex-1 truncate">
          {note.title || 'Untitled'}
        </h3>
        {note.pinned && <Pin size={12} className="text-yellow-400 shrink-0 mt-0.5" />}
      </div>
      {preview && (
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{truncate(preview, 120)}</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-gray-600">{formatDate(note.updatedAt)}</span>
        {note.tags.length > 0 && (
          <div className="flex gap-1 flex-1 min-w-0 overflow-hidden">
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full truncate">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
