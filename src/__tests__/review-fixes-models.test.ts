import { describe, it, expect } from 'vitest';
import { decodeBlocks, presentBlocks } from '../lib/tool-name-alias';
import { MODELS, DEFAULT_MODEL, DEFAULT_MODEL_PER_PROVIDER, MODEL_PROVIDER_MAP } from '../lib/models';
import { calculateCost } from '../lib/model-pricing';

describe('provider content blocks', () => {
  it('drops the gap a thinking block leaves before the text or tool call', () => {
    // What the extension sends for a model that thinks first: index 0 was never filled.
    const fromExtension = JSON.parse(JSON.stringify([undefined, { type: 'text', text: 'Answer' }, undefined, { type: 'tool_use', id: 't1', name: 'alias', input: {} }]));
    expect(fromExtension[0]).toBeNull();
    expect(presentBlocks(fromExtension)).toEqual([{ type: 'text', text: 'Answer' }, { type: 'tool_use', id: 't1', name: 'alias', input: {} }]);
    expect(decodeBlocks(fromExtension, name => (name === 'alias' ? 'search_notes' : name)))
      .toEqual([{ type: 'text', text: 'Answer' }, { type: 'tool_use', id: 't1', name: 'search_notes', input: {} }]);
    expect(presentBlocks(undefined)).toEqual([]);
    expect(presentBlocks('not a list')).toEqual([]);
  });
});

describe('model list and prices', () => {
  it('offers the current Claude models and prices every Anthropic model it offers', () => {
    const anthropic = MODELS.filter(model => model.provider === 'anthropic').map(model => model.value);
    expect(anthropic).toEqual(expect.arrayContaining(['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']));
    for (const model of anthropic) expect(calculateCost(model, 1_000_000, 0), model).toBeGreaterThan(0);
    // Opus 4.6 was listed at three times its price.
    expect(calculateCost('claude-opus-4-6', 1_000_000, 1_000_000)).toBe(30);
    expect(calculateCost('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24);
  });

  it('has one default model, which is in the list', () => {
    expect(MODEL_PROVIDER_MAP[DEFAULT_MODEL]).toBe('anthropic');
    expect(DEFAULT_MODEL_PER_PROVIDER.anthropic).toBe(DEFAULT_MODEL);
  });
});
