/**
 * PWA File Handling API consumer.
 *
 * When ThreatCaddy is installed as a PWA and registered as a file handler for
 * .md/.markdown/.txt files, the OS passes opened files through the LaunchQueue.
 * This module reads each file and dispatches a CustomEvent that App.tsx listens
 * for to create a new note with file metadata.
 */

export interface FileOpenDetail {
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

const EVENT_NAME = 'threatcaddy:file-open';

/** Dispatch a file-open event on window so React can pick it up. */
function dispatchFileOpen(detail: FileOpenDetail) {
  window.dispatchEvent(new CustomEvent<FileOpenDetail>(EVENT_NAME, { detail }));
}

/** Format bytes into a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];

/** Check if a file has an accepted extension. */
function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Read a File and dispatch the file-open event. */
export async function dispatchFile(file: File) {
  const content = await file.text();
  dispatchFileOpen({
    name: file.name,
    content,
    size: file.size,
    lastModified: file.lastModified,
  });
}

/** Open a native file picker for markdown/text files and dispatch events for each. */
export function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_EXTENSIONS.join(',');
  input.multiple = true;
  input.onchange = async () => {
    if (!input.files) return;
    for (const file of Array.from(input.files)) {
      await dispatchFile(file);
    }
  };
  input.click();
}

/** Extract accepted files from a DragEvent. Returns empty array if none found. */
export function getDroppedFiles(e: DragEvent): File[] {
  if (!e.dataTransfer?.files.length) return [];
  return Array.from(e.dataTransfer.files).filter((f) => isAcceptedFile(f.name));
}

/**
 * Install the launchQueue consumer. Call once at startup (before React mounts)
 * so file handles are captured even if the app is still loading.
 */
export function installFileHandler() {
  if (!window.launchQueue) return;

  window.launchQueue.setConsumer(async (params) => {
    for (const handle of params.files) {
      try {
        const file = await handle.getFile();
        await dispatchFile(file);
      } catch (err) {
        console.error('Failed to read launched file:', err);
      }
    }
  });
}
