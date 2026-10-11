import { describe, it, expect, afterEach } from 'vitest';
import { markPending, clearPending, hasPendingChanges } from '../lib/pending-changes';

describe('pending-changes', () => {
  const first = Symbol('first editor');
  const second = Symbol('second editor');
  afterEach(() => { clearPending(first); clearPending(second); });

  it('starts clean', () => { expect(hasPendingChanges()).toBe(false); });

  it('guards navigation before App mounts and stops guarding after the last owner finishes', () => {
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    markPending(first);
    markPending(second);
    expect(unload()).toBe(true);
    clearPending(first);
    expect(unload()).toBe(true);
    clearPending(second);
    expect(unload()).toBe(false);
  });

  it('marks a typing burst once and clears after one acknowledged save', () => {
    for (let i = 0; i < 100; i++) markPending(first);
    expect(hasPendingChanges()).toBe(true);
    clearPending(first);
    expect(hasPendingChanges()).toBe(false);
  });

  it('keeps independent editors dirty when another editor saves or cleans up twice', () => {
    markPending(first);
    markPending(second);
    clearPending(first);
    clearPending(first);
    expect(hasPendingChanges()).toBe(true);
    clearPending(second);
    expect(hasPendingChanges()).toBe(false);
  });

  it('ignores unknown cleanup tokens', () => {
    clearPending(first);
    markPending(second);
    clearPending(first);
    expect(hasPendingChanges()).toBe(true);
  });
});
