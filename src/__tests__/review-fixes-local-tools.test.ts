import { describe, it, expect } from 'vitest';
import { usesTextToolCalls } from '../lib/llm-router';
import { buildSystemPrompt } from '../lib/llm-tools';

describe('local model tool format', () => {
  it('asks for text tool calls only where the extension will read them', () => {
    // No endpoint: the request goes through the extension, which reads <tool_call> text.
    expect(usesTextToolCalls({}, 'local')).toBe(true);
    expect(usesTextToolCalls({ llmLocalEndpoint: '  ' }, 'local')).toBe(true);
    // An endpoint: the model is called directly with structured tools, and nothing reads the text.
    expect(usesTextToolCalls({ llmLocalEndpoint: 'http://localhost:11434/v1' }, 'local')).toBe(false);
    expect(usesTextToolCalls({}, 'anthropic')).toBe(false);
  });

  it('leaves the text format out of the prompt for a directly called local model', async () => {
    expect(await buildSystemPrompt(undefined, undefined, 'local', true)).toContain('<tool_call>');
    expect(await buildSystemPrompt(undefined, undefined, 'local', false)).not.toContain('<tool_call>');
    expect(await buildSystemPrompt(undefined, undefined, 'anthropic')).not.toContain('<tool_call>');
  });
});
