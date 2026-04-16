import { describe, expect, it } from 'vitest';
import { makeIdempotencyKey } from '../lib/caddy-agent';

describe('makeIdempotencyKey', () => {
  it('produces the same key regardless of object property order', () => {
    const a = makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'x', body: 'y', tags: ['a', 'b'] });
    const b = makeIdempotencyKey('dep1', 1000, 'create_note', { tags: ['a', 'b'], body: 'y', title: 'x' });
    expect(a).toBe(b);
  });

  it('handles nested object property reordering', () => {
    const a = makeIdempotencyKey('dep1', 1000, 't', { outer: { a: 1, b: 2 }, other: 'z' });
    const b = makeIdempotencyKey('dep1', 1000, 't', { other: 'z', outer: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order (arrays are sequence-sensitive)', () => {
    const a = makeIdempotencyKey('dep1', 1000, 't', { tags: ['a', 'b'] });
    const b = makeIdempotencyKey('dep1', 1000, 't', { tags: ['b', 'a'] });
    expect(a).not.toBe(b);
  });

  it('differentiates distinct inputs', () => {
    const a = makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'x' });
    const b = makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'y' });
    expect(a).not.toBe(b);
  });

  it('scopes by deployment and cycle', () => {
    const input = { title: 'x' };
    const a = makeIdempotencyKey('dep1', 1000, 'create_note', input);
    const b = makeIdempotencyKey('dep2', 1000, 'create_note', input);
    const c = makeIdempotencyKey('dep1', 2000, 'create_note', input);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('handles null, undefined, and empty objects without throwing', () => {
    expect(() => makeIdempotencyKey('dep1', 1000, 't', null)).not.toThrow();
    expect(() => makeIdempotencyKey('dep1', 1000, 't', undefined)).not.toThrow();
    expect(() => makeIdempotencyKey('dep1', 1000, 't', {})).not.toThrow();
    expect(makeIdempotencyKey('dep1', 1000, 't', null))
      .toBe(makeIdempotencyKey('dep1', 1000, 't', undefined));
  });
});
