import { SearchIndex, type SearchPatch } from '../lib/search-index';
import type { SearchQuery } from '../lib/search';

const index = new SearchIndex();
type WorkerMessage = { type: 'patch'; patch: SearchPatch } | { type: 'query'; id: number; revision: number; query: SearchQuery; folderId?: string };
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === 'patch') index.apply(message.patch);
  else self.postMessage({ id: message.id, revision: index.revision, result: index.search(message.query, message.folderId) });
};
