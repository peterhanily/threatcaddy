import { useState, useMemo, useCallback, useEffect } from 'react';
import { Book, Search, ArrowLeft, Upload, ChevronRight, Pin, Link2, Tag, FolderOpen } from 'lucide-react';
import { renderMarkdown } from '../../lib/markdown';
import type { Note } from '../../types';

interface WikiViewProps {
  notes: Note[];
  onNoteSelect?: (id: string) => void;
  onImportWiki?: (file: File) => Promise<number>;
}

type WikiSection = 'index' | 'article';

const WIKI_TAG = 'wiki';
const SECTION_TAGS: Record<string, { label: string; order: number }> = {
  'wiki-projects': { label: 'Projects', order: 1 },
  'wiki-categories': { label: 'Categories', order: 2 },
  'wiki-concepts': { label: 'Concepts', order: 3 },
};

export default function WikiView({ notes, onImportWiki }: Omit<WikiViewProps, 'onNoteSelect'>) {
  const [section, setSection] = useState<WikiSection>('index');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState(false);

  // Filter to wiki notes only
  const wikiNotes = useMemo(() =>
    notes.filter(n => n.tags.includes(WIKI_TAG) && !n.trashed && !n.archived),
    [notes]
  );

  // Group by section tag
  const grouped = useMemo(() => {
    const groups: Record<string, Note[]> = {};
    const ungrouped: Note[] = [];

    for (const note of wikiNotes) {
      let placed = false;
      for (const tag of Object.keys(SECTION_TAGS)) {
        if (note.tags.includes(tag)) {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(note);
          placed = true;
          break;
        }
      }
      if (!placed) ungrouped.push(note);
    }

    // Sort groups by order
    const sorted = Object.entries(groups)
      .sort(([a], [b]) => (SECTION_TAGS[a]?.order ?? 99) - (SECTION_TAGS[b]?.order ?? 99));

    return { sections: sorted, ungrouped };
  }, [wikiNotes]);

  // Search filtering
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return wikiNotes;
    const q = searchQuery.toLowerCase();
    return wikiNotes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [wikiNotes, searchQuery]);

  // Currently selected article
  const selectedArticle = useMemo(() =>
    wikiNotes.find(n => n.id === selectedArticleId) ?? null,
    [wikiNotes, selectedArticleId]
  );

  // Backlinks: notes that link to the selected article
  const backlinks = useMemo(() => {
    if (!selectedArticleId) return [];
    return wikiNotes.filter(n =>
      n.id !== selectedArticleId &&
      n.linkedNoteIds?.includes(selectedArticleId)
    );
  }, [wikiNotes, selectedArticleId]);

  // Forward links: notes this article links to
  const forwardLinks = useMemo(() => {
    if (!selectedArticle?.linkedNoteIds?.length) return [];
    return wikiNotes.filter(n => selectedArticle.linkedNoteIds!.includes(n.id));
  }, [wikiNotes, selectedArticle]);

  const navigateToArticle = useCallback((id: string) => {
    setSelectedArticleId(id);
    setSection('article');
  }, []);

  // Handle wikilink clicks in rendered markdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[data-note-id]') as HTMLAnchorElement | null;
      if (link) {
        e.preventDefault();
        const noteId = link.getAttribute('data-note-id');
        if (noteId) navigateToArticle(noteId);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [navigateToArticle]);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportWiki) return;
    setImporting(true);
    try {
      const count = await onImportWiki(file);
      alert(`Imported ${count} wiki articles`);
    } catch (err) {
      alert(`Import failed: ${err}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
        {section === 'article' && (
          <button
            onClick={() => { setSection('index'); setSelectedArticleId(null); }}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <Book size={18} className="text-purple shrink-0" />
        <h2 className="text-sm font-semibold text-text-primary">
          {section === 'index' ? 'Wiki' : selectedArticle?.title ?? 'Article'}
        </h2>
        <span className="text-xs text-text-muted">
          {wikiNotes.length} articles
        </span>
        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setSection('index'); }}
            placeholder="Search wiki..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-secondary border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple/50"
          />
        </div>

        {/* Import button */}
        {onImportWiki && (
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-purple/10 text-purple hover:bg-purple/20 cursor-pointer transition-colors">
            <Upload size={14} />
            {importing ? 'Importing...' : 'Import'}
            <input
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
              disabled={importing}
            />
          </label>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {section === 'index' ? (
          <WikiIndex
            grouped={grouped}
            filteredNotes={searchQuery ? filteredNotes : null}
            searchQuery={searchQuery}
            onSelectArticle={navigateToArticle}
            pinnedNotes={wikiNotes.filter(n => n.pinned)}
          />
        ) : selectedArticle ? (
          <WikiArticle
            article={selectedArticle}
            backlinks={backlinks}
            forwardLinks={forwardLinks}
            allNotes={wikiNotes}
            onNavigate={navigateToArticle}
          />
        ) : (
          <div className="p-8 text-center text-text-muted text-sm">
            Article not found
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Index View ---- */

function WikiIndex({
  grouped,
  filteredNotes,
  searchQuery,
  onSelectArticle,
  pinnedNotes,
}: {
  grouped: { sections: [string, Note[]][]; ungrouped: Note[] };
  filteredNotes: Note[] | null;
  searchQuery: string;
  onSelectArticle: (id: string) => void;
  pinnedNotes: Note[];
}) {
  // If searching, show flat filtered list
  if (filteredNotes) {
    return (
      <div className="p-4 space-y-1">
        <p className="text-xs text-text-muted mb-3">
          {filteredNotes.length} result{filteredNotes.length !== 1 ? 's' : ''} for "{searchQuery}"
        </p>
        {filteredNotes.map(note => (
          <ArticleRow key={note.id} note={note} onClick={() => onSelectArticle(note.id)} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Pinned / Index */}
      {pinnedNotes.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            <Pin size={12} />
            Pinned
          </div>
          <div className="space-y-1">
            {pinnedNotes.map(note => (
              <ArticleRow key={note.id} note={note} onClick={() => onSelectArticle(note.id)} highlight />
            ))}
          </div>
        </div>
      )}

      {/* Grouped sections */}
      {grouped.sections.map(([tag, sectionNotes]) => (
        <div key={tag}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            <FolderOpen size={12} />
            {SECTION_TAGS[tag]?.label ?? tag}
            <span className="text-text-muted font-normal">({sectionNotes.length})</span>
          </div>
          <div className="space-y-1">
            {sectionNotes
              .sort((a, b) => a.title.localeCompare(b.title))
              .map(note => (
                <ArticleRow key={note.id} note={note} onClick={() => onSelectArticle(note.id)} />
              ))}
          </div>
        </div>
      ))}

      {/* Ungrouped */}
      {grouped.ungrouped.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            <FolderOpen size={12} />
            Other
            <span className="text-text-muted font-normal">({grouped.ungrouped.length})</span>
          </div>
          <div className="space-y-1">
            {grouped.ungrouped
              .sort((a, b) => a.title.localeCompare(b.title))
              .map(note => (
                <ArticleRow key={note.id} note={note} onClick={() => onSelectArticle(note.id)} />
              ))}
          </div>
        </div>
      )}

      {grouped.sections.length === 0 && grouped.ungrouped.length === 0 && pinnedNotes.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <Book size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No wiki articles yet</p>
          <p className="text-xs mt-1">Import a wiki JSON to get started</p>
        </div>
      )}
    </div>
  );
}

/* ---- Article Row ---- */

function ArticleRow({ note, onClick, highlight }: { note: Note; onClick: () => void; highlight?: boolean }) {
  const preview = note.content.replace(/[#*[\]_`]/g, '').slice(0, 100);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg transition-colors group flex items-center gap-2 ${
        highlight
          ? 'bg-purple/5 hover:bg-purple/10 border border-purple/20'
          : 'hover:bg-surface-hover'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary font-medium truncate">{note.title}</div>
        <div className="text-xs text-text-muted truncate mt-0.5">{preview}</div>
      </div>
      <ChevronRight size={14} className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0" />
    </button>
  );
}

/* ---- Article View ---- */

function WikiArticle({
  article,
  backlinks,
  forwardLinks,
  allNotes,
  onNavigate,
}: {
  article: Note;
  backlinks: Note[];
  forwardLinks: Note[];
  allNotes: Note[];
  onNavigate: (id: string) => void;
}) {
  // Render markdown with wikilink resolution
  const html = useMemo(() => {
    return renderMarkdown(article.content, allNotes);
  }, [article.content, allNotes]);

  return (
    <div className="flex gap-0 h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl">
        {/* Tags */}
        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {article.tags.filter(t => t !== 'wiki').map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-surface-secondary border border-border-subtle text-text-muted"
              >
                <Tag size={10} />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Rendered markdown */}
        <div
          className="prose prose-invert prose-sm max-w-none
            prose-headings:text-text-primary prose-p:text-text-secondary
            prose-a:text-purple prose-a:no-underline hover:prose-a:underline
            prose-code:text-accent prose-code:bg-surface-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded
            prose-pre:bg-surface-secondary prose-pre:border prose-pre:border-border-subtle
            prose-table:border-collapse prose-th:border prose-th:border-border-subtle prose-th:px-3 prose-th:py-1.5
            prose-td:border prose-td:border-border-subtle prose-td:px-3 prose-td:py-1.5
            prose-strong:text-text-primary prose-em:text-text-secondary
            prose-li:text-text-secondary prose-blockquote:border-purple/30"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {/* Sidebar: Links */}
      {(forwardLinks.length > 0 || backlinks.length > 0) && (
        <div className="w-56 shrink-0 border-l border-border-subtle overflow-y-auto p-3 space-y-4">
          {forwardLinks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                <Link2 size={11} />
                Links ({forwardLinks.length})
              </div>
              <div className="space-y-0.5">
                {forwardLinks.map(n => (
                  <button
                    key={n.id}
                    onClick={() => onNavigate(n.id)}
                    className="w-full text-left px-2 py-1 rounded text-xs text-purple hover:bg-surface-hover truncate transition-colors"
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {backlinks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                <ArrowLeft size={11} />
                Backlinks ({backlinks.length})
              </div>
              <div className="space-y-0.5">
                {backlinks.map(n => (
                  <button
                    key={n.id}
                    onClick={() => onNavigate(n.id)}
                    className="w-full text-left px-2 py-1 rounded text-xs text-text-secondary hover:bg-surface-hover truncate transition-colors"
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
