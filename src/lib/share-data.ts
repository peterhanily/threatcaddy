import type { InvestigationBundle, SharePayload, ShareScope } from './share';
import {
  sanitizeChatThread, sanitizeFolder, sanitizeNote, sanitizeStandaloneIOC,
  sanitizeTag, sanitizeTask, sanitizeTimeline, sanitizeTimelineEvent, sanitizeWhiteboard,
} from './export';
import type { EntityRecord } from './entity-relations';

export const MAX_SHARE_ENTITIES = 2_000;
export const MAX_SHARE_TEXT_CHARS = 500_000;
const MAX_DATE = 8_640_000_000_000_000;
const scopes: ShareScope[] = ['note', 'task', 'event', 'whiteboard', 'ioc', 'investigation', 'chat'];

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Refuse lossy content shares before the general import sanitizer truncates strings. */
export function validateShareTextLengths(value: unknown, maxChars = MAX_SHARE_TEXT_CHARS): void {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_SHARE_TEXT_CHARS) throw new Error('Invalid share text budget');
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === 'string') {
      if (next.length > maxChars) throw new Error('Share text exceeds the supported field length; shorten the selection or keep the original export file');
    } else if (next && typeof next === 'object' && !seen.has(next)) {
      seen.add(next);
      for (const [key, child] of Object.entries(next)) {
        if (key.length > maxChars) throw new Error('Share field name exceeds the supported length');
        pending.push(child);
      }
    }
  }
}

function entity<T extends { id: string }>(raw: unknown, sanitize: (value: unknown) => T | null): T {
  if (!record(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 256) {
    throw new Error('Invalid share payload: each record needs an ID');
  }
  // Raster file data has its own strict byte budget and is never truncated by its sanitizer.
  validateShareTextLengths(sanitize === sanitizeWhiteboard ? { ...raw, files: undefined } : raw);
  const result = sanitize(raw);
  if (!result) throw new Error('Invalid share payload: invalid record');
  // Date formatters require a representable Date, not merely a finite number.
  const checkDates = (row: object) => {
    for (const [key, value] of Object.entries(row)) {
      if (['createdAt', 'updatedAt', 'trashedAt', 'timestamp', 'timestampEnd', 'completedAt', 'closedAt'].includes(key)
        && typeof value === 'number' && Math.abs(value) > MAX_DATE) {
        throw new Error('Invalid share payload: invalid record timestamp');
      }
    }
  };
  checkDates(result);
  const row = result as unknown as Record<string, unknown>;
  for (const key of ['comments', 'messages']) {
    if (Array.isArray(row[key])) row[key].forEach(checkDates);
  }
  return result;
}

/** Allowlisted content only; backup/restore has a separate, unchanged contract. */
export function sanitizeSharePayload(raw: unknown): SharePayload {
  if (!record(raw)) throw new Error('Invalid share payload: not an object');
  if (raw.v !== 1) throw new Error('Invalid share payload: unsupported version');
  if (typeof raw.s !== 'string' || !scopes.includes(raw.s as ShareScope)) throw new Error('Invalid share payload: invalid scope');
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || Math.abs(raw.t) > MAX_DATE) throw new Error('Invalid share payload: invalid timestamp');
  if (!record(raw.d)) throw new Error('Invalid share payload: missing data');
  let data: SharePayload['d'];
  switch (raw.s) {
    case 'note': data = entity(raw.d, sanitizeNote); break;
    case 'task': data = entity(raw.d, sanitizeTask); break;
    case 'event': data = entity(raw.d, sanitizeTimelineEvent); break;
    case 'whiteboard': data = entity(raw.d, sanitizeWhiteboard); break;
    case 'ioc': data = entity(raw.d, sanitizeStandaloneIOC); break;
    case 'chat': data = entity(raw.d, sanitizeChatThread); break;
    default: {
      const bundle = raw.d;
      let count = 1;
      const rows = <T extends { id: string }>(name: string, sanitize: (value: unknown) => T | null): T[] => {
        const values = bundle[name];
        // Earlier shares may omit optional collections (notably chat threads).
        if (values === undefined) return [];
        if (!Array.isArray(values)) throw new Error('Invalid share collection: ' + name);
        count += values.length;
        if (count > MAX_SHARE_ENTITIES) throw new Error('Share contains too many records');
        const seen = new Set<string>();
        return values.map(value => {
          const row = entity(value, sanitize);
          if (seen.has(row.id)) throw new Error('Duplicate record ID in share: ' + name);
          seen.add(row.id);
          return row;
        });
      };
      const folder = entity(bundle.folder, sanitizeFolder);
      // A content share must not transfer automation, playbooks, or local template bindings.
      folder.agentEnabled = false;
      folder.agentStatus = 'idle';
      delete folder.agentPolicy;
      delete folder.agentThreadId;
      delete folder.agentLastRunAt;
      delete folder.playbookExecution;
      delete folder.noteTemplateIds;
      data = {
        folder, notes: rows('notes', sanitizeNote), tasks: rows('tasks', sanitizeTask),
        events: rows('events', sanitizeTimelineEvent), timelines: rows('timelines', sanitizeTimeline),
        whiteboards: rows('whiteboards', sanitizeWhiteboard), iocs: rows('iocs', sanitizeStandaloneIOC),
        chatThreads: rows('chatThreads', sanitizeChatThread), tags: rows('tags', sanitizeTag),
      };
      for (const row of [...data.notes, ...data.tasks, ...data.events, ...data.whiteboards, ...data.iocs, ...data.chatThreads]) {
        if (row.folderId && row.folderId !== folder.id) throw new Error('Share contains a record from another investigation');
        row.folderId = folder.id;
      }
    }
  }
  return { v: 1, s: raw.s as ShareScope, t: raw.t, d: data };
}

/** Entity-table names are fixed by the scope, never supplied by shared content. */
export function shareCollections(payload: SharePayload): Record<string, EntityRecord[]> {
  if (payload.s === 'investigation') {
    const b = payload.d as InvestigationBundle;
    return {
      folders: [b.folder], notes: b.notes, tasks: b.tasks, timelineEvents: b.events,
      timelines: b.timelines, whiteboards: b.whiteboards, standaloneIOCs: b.iocs,
      chatThreads: b.chatThreads, tags: b.tags,
    } as unknown as Record<string, EntityRecord[]>;
  }
  const tables = { note: 'notes', task: 'tasks', event: 'timelineEvents', whiteboard: 'whiteboards', ioc: 'standaloneIOCs', chat: 'chatThreads' };
  return { [tables[payload.s]]: [payload.d as unknown as EntityRecord] };
}
