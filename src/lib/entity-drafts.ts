import { clearPending, markPending } from './pending-changes';

export type DraftPatch = Record<string, unknown>;
export interface DraftConflict { base: unknown; local: unknown; remote: unknown }
type Persist = (patch: DraftPatch) => void | Promise<void>;
export interface DraftSnapshot {
  patch: DraftPatch;
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  error?: string;
  conflicts?: Record<string, DraftConflict>;
  resolved?: DraftPatch;
  discardVersion?: number;
}

const drafts = new Map<string, EntityDraft>();
let externalDataChange = false;
const recoveryListeners = new Set<() => void>();
let failedDrafts: { key: string; draft: EntityDraft; snapshot: DraftSnapshot }[] = [];

function notifyRecovery() {
  const next = [...drafts].filter(([, draft]) => draft.getSnapshot().status === 'error')
    .map(([key, draft]) => ({ key, draft, snapshot: draft.getSnapshot() }));
  if (next.length === 0 && failedDrafts.length === 0) return;
  failedDrafts = next;
  for (const listener of recoveryListeners) listener();
}

export const getFailedDrafts = () => failedDrafts;
export function subscribeFailedDrafts(listener: () => void) {
  recoveryListeners.add(listener);
  return () => { recoveryListeners.delete(listener); };
}

/**
 * A tab-local draft outlives its editor. It retains failed writes for retry,
 * merges partial edits, and allows only one persistence call per entity at a
 * time. This is not a crash-recovery store and never writes plaintext copies
 * to localStorage/sessionStorage alongside the application's encrypted DB.
 */
export class EntityDraft {
  private snapshot: DraftSnapshot = { patch: {}, status: 'idle' };
  private listeners = new Set<() => void>();
  private token = Symbol('entity draft');
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<boolean>;
  private revision = 0;
  private fields = new Map<string, number>();
  private persist?: Persist;
  private onError?: (message: string) => void;
  private attached = 0;
  private requiresReview = false;

  private readonly key: string;
  constructor(key: string) { this.key = key; }

  getSnapshot = () => this.snapshot;
  hasPendingWork = () => this.fields.size > 0 || !!this.inFlight;
  canDiscard = () => !this.inFlight && !externalDataChange;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: DraftSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
    notifyRecovery();
  }

  attach(persist: Persist, onError?: (message: string) => void) {
    this.persist = persist;
    this.onError = onError;
    this.attached++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.attached--;
      // The callback and entity identity survive unmount until the write settles.
      void this.flush().then(() => this.releaseIfClean());
    };
  }

  private releaseIfClean() {
    if (this.attached === 0 && this.fields.size === 0 && !this.inFlight) {
      if (drafts.get(this.key) === this) drafts.delete(this.key);
      this.persist = undefined;
      this.onError = undefined;
    }
  }

  queue = (updates: DraftPatch, delay = 500) => {
    if (Object.keys(updates).length === 0) return;
    const revision = ++this.revision;
    for (const field of Object.keys(updates)) this.fields.set(field, revision);
    markPending(this.token);
    clearTimeout(this.timer);
    const patch = { ...this.snapshot.patch, ...updates };
    const conflicts = this.snapshot.conflicts && { ...this.snapshot.conflicts };
    for (const field of Object.keys(updates)) {
      if (conflicts?.[field]) conflicts[field] = { ...conflicts[field], local: updates[field] };
    }
    if (externalDataChange || this.requiresReview) {
      this.requiresReview = true;
      this.timer = undefined;
      this.publish({ ...this.snapshot, patch, conflicts, status: 'error', error: conflicts && Object.keys(conflicts).length
        ? 'Local and remote changes overlap. Review each conflicting field before saving.'
        : 'Data was being replaced. Reopen the item and review this draft before retrying.' });
      return;
    }
    this.publish({ patch, status: this.inFlight ? 'saving' : 'dirty' });
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  };

  /** Explicit user retry also acknowledges drafts blocked by external changes. */
  retry = (): Promise<boolean> => {
    if (externalDataChange || Object.keys(this.snapshot.conflicts ?? {}).length) return Promise.resolve(false);
    this.requiresReview = false;
    return this.flush(true);
  };

  /** Conflicting versions belong to the controller, not an editor component. */
  recordConflict = (field: string, conflict: DraftConflict): void => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.requiresReview = true;
    this.fields.set(field, ++this.revision);
    markPending(this.token);
    this.publish({ ...this.snapshot, patch: { ...this.snapshot.patch, [field]: conflict.local },
      conflicts: { ...this.snapshot.conflicts, [field]: conflict }, status: 'error',
      error: 'Local and remote changes overlap. Review each conflicting field before saving.' });
  };

  resolveConflict = (field: string, choice: 'local' | 'remote'): boolean => {
    if (!this.canDiscard()) return false;
    const conflict = this.snapshot.conflicts?.[field];
    if (!conflict) return false;
    const conflicts = { ...this.snapshot.conflicts };
    delete conflicts[field];
    const patch = { ...this.snapshot.patch };
    if (choice === 'remote') {
      delete patch[field];
      this.fields.delete(field);
    } else {
      patch[field] = conflict.local;
      this.fields.set(field, ++this.revision);
    }
    this.requiresReview = Object.keys(conflicts).length > 0;
    this.publish({ patch, ...(this.requiresReview ? { conflicts, error: this.snapshot.error } : {}),
      resolved: { [field]: conflict[choice] }, status: this.requiresReview ? 'error' : this.fields.size ? 'dirty' : 'saved' });
    if (!this.fields.size) clearPending(this.token);
    if (!this.requiresReview) void this.flush();
    this.releaseIfClean();
    return true;
  };

  /** A download is not consent. Call only after an explicit discard confirmation. */
  discard = (confirmed: boolean): boolean => {
    if (!confirmed || !this.canDiscard()) return false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.fields.clear();
    this.requiresReview = false;
    clearPending(this.token);
    this.publish({ patch: {}, status: 'idle', discardVersion: ++this.revision });
    this.releaseIfClean();
    return true;
  };

  flush = (retryErrors = false): Promise<boolean> => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inFlight) return this.inFlight;
    if (this.requiresReview || (!retryErrors && this.snapshot.status === 'error')) return Promise.resolve(false);
    if (this.fields.size === 0) return Promise.resolve(true);

    // Begin on the next microtask so inFlight is installed even for synchronous
    // persistence functions or synchronous exceptions.
    this.inFlight = Promise.resolve().then(async () => {
      while (this.fields.size > 0) {
        if (this.requiresReview) return false;
        const patch = { ...this.snapshot.patch };
        const revision = this.revision;
        const persist = this.persist;
        this.publish({ patch, status: 'saving', ...(this.snapshot.resolved ? { resolved: this.snapshot.resolved } : {}) });
        try {
          if (!persist) throw new Error('The editor is not available to save this draft.');
          await persist(patch);
        } catch (error) {
          clearTimeout(this.timer);
          this.timer = undefined;
          const message = error instanceof Error ? error.message : 'The changes could not be saved.';
          this.publish({ ...this.snapshot, patch: this.snapshot.patch, status: 'error', error: message });
          this.onError?.(message);
          return false;
        }
        const remaining = { ...this.snapshot.patch };
        for (const [field, fieldRevision] of this.fields) {
          if (fieldRevision <= revision) {
            this.fields.delete(field);
            delete remaining[field];
          }
        }
        this.publish(this.requiresReview
          ? { ...this.snapshot, patch: remaining, status: 'error' }
          : { patch: remaining, status: this.fields.size ? 'saving' : 'saved', ...(this.snapshot.resolved ? { resolved: this.snapshot.resolved } : {}) });
      }
      clearPending(this.token);
      return true;
    }).finally(() => {
      this.inFlight = undefined;
      if (this.snapshot.status === 'error') this.publish({ ...this.snapshot });
      this.releaseIfClean();
    });
    return this.inFlight;
  };
}

export function getEntityDraft(key: string): EntityDraft {
  let draft = drafts.get(key);
  if (!draft) {
    draft = new EntityDraft(key);
    drafts.set(key, draft);
  }
  return draft;
}

export function flushEntityDrafts(): Promise<boolean[]> {
  return Promise.all([...drafts.values()].map((draft) => draft.flush()));
}

export function hasPendingEntityDrafts(): boolean {
  return [...drafts.values()].some((draft) => draft.hasPendingWork());
}

/**
 * Drain existing drafts before a restore/import callback. Edits attempted while
 * the callback runs are retained for explicit review and never auto-saved over
 * the replacement data. Callers must reload the application after success only
 * if hasPendingEntityDrafts() is false; otherwise keep recovery UI reachable.
 * This guards these editor queues, not arbitrary database writers or other tabs.
 */
export async function withEntityDraftBarrier<T>(operation: () => Promise<T>): Promise<T> {
  if (externalDataChange) throw new Error('Another data replacement is already in progress.');
  externalDataChange = true;
  try {
    if ((await flushEntityDrafts()).some((saved) => !saved)) {
      throw new Error('Unsaved drafts require review before replacing data. Resolve, retry, or explicitly discard them first.');
    }
    return await operation();
  } finally {
    externalDataChange = false;
  }
}

// These start a best-effort write while the page is still alive. Browser/process
// termination may interrupt IndexedDB; the application's beforeunload warning
// continues to apply for every pending or failed write.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushEntityDrafts(); });
  window.addEventListener('beforeunload', () => { void flushEntityDrafts(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushEntityDrafts();
  });
}
