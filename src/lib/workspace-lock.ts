import { encryptField, decryptField } from './crypto';

interface LockParticipant {
  seal: (key: CryptoKey) => void;
  restore: (key: CryptoKey, current: () => boolean, authorizeWrite?: (transaction: object) => void) => Promise<void>;
}
const participants = new Set<LockParticipant>();

/** Participants capture bounded, tab-local unsaved work before cancellation.
 * They may encrypt that snapshot, but must never postpone key revocation for I/O. */
export function registerLockParticipant(participant: LockParticipant): () => void {
  participants.add(participant);
  return () => { participants.delete(participant); };
}
export const RECOVERY_WARNING = 'Some unsaved work could not be encrypted for recovery. Keep this tab open and unlock again to recover it.';
function warnRecovery(): void {
  window.dispatchEvent(new Event('workspace-recovery-warning'));
}
export function sealWorkspaceRecovery(key: CryptoKey): boolean {
  let complete = true;
  for (const participant of participants) {
    try { participant.seal(key); }
    catch {
      // One faulty participant must not prevent the remaining work from being
      // captured or leave provider callbacks attached to an active session.
      complete = false;
    }
  }
  return complete;
}
export async function restoreWorkspaceRecovery(key: CryptoKey, current: () => boolean, authorizeWrite?: (transaction: object) => void): Promise<void> {
  for (const participant of participants) {
    if (!current()) throw new Error('Workspace locked while recovering unsaved work. Unlock again to retry.');
    await participant.restore(key, current, authorizeWrite);
  }
}

/** Same lifetime as the existing drafts: tab memory only, never plaintext
 * browser storage. Web Crypto owns a short-lived key reference while sealing;
 * it does not retain an active workspace session or permit database access.
 * If encryption itself fails, keep the inaccessible snapshot for the next
 * authenticated unlock rather than destroy the user's only unsaved copy. */
export class SealedRecovery<T> {
  private ciphertext?: unknown;
  private pending?: Promise<void>;
  private failedSnapshot?: T;
  hasValue(): boolean { return !!this.pending || this.ciphertext !== undefined || this.failedSnapshot !== undefined; }
  seal(value: T, key: CryptoKey): void {
    if (this.hasValue()) throw new Error('Unsaved recovery is already sealed.');
    this.pending = encryptField(value, key).then(ciphertext => { this.ciphertext = ciphertext; })
      .catch(() => { this.failedSnapshot = value; warnRecovery(); })
      .finally(() => { this.pending = undefined; });
  }
  async open(key: CryptoKey): Promise<T | undefined> {
    await this.pending;
    if (this.failedSnapshot !== undefined) return this.failedSnapshot;
    return this.ciphertext === undefined ? undefined : await decryptField(this.ciphertext, key) as T;
  }
  clear(): void { this.ciphertext = undefined; this.failedSnapshot = undefined; }
}
