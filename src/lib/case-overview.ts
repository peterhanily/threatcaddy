/**
 * Pure helpers behind an investigation's Overview. They only arrange the lists the caller passes
 * (already scoped to the investigation and filtered for screenshare); nothing is read from storage.
 */
import type { Folder, Identity, IOCType, Note, StandaloneIOC, Task, TimelineEvent } from '../types';
import { BUILTIN_TYPES, isBuiltinType, type BuiltinType } from './identity-model';
import { isOverdue } from './utils';

type Active = { trashed: boolean; archived: boolean };
const isActive = (row: Active) => !row.trashed && !row.archived;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 } as const;
const dueTime = (task: Task) => {
  const time = task.dueDate ? new Date(task.dueDate).getTime() : NaN;
  return Number.isNaN(time) ? Infinity : time;
};

/** Open tasks: overdue first (longest overdue at the top), then by due date, then by priority. */
export function openTasks(tasks: readonly Task[]): { open: Task[]; overdue: number } {
  const open = tasks.filter(task => isActive(task) && !task.completed && task.status !== 'done');
  const overdue = new Set(open.filter(task => isOverdue(task.dueDate)).map(task => task.id));
  open.sort((a, b) =>
    Number(overdue.has(b.id)) - Number(overdue.has(a.id))
    || dueTime(a) - dueTime(b)
    || (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
    || b.updatedAt - a.updatedAt);
  return { open, overdue: overdue.size };
}

/** Active events, newest first. */
export function latestEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter(isActive).sort((a, b) => b.timestamp - a.timestamp);
}

export type IdentityGroupType = BuiltinType | 'other';
export interface IdentityGroup { type: IdentityGroupType; identities: Identity[] }
const STATUS_ORDER = { compromised: 0, suspicious: 1, contained: 2, cleared: 3 } as const;

/**
 * Active identities grouped by type: the built-in types in their usual order, then every custom
 * type together. Within a group, compromised and suspicious ones come first, then the most recently
 * changed. Only `type`, `status`, `name` and `updatedAt` are read; details are never touched.
 */
export function identityGroups(identities: readonly Identity[]): IdentityGroup[] {
  const groups = new Map<IdentityGroupType, Identity[]>([...BUILTIN_TYPES, 'other' as const].map(type => [type, []]));
  for (const identity of identities) {
    if (isActive(identity)) groups.get(isBuiltinType(identity.type) ? identity.type : 'other')?.push(identity);
  }
  const rank = (identity: Identity) => (identity.status ? STATUS_ORDER[identity.status] : 4);
  return [...groups].filter(([, rows]) => rows.length > 0)
    .map(([type, rows]) => ({ type, identities: rows.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt) }));
}

type WithIOCs = { trashed: boolean; iocAnalysis?: { iocs: ReadonlyArray<{ type: IOCType; value: string; dismissed: boolean }> } };

/**
 * Unique indicators by type, most common first: the count the IOCs view shows for the
 * investigation (indicators found in notes, tasks and events, plus the ones added by hand).
 */
export function iocTypeCounts(
  notes: readonly WithIOCs[], tasks: readonly WithIOCs[], events: readonly WithIOCs[], standalone: readonly StandaloneIOC[],
): { total: number; byType: Array<[IOCType, number]> } {
  const types = new Map<string, IOCType>();
  const add = (type: IOCType, value: string) => types.set(`${type}:${value.toLowerCase()}`, type);
  for (const note of notes) if (!note.trashed) for (const ioc of note.iocAnalysis?.iocs ?? []) if (!ioc.dismissed) add(ioc.type, ioc.value);
  for (const rows of [tasks, events]) for (const row of rows) for (const ioc of row.iocAnalysis?.iocs ?? []) if (!ioc.dismissed) add(ioc.type, ioc.value);
  for (const ioc of standalone) if (isActive(ioc)) add(ioc.type, ioc.value);
  const counts = new Map<IOCType, number>();
  for (const type of types.values()) counts.set(type, (counts.get(type) ?? 0) + 1);
  return { total: types.size, byType: [...counts].sort((a, b) => b[1] - a[1]) };
}

/** Active report drafts and products, most recently changed first. */
export function latestProducts(products: readonly Note[]): Note[] {
  return products.filter(isActive).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** When the investigation or anything in the given lists last changed. */
export function lastChangeAt(folder: Pick<Folder, 'createdAt' | 'updatedAt'>, lists: ReadonlyArray<ReadonlyArray<{ updatedAt?: number }>>): number {
  let latest = folder.updatedAt ?? folder.createdAt;
  for (const rows of lists) for (const row of rows) if (typeof row.updatedAt === 'number' && row.updatedAt > latest) latest = row.updatedAt;
  return latest;
}

export const countActive =(rows: readonly Active[]) => rows.filter(isActive).length;
