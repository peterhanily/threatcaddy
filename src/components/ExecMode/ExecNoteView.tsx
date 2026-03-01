import { useMemo } from 'react';
import { ArrowLeft, Share2 } from 'lucide-react';
import type { Note } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate } from '../../lib/utils';

interface ExecNoteViewProps {
  note: Note;
  allNotes: Note[];
  onBack: () => void;
  onShare?: () => void;
}

export function ExecNoteView({ note, allNotes, onBack, onShare }: ExecNoteViewProps) {
  const wikiLinkTargets = useMemo(
    () => allNotes.map((n) => ({ id: n.id, title: n.title })),
    [allNotes],
  );

  const html = useMemo(
    () => renderMarkdown(note.content, wikiLinkTargets),
    [note.content, wikiLinkTargets],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-text-secondary active:text-text-primary -ml-1">
          <ArrowLeft size={18} />
          <span className="text-sm">Back</span>
        </button>
        {onShare && (
          <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent bg-accent/10 active:bg-accent/20 text-xs font-medium">
            <Share2 size={14} />
            Share
          </button>
        )}
      </div>

      <h2 className="text-lg font-bold text-text-primary">{note.title || 'Untitled'}</h2>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span>Created {formatFullDate(note.createdAt)}</span>
        <span>Updated {formatFullDate(note.updatedAt)}</span>
        {note.clsLevel && <span className="font-semibold text-accent-amber">{note.clsLevel}</span>}
      </div>

      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {note.sourceUrl && (
        <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline truncate">
          {note.sourceUrl}
        </a>
      )}

      {note.iocAnalysis && note.iocAnalysis.iocs.filter((i) => !i.dismissed).length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <p className="text-[10px] font-semibold text-red-400 mb-1">
            {note.iocAnalysis.iocs.filter((i) => !i.dismissed).length} IOC{note.iocAnalysis.iocs.filter((i) => !i.dismissed).length !== 1 ? 's' : ''} detected
          </p>
        </div>
      )}

      <div className="bg-bg-raised rounded-xl p-4 markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
