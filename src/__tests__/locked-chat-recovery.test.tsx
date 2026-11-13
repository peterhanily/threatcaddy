import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db';
import { generateMasterKey } from '../lib/crypto';
import { clearEncryptionMeta, setEncryptionMeta, getEncryptionMeta } from '../lib/encryptionStore';
import { setSessionKey, getSessionKey, lockEncryptionSession, decryptAllExistingData } from '../lib/encryptionMiddleware';
import { restoreWorkspaceRecovery, registerLockParticipant } from '../lib/workspace-lock';
import { persistChatCompletion } from '../lib/locked-chat-recovery';
import { useLLM } from '../hooks/useLLM';

const target = { threadId: 'lock-test-thread', messageId: 'response', model: 'test-model', provider: 'anthropic' as const };
let key: CryptoKey;
const post = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
beforeEach(async () => {
  clearEncryptionMeta(); setSessionKey(null);
  key = await generateMasterKey();
  setEncryptionMeta({ version: 1, salt: 'test', wrappedKey: 'test', recoverySalt: 'test', recoveryWrappedKey: 'test', enabledAt: 1, coverageVersion: 2 });
  setSessionKey(key);
  await db.chatThreads.put({ id: target.threadId, title: 'Test thread', messages: [], model: target.model, provider: target.provider,
    tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
});
afterEach(async () => {
  setSessionKey(key); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
  await db.chatThreads.clear(); clearEncryptionMeta(); setSessionKey(null); vi.restoreAllMocks();
});

it('aborts a stream, seals partial text and running tools, and saves them once after unlocking', async () => {
  const view = renderHook(() => useLLM());
  let finishTool!: (value: { result: string; isError: boolean }) => void;
  let toolSignal!: AbortSignal;
  const executor = vi.fn((_tool, signal: AbortSignal) => { toolSignal = signal;
    return new Promise<{ result: string; isError: boolean }>(resolve => { finishTool = resolve; }); });
  const complete = vi.fn();
  let requestId = '';
  act(() => { requestId = view.result.current.sendAgentRequest({ provider: 'anthropic', model: target.model,
    apiKey: 'synthetic-fixture', messages: [] }, executor, complete, target); });
  await act(async () => {
    post({ type: 'TC_LLM_CHUNK', requestId, content: 'Partial private response' });
    post({ type: 'TC_LLM_DONE', requestId, stopReason: 'tool_use', contentBlocks: [
      { type: 'tool_use', id: 'pending-tool', name: 'create_note', input: { title: 'Pending note' } },
    ] });
    await Promise.resolve();
  });
  act(() => { lockEncryptionSession(); });
  expect(toolSignal.aborted).toBe(true);
  expect(view.result.current.streamingContent).toBe('');
  expect(view.result.current.toolActivity).toEqual([]);
  expect(view.result.current.isStreaming).toBe(false);
  view.unmount();
  await act(async () => { finishTool({ result: 'Cancelled', isError: true }); await Promise.resolve(); });
  expect(complete).not.toHaveBeenCalled();
  setSessionKey(key); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
  const saved = (await db.chatThreads.get(target.threadId))?.messages;
  expect(saved).toHaveLength(1);
  expect(saved?.[0].content).toContain('Partial private response');
  expect(saved?.[0].content).toContain('interrupted');
  expect(saved?.[0].toolCalls?.[0]).toMatchObject({ id: 'pending-tool', isError: true, input: { title: 'Pending note' } });
  await restoreWorkspaceRecovery(key, () => true);
  expect((await db.chatThreads.get(target.threadId))?.messages).toHaveLength(1);
});

it.each([false, true])('retains a final response racing a lock without duplicating a committed message (already committed: %s)', async committed => {
  const message = { id: target.messageId, role: 'assistant' as const, content: 'Completed private response', createdAt: 2 };
  let finish!: () => void;
  const completion = persistChatCompletion(target, message, async () => {
    if (committed) await db.chatThreads.update(target.threadId, { messages: [message] });
    await new Promise<void>(resolve => { finish = resolve; });
    if (!committed) throw new Error('Workspace locked');
  });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  lockEncryptionSession(); finish(); expect(await completion).toBe(false);
  setSessionKey(key); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
  expect((await db.chatThreads.get(target.threadId))?.messages).toEqual([message]);
});

it('creates a recoverable thread if the original thread disappeared while locked', async () => {
  const message = { id: target.messageId, role: 'assistant' as const, content: 'Keep this response', createdAt: 2 };
  let finish!: () => void;
  const completion = persistChatCompletion(target, message, () => new Promise<void>(resolve => { finish = resolve; }));
  lockEncryptionSession(); finish(); await completion;
  setSessionKey(key); await db.chatThreads.delete(target.threadId);
  await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
  expect((await db.chatThreads.get('recovered-response'))?.messages).toEqual([message]);
});

it('does not resurrect a completed response deleted before a later workspace lock', async () => {
  const view = renderHook(() => useLLM());
  const complete = vi.fn();
  let requestId = '';
  act(() => { requestId = view.result.current.sendAgentRequest({ provider: 'anthropic', model: target.model,
    apiKey: 'synthetic-fixture', messages: [] }, vi.fn(), complete, target); });
  await act(async () => {
    post({ type: 'TC_LLM_CHUNK', requestId, content: 'Completed and then intentionally deleted' });
    post({ type: 'TC_LLM_DONE', requestId, stopReason: 'end_turn', contentBlocks: [] });
    await Promise.resolve();
  });
  expect(complete).toHaveBeenCalledOnce();
  await db.chatThreads.delete(target.threadId);
  act(() => { lockEncryptionSession(); }); view.unmount();
  setSessionKey(key); await restoreWorkspaceRecovery(key, () => getSessionKey() === key);
  expect(await db.chatThreads.toArray()).toEqual([]);
});


it('retains the wrapped key and a committed chat response when a later disable recovery fails', async () => {
  const message = { id: target.messageId, role: 'assistant' as const, content: 'Must survive a later recovery failure', createdAt: 2 };
  let finish!: () => void;
  const completion = persistChatCompletion(target, message, () => new Promise<void>(resolve => { finish = resolve; }));
  lockEncryptionSession(); finish(); await completion;
  setSessionKey(key);
  const remove = registerLockParticipant({ seal: () => {}, restore: async () => { throw new Error('Later recovery failure'); } });
  try {
    await expect(decryptAllExistingData(db)).rejects.toThrow('Later recovery failure');
    expect(getEncryptionMeta()?.transition).toBe('decrypting');
    expect((await db.chatThreads.get(target.threadId))?.messages).toEqual([message]);
  } finally { remove(); }
  await decryptAllExistingData(db);
  expect((await db.chatThreads.get(target.threadId))?.messages).toEqual([message]);
});
