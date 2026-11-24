import type { ToolUseBlock } from '../types';
import type { HumanApproval } from './human-approval';
import { isPlanModeTool, type ToolSurface } from './tool-reach';

export interface ToolExecutionResult {
  result: string;
  isError: boolean;
}

/** Request-specific permissions are enforced again immediately before dispatch. */
export interface ToolExecutionConstraints {
  /** Where the call comes from; the dispatcher re-runs the decision table for it. Plan is 'chat-plan'. */
  surface: ToolSurface;
  allowedTools: ReadonlySet<string>;
  /** A person approved this exact call (human-approval.ts). */
  approval?: HumanApproval;
  signal?: AbortSignal;
  toolBinding?: string;
  validateScope?: (toolUse: ToolUseBlock) => Promise<string | undefined>;
}

export function getToolExecutionError(toolUse: ToolUseBlock, constraints: ToolExecutionConstraints): string | undefined {
  if (constraints.signal?.aborted) return 'Tool execution was cancelled.';
  if (!constraints.allowedTools.has(toolUse.name)) return `Tool "${toolUse.name}" is not allowed for this request.`;
  if (constraints.surface === 'chat-plan' && !isPlanModeTool(toolUse.name)) return 'Plan mode only reads this investigation.';
  if (!toolUse.input || typeof toolUse.input !== 'object' || Array.isArray(toolUse.input)) return 'Tool input must be an object.';
}

export function toolExecutionError(error: string): ToolExecutionResult {
  return { result: JSON.stringify({ error }), isError: true };
}

/** Truncate tool results and signal truncation to the LLM */
export function truncateToolResult(result: string, maxLen: number): string {
  if (result.length <= maxLen) return result;
  const note = `Showing ${maxLen.toLocaleString()} of ${result.length.toLocaleString()} characters. Use more specific queries, filters or paging to get complete data.`;
  // Never ending on half a character: providers can reject a lone surrogate.
  if (!/^\s*[[{]/.test(result)) return result.substring(0, maxLen).replace(/[\uD800-\uDBFF]$/, '') + `\n\n[TRUNCATED: ${note}]`;
  // JSON stays JSON: the start of the result as a string, marked truncated. Escaping can lengthen
  // it, so the kept part shrinks by the overshoot (never splitting a surrogate pair).
  let kept = maxLen;
  for (let pass = 0; pass < 4; pass++) {
    if (/[\uD800-\uDBFF]/.test(result.charAt(kept - 1))) kept--;
    const wrapped = JSON.stringify({ truncated: true, note, partial: result.substring(0, kept) });
    if (wrapped.length <= maxLen + 400) return wrapped;
    kept = Math.floor(kept * maxLen / wrapped.length) - 400;
  }
  return JSON.stringify({ truncated: true, note });
}

/** Preserve existing payloads while making handler errors visible to every caller. */
export function normalizeToolResult(result: string): ToolExecutionResult {
  try {
    const value: unknown = JSON.parse(result);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const payload = value as Record<string, unknown>;
      if (payload.success === false || Boolean(payload.error) || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
        return { result, isError: true };
      }
    }
  } catch { /* Plain-text tool results remain supported. */ }
  return { result, isError: false };
}
