import { awaitLocalFile, readLocalFile } from './local-file-read';
import { markPending, clearPending } from './pending-changes';

export interface FileOpenDetail {
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

export const FILE_OPEN_LIMITS = { count: 20, bytes: 5 * 1024 * 1024 } as const;
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];
type FileSource = { name?: string; getFile(): Promise<File> };
export interface FileOpenIssue { kind: 'capacity' | 'type' | 'size' | 'read' | 'import'; name?: string; count: number }
type FileConsumer = (detail: FileOpenDetail, signal: AbortSignal) => Promise<void>;

/** Keep only bounded file handles until the unlocked App can accept them.
 * This queue is tab-local, not crash recovery; reopening a file after a reload
 * is a new import. No contents are copied into browser storage while locked. */
export class FileOpenQueue {
  private sources: FileSource[] = [];
  private issues: FileOpenIssue[] = [];
  private owner?: { consume: FileConsumer; report: (issues: FileOpenIssue[]) => void; controller: AbortController };
  private running = false;
  private pendingToken = Symbol('opened files');

  enqueue(source: FileSource): boolean {
    if (this.sources.length >= FILE_OPEN_LIMITS.count) {
      const overflow = this.issues.find(issue => issue.kind === 'capacity');
      if (overflow) overflow.count = Math.min(Number.MAX_SAFE_INTEGER, overflow.count + 1);
      else this.issues.push({ kind: 'capacity', count: 1 });
      void this.drain();
      return false;
    }
    this.sources.push(source);
    markPending(this.pendingToken);
    void this.drain();
    return true;
  }

  subscribe(consume: FileConsumer, report: (issues: FileOpenIssue[]) => void): () => void {
    this.owner?.controller.abort();
    const owner = { consume, report, controller: new AbortController() };
    this.owner = owner;
    queueMicrotask(() => { void this.drain(); });
    return () => {
      owner.controller.abort();
      if (this.owner === owner) this.owner = undefined;
    };
  }

  private async drain(): Promise<void> {
    if (this.running || !this.owner) return;
    this.running = true;
    try {
      while (this.owner) {
        const owner = this.owner;
        if (this.issues.length) {
          const issues = this.issues;
          this.issues = [];
          try { owner.report(issues); }
          catch { this.issues = issues; break; }
        }
        const source = this.sources[0];
        if (!source) break;
        const { signal } = owner.controller;
        let stage: FileOpenIssue['kind'] = 'read';
        let name = source.name;
        try {
          signal.throwIfAborted();
          const file = await awaitLocalFile(source.getFile(), signal);
          signal.throwIfAborted();
          name = file.name;
          if (!isAcceptedFile(file.name)) { stage = 'type'; throw new Error('Unsupported file type'); }
          if (file.size > FILE_OPEN_LIMITS.bytes) { stage = 'size'; throw new Error('File exceeds size limit'); }
          const content = await readLocalFile(file, 'text', signal);
          signal.throwIfAborted();
          stage = 'import';
          // Resolve means the write committed, even if the view then unmounted.
          await owner.consume({ name: file.name, content, size: file.size, lastModified: file.lastModified }, signal);
          this.sources.shift();
        } catch {
          // An unmounted/locked App has not acknowledged this item. Retain the
          // handle for its next owner; never pass a read result to a stale view.
          if (signal.aborted) continue;
          this.sources.shift();
          this.issues.push({ kind: stage, name: name?.slice(0, 512), count: 1 });
        }
      }
    } finally {
      this.running = false;
      if (!this.sources.length) clearPending(this.pendingToken);
    }
  }
}

export const fileOpenQueue = new FileOpenQueue();

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(name: string): boolean {
  return ACCEPTED_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

/** The picker/drop path uses the same readiness, bounds and error reporting. */
export function dispatchFile(file: File): void {
  fileOpenQueue.enqueue({ name: file.name, getFile: async () => file });
}

export function openFilePicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_EXTENSIONS.join(',');
  input.multiple = true;
  input.onchange = () => {
    for (const file of Array.from(input.files ?? [])) dispatchFile(file);
  };
  input.click();
}

export function getDroppedFiles(e: DragEvent): File[] {
  return Array.from(e.dataTransfer?.files ?? []).filter(f => isAcceptedFile(f.name));
}

let installedQueue: LaunchQueue | undefined;
export function installFileHandler(): void {
  if (!window.launchQueue || installedQueue === window.launchQueue) return;
  installedQueue = window.launchQueue;
  window.launchQueue.setConsumer(params => {
    for (const handle of params.files) fileOpenQueue.enqueue(handle);
  });
}
