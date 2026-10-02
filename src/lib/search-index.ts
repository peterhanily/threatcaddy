import MiniSearch from 'minisearch';
import { generateSnippet, parseAdvancedQuery, type SearchQuery, type SearchResult, type SearchResultType, type UnifiedSearchResult } from './search';
import { TIMELINE_EVENT_TYPE_LABELS, type Note, type Task, type TimelineEvent, type Whiteboard, type StandaloneIOC, type ChatThread, type EvidenceItem } from '../types';

export interface SearchSources {
  notes: Note[];
  tasks: Task[];
  clipsFolderId?: string;
  timelineEvents?: TimelineEvent[];
  whiteboards?: Whiteboard[];
  standaloneIOCs?: StandaloneIOC[];
  chatThreads?: ChatThread[];
  evidenceItems?: EvidenceItem[];
}

/** Only searchable text crosses the worker boundary: never image bytes, files,
 * credentials, whiteboard scenes, or chat tool request/response payloads. */
export interface SearchDocument {
  key: string;
  id: string;
  type: SearchResultType;
  title: string;
  content: string;
  tags: string;
  tagList: string[];
  folderId?: string;
  createdAt: number;
  updatedAt: number;
}
export interface SearchPatch { revision: number; upserts: SearchDocument[]; deleted: string[] }
export const SEARCH_TYPES: SearchResultType[] = ['note', 'clip', 'task', 'timeline', 'whiteboard', 'ioc', 'chat', 'evidence'];

type Entity = Note | Task | TimelineEvent | Whiteboard | StandaloneIOC | ChatThread | EvidenceItem;

export class SearchProjection {
  readonly documents = new Map<string, SearchDocument>();
  private cached = new WeakMap<Entity, { type: SearchResultType; document: SearchDocument }>();
  revision = 0;

  update(sources: SearchSources): SearchPatch {
    const seen = new Set<string>();
    const upserts: SearchDocument[] = [];
    const add = (entity: Entity, type: SearchResultType, project: () => { title: string; content: string }) => {
      if (entity.trashed || entity.archived) return;
      const key = `${type}:${entity.id}`;
      seen.add(key);
      const cached = this.cached.get(entity);
      let document = cached?.type === type ? cached.document : undefined;
      if (!document) {
        document = { key, id: entity.id, type, ...project(), tags: entity.tags.join(' '), tagList: [...entity.tags], folderId: entity.folderId, createdAt: entity.createdAt, updatedAt: entity.updatedAt };
        this.cached.set(entity, { type, document });
      }
      const previous = this.documents.get(key);
      if (previous === document || (previous && JSON.stringify(previous) === JSON.stringify(document))) return;
      this.documents.set(key, document);
      upserts.push(document);
    };
    for (const n of sources.notes) add(n, sources.clipsFolderId && n.folderId === sources.clipsFolderId ? 'clip' : 'note', () => ({ title: n.title, content: n.content }));
    for (const t of sources.tasks) add(t, 'task', () => ({ title: t.title, content: t.description || '' }));
    for (const e of sources.timelineEvents || []) add(e, 'timeline', () => ({ title: e.title, content: [e.description, e.source, e.actor, TIMELINE_EVENT_TYPE_LABELS[e.eventType]?.label].filter(Boolean).join(' ') }));
    for (const w of sources.whiteboards || []) add(w, 'whiteboard', () => ({ title: w.name, content: '' }));
    for (const i of sources.standaloneIOCs || []) add(i, 'ioc', () => ({ title: i.value, content: [i.type, i.analystNotes, i.attribution].filter(Boolean).join(' ') }));
    for (const c of sources.chatThreads || []) add(c, 'chat', () => ({ title: c.title, content: c.messages.map(m => m.content).join(' ') }));
    for (const e of sources.evidenceItems || []) add(e, 'evidence', () => ({ title: e.title, content: [e.fileName, e.content, e.imageOcrText, e.imageAnalysis].filter(Boolean).join(' ') }));
    const deleted: string[] = [];
    for (const key of this.documents.keys()) if (!seen.has(key)) { deleted.push(key); this.documents.delete(key); }
    if (upserts.length || deleted.length) this.revision++;
    return { revision: this.revision, upserts, deleted };
  }
}

/** Shared worker/fallback implementation; incremental replacements never rebuild
 * the index or retain full database entities. */
export class SearchIndex {
  readonly documents = new Map<string, SearchDocument>();
  revision = 0;
  private index = new MiniSearch<SearchDocument>({ idField: 'key', fields: ['title', 'content', 'tags'], searchOptions: { prefix: true, fuzzy: false, combineWith: 'AND' } });

  apply(patch: SearchPatch) {
    if (patch.revision < this.revision) return;
    for (const key of patch.deleted) {
      const previous = this.documents.get(key);
      if (previous) this.index.remove(previous);
      this.documents.delete(key);
    }
    for (const document of patch.upserts) {
      const previous = this.documents.get(document.key);
      if (previous) this.index.remove(previous);
      this.index.add(document);
      this.documents.set(document.key, document);
    }
    this.revision = patch.revision;
  }

  search(query: SearchQuery, folderId?: string, allowRegex = true): UnifiedSearchResult {
    if (!query.raw.trim()) return { results: [] };
    if (query.raw.length > 1000) return { results: [], error: 'Query too long' };
    try {
      const hits: { document: SearchDocument; field: string }[] = [];
      const eligible = (d: SearchDocument) => {
        if (folderId && d.folderId !== folderId) return false;
        const date = query.dateFilter;
        return !date || ((date.from === undefined || d[date.field] >= date.from) && (date.to === undefined || d[date.field] <= date.to));
      };
      if (query.mode === 'simple') {
        for (const hit of this.index.search(query.raw)) {
          const document = this.documents.get(String(hit.id));
          if (!document || !eligible(document)) continue;
          hits.push({ document, field: Object.values(hit.match).flat()[0] || 'content' });
        }
      } else {
        // Regex never runs on the UI thread: the worker has a termination deadline.
        if (query.mode === 'regex' && !allowRegex) return { results: [], error: 'Regex search requires a working search worker. Use Simple or Advanced search.' };
        const regex = query.mode === 'regex' ? new RegExp(query.raw, 'i') : undefined;
        const predicate = query.mode === 'advanced' ? parseAdvancedQuery(query.raw) : undefined;
        for (const document of this.documents.values()) {
          if (!eligible(document)) continue;
          if (regex) {
            const field = (['title', 'content', 'tags'] as const).find(f => regex.test(document[f].slice(0, 50_000)));
            if (field) hits.push({ document, field });
          } else if (predicate?.(document)) hits.push({ document, field: 'content' });
        }
      }
      hits.sort((a, b) => SEARCH_TYPES.indexOf(a.document.type) - SEARCH_TYPES.indexOf(b.document.type) || b.document.updatedAt - a.document.updatedAt || a.document.key.localeCompare(b.document.key));
      const results: SearchResult[] = hits.slice(0, 50).map(({ document: d, field }) => ({ id: d.id, type: d.type, title: d.title, snippet: generateSnippet(field === 'title' ? d.title : field === 'tags' ? d.tags : d.content, query.raw, 120), tags: d.tagList, createdAt: d.createdAt, updatedAt: d.updatedAt, matchField: field }));
      return { results };
    } catch (error) { return { results: [], error: error instanceof Error ? error.message : 'Search failed' }; }
  }
}
