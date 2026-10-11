import { describe, expect, it, vi } from 'vitest';
import { createContext, runInContext, Script } from 'node:vm';
import { botsTabJs } from '../routes/admin-html/bots-tab.js';

function fixture(bot: Record<string, unknown>) {
  const elements = new Map<string, { value: string; innerHTML: string; addEventListener: ReturnType<typeof vi.fn> }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', addEventListener: vi.fn() });
    return elements.get(id)!;
  };
  const api = vi.fn().mockResolvedValue({ bot, recentRuns: [{ id: 'run-fixture', status: 'success', createdAt: '2026-01-01' }] });
  const context = createContext({ document: { getElementById: element, querySelectorAll: () => [] },
    api, toast: vi.fn(), openDetailPanel: vi.fn(), fmtDate: () => 'Fixture date',
    esc: (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  });
  new Script(botsTabJs()).runInContext(context);
  context.allBots = [bot];
  return { context, element, api };
}

describe('generated bot availability controls', () => {
  it('parses real generated code and has no inline event attributes', () => {
    expect(() => new Script(botsTabJs())).not.toThrow();
    expect(botsTabJs()).not.toMatch(/\bon(?:click|change|error)\s*=/i);
  });

  it.each([true, false])('shows unavailable with stored enabled=%s without exposing execution controls', async enabled => {
    const { context, element } = fixture({ id: 'legacy', name: 'Fictional legacy', type: 'integration', enabled,
      runtimeAvailable: false, unavailableReason: 'Execution is unavailable.', scopeType: 'global' });
    runInContext('renderBots()', context);
    const list = element('botsBody').innerHTML;
    expect(list).toContain('unavailable'); expect(list).not.toContain('data-action="enable-bot"');
    expect(list).not.toContain('data-action="trigger-bot"'); expect(list).toContain('data-action="delete-bot"');
    expect(list.includes('data-action="disable-bot"')).toBe(enabled);
    runInContext('openBotDetail("legacy")', context);
    await Promise.resolve();
    const detail = element('detailContent').innerHTML;
    expect(detail).toContain('Execution is unavailable.'); expect(detail).toContain('Saved enabled preference:');
    expect(detail).toContain('data-bot-action="run"'); expect(detail).not.toContain('data-bot-action="enable"');
    expect(detail).not.toContain('data-bot-action="trigger"'); expect(detail).toContain('data-bot-action="delete"');
    expect(detail.includes('data-bot-action="disable"')).toBe(enabled);
  });

  it('preserves supported enable/trigger controls and safely encodes attribute values', () => {
    const { context, element } = fixture({ id: 'fixture', name: 'A "quoted" fixture', type: 'enrichment', enabled: true,
      runtimeAvailable: true, scopeType: 'global' });
    runInContext('renderBots()', context);
    expect(element('botsBody').innerHTML).toContain('data-action="trigger-bot"');
    expect(element('botsBody').innerHTML).toContain('data-name="A &quot;quoted&quot; fixture"');
    context.allBots[0].enabled = false;
    runInContext('renderBots()', context);
    expect(element('botsBody').innerHTML).toContain('data-action="enable-bot"');
  });

  it('preserves quoted investigation identifiers as checkbox values', () => {
    const { context, element } = fixture({});
    context.allInvestigations = [{ id: 'ordinary "quoted" ID', name: 'Fictional investigation' }];
    runInContext('populateInvestigationPicker()', context);
    expect(element('scopeFolderIdsList').innerHTML).toContain('value="ordinary &quot;quoted&quot; ID"');
  });
});
