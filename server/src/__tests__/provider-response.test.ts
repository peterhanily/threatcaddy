import { describe, expect, it } from 'vitest';
import { parseAnthropicResponse, parseGeminiResponse } from '../lib/provider-response.js';

describe('provider response validation', () => {
  it('preserves valid Anthropic content and collects checked tool calls', () => {
    const content = [
      { type: 'thinking', thinking: 'Ordinary provider reasoning.', signature: 'fixture-signature' },
      { type: 'text', text: 'Reading the summary.' },
      { type: 'tool_use', id: 'call-one', name: 'read_summary', input: { investigationId: 'case-one' } },
    ];
    expect(parseAnthropicResponse({ content, stop_reason: 'tool_use' })).toEqual({
      textParts: ['Reading the summary.'],
      toolCalls: [{ id: 'call-one', name: 'read_summary', input: { investigationId: 'case-one' } }],
      stopReason: 'tool_use', rawAssistantContent: content,
    });
  });

  it.each([
    null,
    { content: {}, stop_reason: 'end_turn' },
    { content: [], stop_reason: null },
    { content: [null], stop_reason: 'end_turn' },
    { content: [{ type: 'text', text: 1 }], stop_reason: 'end_turn' },
    { content: [{ type: 'tool_use', name: 'read_summary', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 'call-one', name: ' ', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 'call-one', name: 'read_summary', input: [] }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 'call-one', name: 'read_summary', input: null }], stop_reason: 'tool_use' },
  ])('rejects an incomplete Anthropic response %#', value => {
    expect(() => parseAnthropicResponse(value)).toThrow('Malformed Anthropic response');
  });

  it('rejects duplicate Anthropic call identities without disclosing arguments', () => {
    const call = { type: 'tool_use', id: 'call-one', name: 'read_summary', input: { annotation: 'private fixture annotation' } };
    expect(() => parseAnthropicResponse({ content: [call, call], stop_reason: 'tool_use' }))
      .toThrow(new Error('Malformed Anthropic response: duplicate tool call id'));
  });

  it('preserves valid Gemini content, including an argument-free call', () => {
    const content = { role: 'model', parts: [
      { text: 'Reading the summary.' },
      { functionCall: { name: 'read_summary', args: { investigationId: 'case-one' } } },
      { functionCall: { name: 'read_summary' } },
    ] };
    expect(parseGeminiResponse({ candidates: [{ content, finishReason: 'STOP' }] })).toEqual({
      textParts: ['Reading the summary.'],
      toolCalls: [
        { id: 'gemini-tc-0', name: 'read_summary', input: { investigationId: 'case-one' } },
        { id: 'gemini-tc-1', name: 'read_summary', input: {} },
      ],
      stopReason: 'STOP', rawAssistantContent: content,
    });
  });

  it('accepts a blocked Gemini prompt without a candidate', () => {
    expect(parseGeminiResponse({ promptFeedback: { blockReason: 'OTHER' } })).toEqual({
      textParts: [], toolCalls: [], stopReason: 'STOP', rawAssistantContent: undefined,
    });
  });

  it.each([
    null,
    { candidates: {} },
    { candidates: [null] },
    { candidates: [{ finishReason: 1 }] },
    { candidates: [{ content: { parts: {} } }] },
    { candidates: [{ content: { parts: [null] } }] },
    { candidates: [{ content: { parts: [{ text: 1 }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { args: {} } }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'read_summary', args: [] } }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'read_summary', args: null } }] } }] },
  ])('rejects an incomplete Gemini response %#', value => {
    expect(() => parseGeminiResponse(value)).toThrow('Malformed Gemini response');
  });
});
