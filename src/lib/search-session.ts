import { SearchIndex, SearchProjection, type SearchSources } from './search-index';
import type { SearchQuery, UnifiedSearchResult } from './search';

/** One session per open overlay. Closed overlays own no worker/index. */
export class SearchSession {
  private projection = new SearchProjection();
  private fallback?: SearchIndex;
  private worker?: Worker;
  private id = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private latest?: { query: SearchQuery; folderId?: string };
  private disposed = false;
  private publish: (result: UnifiedSearchResult) => void;

  constructor(createWorker: () => Worker, publish: (result: UnifiedSearchResult) => void) {
    this.publish = publish;
    try {
      this.worker = createWorker();
      this.worker.onmessage = (event: MessageEvent<{ id: number; revision: number; result: UnifiedSearchResult }>) => {
        if (this.disposed || event.data.id !== this.id || event.data.revision !== this.projection.revision) return;
        clearTimeout(this.timer);
        this.publish(event.data.result);
      };
      this.worker.onerror = this.worker.onmessageerror = () => this.failWorker();
    } catch { this.failWorker(); }
  }

  update(sources: SearchSources) {
    const patch = this.projection.update(sources);
    if (!patch.upserts.length && !patch.deleted.length) return;
    if (this.fallback) this.fallback.apply(patch);
    else try { this.worker?.postMessage({ type: 'patch', patch }); } catch { this.failWorker(); }
  }

  search(query: SearchQuery, folderId?: string) {
    if (this.disposed) return;
    this.latest = { query, folderId };
    clearTimeout(this.timer);
    const id = ++this.id;
    if (!query.raw.trim()) { this.publish({ results: [] }); return; }
    if (this.fallback) { this.publish(this.fallback.search(query, folderId, false)); return; }
    this.timer = setTimeout(() => this.failWorker(), 5_000);
    try { this.worker?.postMessage({ type: 'query', id, revision: this.projection.revision, query, folderId }); }
    catch { this.failWorker(); }
  }

  private failWorker() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    if (!this.fallback) {
      this.fallback = new SearchIndex();
      this.fallback.apply({ revision: this.projection.revision, upserts: [...this.projection.documents.values()], deleted: [] });
    }
    if (this.latest) this.publish(this.fallback.search(this.latest.query, this.latest.folderId, false));
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
  }
}
