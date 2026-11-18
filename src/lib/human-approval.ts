import type { ToolUseBlock } from '../types';
import { canonicalJSON } from './tool-binding';

/** A person approved this exact call. Only the chat card handler and the agent
 * action queue mint one (see approval-import-boundary.test.ts). It is never
 * persisted or deserialised: a copy, LLM output, an IndexedDB row, a server
 * response or postMessage data is not registered and is refused. */
export interface HumanApproval { readonly via: 'chat-card' | 'action-queue' }

const humanApprovalRegistry = new WeakMap<object, string>();

/** The call id is not bound: executeApprovedAction dispatches under a new id. */
const bindingOf = (call: ToolUseBlock, homeFolderId: string | undefined) =>
  canonicalJSON({ name: call.name, input: call.input, home: homeFolderId });

export function mintHumanApproval(call: ToolUseBlock, homeFolderId: string | undefined, via: HumanApproval['via']): HumanApproval {
  const approval: HumanApproval = Object.freeze({ via });
  humanApprovalRegistry.set(approval, bindingOf(call, homeFolderId));
  return approval;
}

/** Single use: any presented token is spent, matching or not. A token that is
 * spent inside a transaction that later aborts is not refunded. */
export function consumeHumanApproval(token: unknown, call: ToolUseBlock, homeFolderId: string | undefined): boolean {
  if (!token || typeof token !== 'object') return false;
  const binding = humanApprovalRegistry.get(token);
  if (binding === undefined) return false;
  humanApprovalRegistry.delete(token);
  return binding === bindingOf(call, homeFolderId);
}
