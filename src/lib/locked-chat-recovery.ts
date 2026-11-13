import { db } from '../db';
import Dexie from 'dexie';
import type { ChatMessage, LLMProvider } from '../types';
import { registerLockParticipant, SealedRecovery } from './workspace-lock';
import { markPending, clearPending } from './pending-changes';

export interface ChatRecoveryTarget { threadId: string; messageId: string; model: string; provider: LLMProvider }
type Recovery = { target: ChatRecoveryTarget; message: ChatMessage };
const pending = new Set<SealedRecovery<Recovery>>();
const pendingToken = Symbol('interrupted chat response');
const completing = new Set<{ target: ChatRecoveryTarget; message: ChatMessage; interrupted: boolean }>();

/** Keep the completed response recoverable until its database transaction
 * commits. This also covers a lock between the final token and addMessage. */
export async function persistChatCompletion(target: ChatRecoveryTarget, message: ChatMessage, save: () => Promise<void>): Promise<boolean> {
  const record = { target, message, interrupted: false };
  completing.add(record);
  try { await save(); return !record.interrupted; }
  catch (error) { if (record.interrupted) return false; throw error; }
  finally { completing.delete(record); }
}

/** Captured synchronously before cancellation detaches the response finalizer.
 * Ciphertext stays tab-local until an authenticated unlock can commit it. */
export function retainLockedChatResult(target: ChatRecoveryTarget, message: ChatMessage, key: CryptoKey): void {
  const recovery = new SealedRecovery<Recovery>();
  recovery.seal({ target, message }, key);
  pending.add(recovery);
  markPending(pendingToken);
}

registerLockParticipant({
  seal: key => {
    for (const record of completing) {
      record.interrupted = true;
      retainLockedChatResult(record.target, record.message, key);
    }
    completing.clear();
  },
  restore: async (key, current, authorizeWrite) => {
    for (const recovery of pending) {
      const value = await recovery.open(key);
      if (!current()) throw new Error('Workspace locked during chat recovery.');
      if (!value) continue;
      const { target, message } = value;
      const parentTransaction = Dexie.currentTransaction;
      let abortRecovery: (() => void) | undefined;
      try { await db.transaction('rw', db.chatThreads, async transaction => {
        if (!current()) throw new Error('Workspace locked during chat recovery.');
        abortRecovery = () => transaction.abort();
        window.addEventListener('workspace-will-lock', abortRecovery);
        authorizeWrite?.(transaction.idbtrans);
        const thread = await db.chatThreads.get(target.threadId);
        if (thread) {
          // A completion racing the lock may already have committed.
          if (!thread.messages.some(existing => existing.id === message.id)) {
            await db.chatThreads.update(thread.id, { messages: [...thread.messages, message], updatedAt: Date.now() });
          }
        } else {
          // Preserve the result even if another tab deleted its original thread.
          const id = `recovered-${message.id}`;
          if (!await db.chatThreads.get(id)) await db.chatThreads.add({
            id, title: 'Recovered interrupted response', messages: [message],
            model: target.model, provider: target.provider, tags: [], trashed: false,
            archived: false, createdAt: Date.now(), updatedAt: Date.now(),
          });
        }
      }); } finally {
        if (abortRecovery) window.removeEventListener('workspace-will-lock', abortRecovery);
      }
      const committed = () => {
        pending.delete(recovery);
        recovery.clear();
        if (!pending.size) clearPending(pendingToken);
      };
      // If a caller already owns a transaction, a joined child is not a durable
      // commit. Retain ciphertext until the actual outer commit succeeds.
      if (parentTransaction) parentTransaction.on('complete', committed);
      else committed();
    }
    if (!pending.size) clearPending(pendingToken);
  },
});
