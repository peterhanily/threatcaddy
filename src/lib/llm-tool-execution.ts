import type { ToolUseBlock } from '../types';
import { isWriteTool } from './llm-tool-defs';

export interface ToolExecutionResult {
  result: string;
  isError: boolean;
}

/** Request-specific permissions are enforced again immediately before dispatch. */
export interface ToolExecutionConstraints {
  allowedTools: ReadonlySet<string>;
  readOnly?: boolean;
  signal?: AbortSignal;
  toolBinding?: string;
  validateScope?: (toolUse: ToolUseBlock) => Promise<string | undefined>;
}

export function getToolExecutionError(toolUse: ToolUseBlock, constraints: ToolExecutionConstraints): string | undefined {
  if (constraints.signal?.aborted) return 'Tool execution was cancelled.';
  if (!constraints.allowedTools.has(toolUse.name)) return `Tool "${toolUse.name}" is not allowed for this request.`;
  if (constraints.readOnly && isWriteTool(toolUse.name)) return 'Plan mode does not permit tools that modify data.';
  if (!toolUse.input || typeof toolUse.input !== 'object' || Array.isArray(toolUse.input)) return 'Tool input must be an object.';
}

export function toolExecutionError(error: string): ToolExecutionResult {
  return { result: JSON.stringify({ error }), isError: true };
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
