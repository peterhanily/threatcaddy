import EvidenceWorker from '../workers/evidence-import.worker?worker';
import type { EvidenceDraftOptions, EvidenceFileSource, EvidenceItemDraft } from './evidence-import';
import { MAX_EVIDENCE_IMPORT_FILES } from './evidence-import-constants';
import {
  assertEvidenceInput, EVIDENCE_LIMITS, EvidenceImportError, EvidenceImportLimitError, isEvidenceImportErrorCode, type EvidenceImportErrorCode,
} from './evidence-import-limits';

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Evidence import cancelled.', 'AbortError');
}

function parseDocument(file: File, options: EvidenceDraftOptions, signal: AbortSignal): Promise<EvidenceItemDraft[]> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new EvidenceWorker(); }
    catch { reject(new EvidenceImportError('workerUnavailable')); return; }
    let finished = false;
    const deadline = Date.now() + EVIDENCE_LIMITS.documentTimeoutMs;
    const finish = (error?: unknown, drafts?: EvidenceItemDraft[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error !== undefined) reject(error); else resolve(drafts ?? []);
    };
    const abort = () => finish(abortReason(signal));
    // Every per-document failure names the file; the batch is still atomic.
    const fail = (code: EvidenceImportErrorCode, message?: string) => finish(new EvidenceImportError(code, { fileName: file.name, message }));
    const timer = setTimeout(() => fail('documentTimeout'), EVIDENCE_LIMITS.documentTimeoutMs);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; drafts?: EvidenceItemDraft[]; code?: unknown; error?: string }>) => {
      if (signal.aborted) { abort(); return; }
      if (Date.now() >= deadline) { fail('documentTimeout'); return; }
      if (event.data?.ok === true && Array.isArray(event.data.drafts)) finish(undefined, event.data.drafts);
      else fail(isEvidenceImportErrorCode(event.data?.code) ? event.data.code : 'extractionFailed', event.data?.error);
    };
    worker.onerror = event => { event.preventDefault(); fail('workerFailed'); };
    worker.onmessageerror = () => fail('workerFailed', 'Evidence worker response could not be read. No files were imported.');
    signal.addEventListener('abort', abort, { once: true });
    // A signal may already have changed while the worker was being constructed.
    if (signal.aborted) { abort(); return; }
    // WebKit workers at a file:// origin cannot read a posted File or Blob, so
    // read the size-checked file here and transfer its bytes.
    file.arrayBuffer().then(buffer => {
      if (finished) return;
      const source: EvidenceFileSource = { name: file.name, type: file.type, size: buffer.byteLength, lastModified: file.lastModified, bytes: new Uint8Array(buffer) };
      worker.postMessage({ source, options }, [buffer]);
    }).catch(error => fail('extractionFailed', error instanceof Error ? error.message : undefined));
  });
}

/** Parse a whole batch before its caller may persist anything. No synchronous
 * parser fallback: unsupported workers must not move hostile work onto the UI. */
export async function extractEvidenceFiles(files: File[], options: EvidenceDraftOptions = {}, signal?: AbortSignal): Promise<EvidenceItemDraft[]> {
  signal?.throwIfAborted();
  if (files.length > MAX_EVIDENCE_IMPORT_FILES) throw new EvidenceImportLimitError('fileCount');
  let total = 0;
  for (const file of files) { assertEvidenceInput(file); total += file.size; }
  if (total > EVIDENCE_LIMITS.batchBytes) throw new EvidenceImportLimitError('batchBytes');
  if (!files.length) return [];
  const controller = new AbortController();
  const abort = () => controller.abort(signal && abortReason(signal));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new EvidenceImportLimitError('batchTimeout')), EVIDENCE_LIMITS.batchTimeoutMs);
  const deadline = Date.now() + EVIDENCE_LIMITS.batchTimeoutMs;
  try {
    const drafts: EvidenceItemDraft[] = [];
    for (const file of files) drafts.push(...await parseDocument(file, options, controller.signal));
    controller.signal.throwIfAborted();
    if (Date.now() >= deadline) throw new EvidenceImportLimitError('batchTimeout');
    return drafts;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
