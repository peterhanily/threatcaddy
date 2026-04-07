import React from 'react';
import { Pin, Trash2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Note } from '../../types';
import { formatDate, truncate, cn } from '../../lib/utils';
import { ClsBadge } from '../Common/ClsBadge';
import { TagPills } from '../Common/TagPills';

interface NoteCardProps {
  note: Note;
  active: boolean;
  onSelect: (id: string) => void;
  onTrash?: (id: string) => void;
  folderColor?: string;
  folderName?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

export const NoteCard = React.memo(function NoteCard({ note, active, onSelect, onTrash, folderColor, folderName, draggable, onDragStart }: NoteCardProps) {
  const { t } = useTranslation('notes');
  const preview = note.content.replace(/[#*`_[\]()>-]/g, '').trim();
  const activeIOCCount = note.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(note.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(note.id); } }}
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-colors cursor-pointer group relative',
        active
          ? 'bg-accent/10 border-accent/30'
          : 'bg-bg-raised border-border-subtle hover:bg-bg-hover hover:border-border-medium'
      )}
      style={folderColor && !active ? { borderLeftColor: folderColor, borderLeftWidth: 3 } : undefined}
    >
      {onTrash && !note.trashed && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrash(note.id); }}
          className="absolute top-2 left-2 p-1 rounded text-red-500 hover:text-red-400 hover:bg-gray-700 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10"
          title={t('card.moveToTrash')}
          aria-label={t('card.moveToTrashAria')}
        >
          <Trash2 size={14} />
        </button>
      )}
      {note.color && (
        <div className="w-full h-0.5 rounded-full mb-2" style={{ backgroundColor: note.color }} />
      )}
      <div className={cn('flex items-start gap-2', onTrash && !note.trashed && 'pl-6')}>
        <h3 className="font-medium text-sm text-gray-200 flex-1 truncate">
          {note.title || t('common:untitled')}
        </h3>
        {note.pinned && <Pin size={12} className="text-yellow-400 shrink-0 mt-0.5" />}
      </div>
      {preview && (
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{truncate(preview, 120)}</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-gray-600">{formatDate(note.updatedAt)}</span>
        {note.createdBy && (
          <span className="text-[10px] text-text-muted/60 truncate max-w-[100px]" title={t('card.createdBy', { name: note.createdBy })}>
            {note.createdBy.startsWith('agent:') ? note.createdBy.slice(6) : note.createdBy}
          </span>
        )}
        {folderName && (
          <span
            className="text-[10px] px-1.5 rounded-full truncate max-w-[80px]"
            style={{ backgroundColor: folderColor ? `${folderColor}20` : 'rgba(107,114,128,0.2)', color: folderColor || '#9ca3af' }}
          >
            {folderName}
          </span>
        )}
        {note.clsLevel && <ClsBadge level={note.clsLevel} />}
        {activeIOCCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-accent/70 bg-accent/10 px-1.5 rounded-full">
            <Search size={9} />
            {activeIOCCount}
          </span>
        )}
        <TagPills tags={note.tags} />
      </div>
    </div>
  );
});
