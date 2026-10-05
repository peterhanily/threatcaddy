export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ParsedResponse {
  textParts: string[];
  toolCalls: ParsedToolCall[];
  stopReason: string;
  rawAssistantContent: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function malformed(provider: string, field: string): never {
  // Report the structural problem, never echo provider data or tool arguments.
  throw new Error(`Malformed ${provider} response: ${field}`);
}

/** Validate the complete response before callers append history or dispatch any
 * tool. An incomplete later block must not leave earlier tool effects behind. */
export function parseAnthropicResponse(value: unknown): ParsedResponse & { rawAssistantContent: unknown[] } {
  if (!isObject(value) || !Array.isArray(value.content) || typeof value.stop_reason !== 'string') {
    malformed('Anthropic', 'content and stop_reason are required');
  }
  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];
  const ids = new Set<string>();
  for (const block of value.content) {
    if (!isObject(block) || !identifier(block.type)) malformed('Anthropic', 'invalid content block');
    if (block.type === 'text') {
      if (typeof block.text !== 'string') malformed('Anthropic', 'text block requires text');
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      if (!identifier(block.id) || !identifier(block.name) || !isObject(block.input)) {
        malformed('Anthropic', 'tool call requires id, name and object input');
      }
      if (ids.has(block.id)) malformed('Anthropic', 'duplicate tool call id');
      ids.add(block.id);
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return { textParts, toolCalls, stopReason: value.stop_reason, rawAssistantContent: value.content };
}

export function parseGeminiResponse(value: unknown): ParsedResponse {
  if (!isObject(value)) malformed('Gemini', 'response must be an object');
  if (value.candidates !== undefined && !Array.isArray(value.candidates)) malformed('Gemini', 'candidates must be an array');
  const candidate: unknown = value.candidates?.[0];
  // A blocked prompt may legitimately have no candidate/content.
  if (candidate === undefined) return { textParts: [], toolCalls: [], stopReason: 'STOP', rawAssistantContent: undefined };
  if (!isObject(candidate)) malformed('Gemini', 'invalid candidate');
  if (candidate.finishReason !== undefined && typeof candidate.finishReason !== 'string') malformed('Gemini', 'invalid finishReason');
  const content = candidate.content;
  if (content !== undefined && (!isObject(content) || !Array.isArray(content.parts))) malformed('Gemini', 'content requires parts');
  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];
  const parts: unknown[] = isObject(content) && Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (!isObject(part)) malformed('Gemini', 'invalid content part');
    if (part.text !== undefined) {
      if (typeof part.text !== 'string') malformed('Gemini', 'text part requires text');
      textParts.push(part.text);
    }
    if (part.functionCall !== undefined) {
      const call = part.functionCall;
      if (!isObject(call) || !identifier(call.name) || (call.args !== undefined && !isObject(call.args))) {
        malformed('Gemini', 'function call requires name and object arguments');
      }
      toolCalls.push({ id: `gemini-tc-${toolCalls.length}`, name: call.name, input: call.args ?? {} });
    }
  }
  return { textParts, toolCalls, stopReason: candidate.finishReason ?? 'STOP', rawAssistantContent: content };
}
