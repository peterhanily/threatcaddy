import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, NOTE_COLORS, PRIORITY_COLORS, TAG_COLORS,
  IOC_TYPE_LABELS, CLOSURE_RESOLUTION_LABELS, DEFAULT_RELATIONSHIP_TYPES,
} from '../types';
import type { ChatThread, LLMProvider } from '../types';

describe('Type constants', () => {
  it('has valid DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.editorMode).toBe('split');
    expect(DEFAULT_SETTINGS.sidebarCollapsed).toBe(false);
    expect(DEFAULT_SETTINGS.taskViewMode).toBe('list');
    expect(DEFAULT_SETTINGS.defaultView).toBe('dashboard');
  });

  it('DEFAULT_SETTINGS has no LLM keys by default', () => {
    expect(DEFAULT_SETTINGS.llmAnthropicApiKey).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmOpenAIApiKey).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmGeminiApiKey).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmMistralApiKey).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmLocalEndpoint).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmLocalApiKey).toBeUndefined();
    expect(DEFAULT_SETTINGS.llmLocalModelName).toBeUndefined();
  });

  it('has NOTE_COLORS with a "None" option', () => {
    expect(NOTE_COLORS.length).toBeGreaterThan(0);
    expect(NOTE_COLORS[0]).toEqual({ name: 'None', value: '' });
    // All other colors should have valid hex values
    NOTE_COLORS.slice(1).forEach((c) => {
      expect(c.value).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('has PRIORITY_COLORS for all levels', () => {
    expect(PRIORITY_COLORS.none).toBe('');
    expect(PRIORITY_COLORS.low).toMatch(/^#/);
    expect(PRIORITY_COLORS.medium).toMatch(/^#/);
    expect(PRIORITY_COLORS.high).toMatch(/^#/);
  });

  it('has TAG_COLORS as an array of hex colors', () => {
    expect(TAG_COLORS.length).toBeGreaterThanOrEqual(5);
    TAG_COLORS.forEach((c) => {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('IOC_TYPE_LABELS includes sigma-rule', () => {
    expect(IOC_TYPE_LABELS['sigma-rule']).toBeDefined();
    expect(IOC_TYPE_LABELS['sigma-rule'].label).toBe('SIGMA Rule');
  });

  it('IOC_TYPE_LABELS has all 13 IOC types', () => {
    const types = Object.keys(IOC_TYPE_LABELS);
    expect(types).toHaveLength(13);
    expect(types).toContain('ipv4');
    expect(types).toContain('sha256');
    expect(types).toContain('file-path');
  });

  it('CLOSURE_RESOLUTION_LABELS has all 5 types', () => {
    const keys = Object.keys(CLOSURE_RESOLUTION_LABELS);
    expect(keys).toHaveLength(5);
    expect(keys).toContain('resolved');
    expect(keys).toContain('false-positive');
    expect(keys).toContain('escalated');
    expect(keys).toContain('duplicate');
    expect(keys).toContain('inconclusive');
  });

  it('DEFAULT_RELATIONSHIP_TYPES includes detected-by and alerts-on', () => {
    expect(DEFAULT_RELATIONSHIP_TYPES['detected-by']).toBeDefined();
    expect(DEFAULT_RELATIONSHIP_TYPES['detected-by'].targetTypes).toContain('yara-rule');
    expect(DEFAULT_RELATIONSHIP_TYPES['detected-by'].targetTypes).toContain('sigma-rule');

    expect(DEFAULT_RELATIONSHIP_TYPES['alerts-on']).toBeDefined();
    expect(DEFAULT_RELATIONSHIP_TYPES['alerts-on'].sourceTypes).toContain('sigma-rule');
  });

  it('ChatThread interface shape is valid', () => {
    const thread: ChatThread = {
      id: 'test',
      title: 'Test Thread',
      messages: [],
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tags: [],
      trashed: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(thread.id).toBe('test');
    expect(thread.messages).toEqual([]);
    expect(thread.trashed).toBe(false);
  });

  it('LLMProvider type includes all 5 providers', () => {
    const providers: LLMProvider[] = ['anthropic', 'openai', 'gemini', 'mistral', 'local'];
    expect(providers).toHaveLength(5);
    // Verify each is a valid value by type-checking (compilation test)
    providers.forEach(p => expect(typeof p).toBe('string'));
  });
});
