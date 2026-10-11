import type { ChatAttachment } from '../types';
import { clearPending, markPending } from './pending-changes';

export const COMPOSER_LIMITS = { imageCount: 4, imageFileBytes: 5 * 1024 * 1024, imageBytes: 10 * 1024 * 1024,
  allImageCount: 16, allImageBytes: 20 * 1024 * 1024, textChars: 200_000, allTextChars: 1_000_000 } as const;
export interface ComposerDraft { readonly text: string; readonly revision: number; readonly images: ChatAttachment[] }
const EMPTY: ComposerDraft = { text: '', revision: 0, images: [] };
let drafts: ReadonlyMap<string, ComposerDraft> = new Map();
let revision = 0;
const pendingToken = Symbol('unsent chat drafts');
const listeners = new Set<() => void>();
const reservations = new Map<symbol, { scope: string; count: number; bytes: number; abort: () => void }>();
const submissions = new Map<string, symbol>();

/** This module lives only in the current tab's immutable workspace. Drafts are
 * never written to storage, backups or sync. Navigation must not discard them. */
export const getComposerDrafts = () => drafts;
export const getComposerDraft = (scope: string) => drafts.get(scope) ?? EMPTY;
export const hasComposerDrafts = () => drafts.size > 0 || reservations.size > 0 || submissions.size > 0;
export const isComposerSubmitting = (scope: string) => submissions.has(scope);
export function subscribeComposerDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notify() {
  if (hasComposerDrafts()) markPending(pendingToken); else clearPending(pendingToken);
  for (const listener of listeners) listener();
}
/** Submission ownership survives view remount. Discarding unsent draft text is
 * not cancellation of a database write that may already have committed. */
export function beginComposerSubmission(scope: string): symbol | null {
  if (submissions.has(scope)) return null;
  const token = Symbol('chat submission'); submissions.set(scope, token);
  drafts = new Map(drafts); notify(); return token;
}
export function finishComposerSubmission(scope: string, token: symbol): void {
  if (submissions.get(scope) !== token) return;
  submissions.delete(scope); drafts = new Map(drafts); notify();
}
function put(scope: string, draft: ComposerDraft) {
  const next = new Map(drafts);
  if (draft.text || draft.images.length) next.set(scope, draft); else next.delete(scope);
  drafts = next; notify();
}
export function setComposerText(scope: string, text: string): 'length' | 'total' | null {
  if (text.length > COMPOSER_LIMITS.textChars) return 'length';
  const total = [...drafts].reduce((sum, [key, value]) => sum + (key === scope ? 0 : value.text.length), text.length);
  if (total > COMPOSER_LIMITS.allTextChars) return 'total';
  put(scope, { ...getComposerDraft(scope), text, revision: ++revision });
  return null;
}
export function commitComposerText(scope: string, expectedRevision: number): void {
  const current = getComposerDraft(scope);
  if (current.revision === expectedRevision) put(scope, { ...current, text: '', revision: ++revision });
}
export const imageBytes = (image: ChatAttachment) => image.data.length * 3 / 4 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
export type ComposerImageError = 'count' | 'total' | 'global';
function imageCapacity(scope: string, count: number, bytes: number): ComposerImageError | null {
  let scopedCount = count, scopedBytes = bytes, allCount = count, allBytes = bytes;
  for (const [key, draft] of drafts) {
    allCount += draft.images.length; allBytes += draft.images.reduce((sum, image) => sum + imageBytes(image), 0);
    if (key === scope) { scopedCount += draft.images.length; scopedBytes += draft.images.reduce((sum, image) => sum + imageBytes(image), 0); }
  }
  for (const pending of reservations.values()) {
    allCount += pending.count; allBytes += pending.bytes;
    if (pending.scope === scope) { scopedCount += pending.count; scopedBytes += pending.bytes; }
  }
  if (scopedCount > COMPOSER_LIMITS.imageCount) return 'count';
  if (scopedBytes > COMPOSER_LIMITS.imageBytes) return 'total';
  return allCount > COMPOSER_LIMITS.allImageCount || allBytes > COMPOSER_LIMITS.allImageBytes ? 'global' : null;
}
export function reserveComposerImages(owner: symbol, scope: string, count: number, bytes: number, abort: () => void): ComposerImageError | null {
  const error = imageCapacity(scope, count, bytes);
  if (error) return error;
  reservations.set(owner, { scope, count, bytes, abort }); notify(); return null;
}
export function releaseComposerImages(owner: symbol): void { reservations.delete(owner); notify(); }
export function setComposerImages(scope: string, images: ChatAttachment[]): void {
  // All additions are reserved before file I/O; acknowledgement/removal only
  // shrinks the owning thread's array and never borrows another thread's draft.
  put(scope, { ...getComposerDraft(scope), images });
}
export function discardAllComposerDrafts(): void {
  for (const pending of reservations.values()) pending.abort();
  reservations.clear(); drafts = new Map(); ++revision; notify();
}
