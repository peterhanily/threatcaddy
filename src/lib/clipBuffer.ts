import { getActiveWorkspaceId, listWorkspaceProfiles } from './workspace-profiles';

/** The extension retains v2 deliveries until a committed receipt. Only legacy
 * messages need a small in-memory bridge across initial unlock. */
export interface ClipImportMessage {
  type: 'THREATCADDY_IMPORT_CLIPS' | 'BROWSERNOTES_IMPORT_CLIPS';
  protocol?: number;
  sourceId?: string;
  attemptId?: string;
  expectedWorkspaceId?: string;
  clips: unknown[];
}
type Consumer = (message: ClipImportMessage) => Promise<void>;
const LEGACY_MAX_CLIPS = 100;
const LEGACY_MAX_BYTES = 5 * 1024 * 1024;
const MAX_BATCH = 20;
const buffer: ClipImportMessage[] = [];
let bufferedClips = 0;
let bufferedBytes = 0;
let listening = false;
let consumer: Consumer | undefined;
let busy = false;

const token = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const post = (data: unknown) => window.postMessage(data, window.location.protocol === 'file:' ? '*' : window.location.origin);

function fail(message: ClipImportMessage, error: string) {
  if (message.protocol !== 2 || !token(message.sourceId) || !token(message.attemptId)) return;
  post({ type: 'THREATCADDY_CLIP_IMPORT_RESULT', protocol: 2, sourceId: message.sourceId,
    attemptId: message.attemptId, workspaceId: getActiveWorkspaceId(),
    results: message.clips.slice(0, MAX_BATCH).flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const clip = value as Record<string, unknown>;
      if (!token(clip.id) || !Number.isSafeInteger(clip.revision) || typeof clip.fingerprint !== 'string' || clip.fingerprint.length !== 64) return [];
      return [{ id: clip.id, revision: clip.revision, fingerprint: clip.fingerprint, status: 'failed', error }];
    }) });
}

function dispatch(message: ClipImportMessage, queued = false) {
  const current = consumer;
  if (!current || busy) {
    fail(message, current ? 'Another clip import is running. Retry when it finishes.' : 'Unlock or prepare this workspace, then retry the delivery.');
    return;
  }
  busy = true;
  void Promise.resolve().then(() => {
    if (consumer !== current) {
      if (message.protocol === 2) fail(message, 'Workspace readiness changed. Prepare delivery again.');
      else buffer.unshift(message);
      return;
    }
    if (queued) {
      bufferedClips -= message.clips.length;
      bufferedBytes -= new TextEncoder().encode(JSON.stringify(message)).byteLength;
    }
    return current(message);
  })
    .catch(() => fail(message, 'The import could not be completed. Your clips are retained; retry the delivery.'))
    .finally(() => { busy = false; drainLegacy(); });
}

function drainLegacy() {
  if (!consumer || busy) return;
  const message = buffer.shift();
  if (!message) return;
  dispatch(message, true);
}

function handler(event: MessageEvent) {
  if (event.source !== window || (window.location.protocol !== 'file:' && event.origin !== window.location.origin)) return;
  const raw = event.data;
  if (!raw || typeof raw !== 'object') return;
  if (raw.type === 'TC_CLIP_IMPORT_PROBE' && raw.protocol === 2 && token(raw.requestId)) {
    const workspaceId = getActiveWorkspaceId();
    let workspaceLabel = workspaceId === 'default' ? 'Local / original workspace' : 'Local workspace';
    try { workspaceLabel = listWorkspaceProfiles().find(profile => profile.id === workspaceId)?.label || workspaceLabel; } catch { /* Labels are not authority. */ }
    post({ type: 'TC_CLIP_IMPORT_READY', requestId: raw.requestId, protocol: 2,
      workspaceId, workspaceLabel, ready: !!consumer && !busy });
    return;
  }
  if (!['THREATCADDY_IMPORT_CLIPS', 'BROWSERNOTES_IMPORT_CLIPS'].includes(raw.type) || !Array.isArray(raw.clips) || !raw.clips.length) return;
  const message = raw as ClipImportMessage;
  if (message.protocol !== undefined && message.protocol !== 2) return;
  if (message.protocol === 2) {
    if (!token(message.sourceId) || !token(message.attemptId) || !token(message.expectedWorkspaceId)) return;
    if (message.clips.length > MAX_BATCH) { fail(message, 'Send no more than 20 clips per delivery.'); return; }
    // No v2 payload is held while locked; a later user-initiated retry is bound
    // to the destination they actually confirmed, not a stale unlock event.
    dispatch(message);
    return;
  }
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength; } catch { return; }
  if (bufferedClips + message.clips.length > LEGACY_MAX_CLIPS || bufferedBytes + bytes > LEGACY_MAX_BYTES) {
    console.warn('Legacy clip buffer is full. Keep the original extension clips and resend after unlocking.');
    return;
  }
  buffer.push(message);
  bufferedClips += message.clips.length;
  bufferedBytes += bytes;
  drainLegacy();
}

export const clipBuffer = {
  startListening() {
    if (listening) return;
    listening = true;
    window.addEventListener('message', handler);
  },
  /** Ownership follows App mounting, including subsequent re-lock/unlock. */
  subscribe(next: Consumer): () => void {
    this.startListening();
    consumer = next;
    drainLegacy();
    return () => { if (consumer === next) consumer = undefined; };
  },
};
