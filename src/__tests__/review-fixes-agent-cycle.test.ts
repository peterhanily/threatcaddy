import { describe, it, expect, beforeEach } from 'vitest';
import { beginAgentCycle, endAgentCycle, makeIdempotencyKey } from '../lib/caddy-agent';

describe('agent cycle id', () => {
  beforeEach(() => localStorage.clear());

  it('gives a cycle that was cut off the same id when it runs again, so its writes are replayed', async () => {
    const first = beginAgentCycle('dep-1', 1_000_000);
    // The tab closed here: endAgentCycle never ran.
    const again = beginAgentCycle('dep-1', 1_000_000 + 5 * 60_000);
    expect(again).toBe(first);
    expect(await makeIdempotencyKey('dep-1', again, 'create_note', { title: 'x' }))
      .toBe(await makeIdempotencyKey('dep-1', first, 'create_note', { title: 'x' }));
  });

  it('starts a new id after a finished cycle, after an hour, for another deployment and without one', () => {
    const first = beginAgentCycle('dep-1', 1_000_000);
    endAgentCycle('dep-1');
    expect(beginAgentCycle('dep-1', 1_000_500)).toBe(1_000_500);
    endAgentCycle('dep-1');

    const stale = beginAgentCycle('dep-1', 2_000_000);
    expect(beginAgentCycle('dep-1', stale + 60 * 60_000)).toBe(stale + 60 * 60_000);
    expect(beginAgentCycle('dep-2', stale + 10)).toBe(stale + 10);
    expect(first).toBe(1_000_000);
    expect(beginAgentCycle(undefined, 5)).toBe(5);
    expect(beginAgentCycle(undefined, 6)).toBe(6);
  });

  it('ignores a stored value that is not a past time', () => {
    localStorage.setItem('tc-agent-cycle:dep-1', 'nonsense');
    expect(beginAgentCycle('dep-1', 100)).toBe(100);
    localStorage.setItem('tc-agent-cycle:dep-1', '999999');
    expect(beginAgentCycle('dep-1', 100)).toBe(100);
  });
});
