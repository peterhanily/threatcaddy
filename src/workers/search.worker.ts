import { unifiedSearch } from '../lib/search';
import type { Note, Task, TimelineEvent, Whiteboard } from '../types';
import type { SearchQuery } from '../lib/search';

interface SearchRequest {
  id: number;
  notes: Note[];
  tasks: Task[];
  clipsFolderId: string | undefined;
  query: SearchQuery;
  timelineEvents?: TimelineEvent[];
  whiteboards?: Whiteboard[];
}

self.onmessage = (e: MessageEvent<SearchRequest>) => {
  const { id, notes, tasks, clipsFolderId, query, timelineEvents, whiteboards } = e.data;
  const result = unifiedSearch(notes, tasks, clipsFolderId, query, timelineEvents, whiteboards);
  self.postMessage({ id, result });
};
