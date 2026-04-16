import { describe, expect, it } from 'vitest';
import { makeIdempotencyKey } from '../lib/caddy-agent';

describe('makeIdempotencyKey', () => {
  it('produces the same key regardless of object property order', async () => {
    const a = await makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'x', body: 'y', tags: ['a', 'b'] });
    const b = await makeIdempotencyKey('dep1', 1000, 'create_note', { tags: ['a', 'b'], body: 'y', title: 'x' });
    expect(a).toBe(b);
  });

  it('handles nested object property reordering', async () => {
    const a = await makeIdempotencyKey('dep1', 1000, 't', { outer: { a: 1, b: 2 }, other: 'z' });
    const b = await makeIdempotencyKey('dep1', 1000, 't', { other: 'z', outer: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order (arrays are sequence-sensitive)', async () => {
    const a = await makeIdempotencyKey('dep1', 1000, 't', { tags: ['a', 'b'] });
    const b = await makeIdempotencyKey('dep1', 1000, 't', { tags: ['b', 'a'] });
    expect(a).not.toBe(b);
  });

  it('differentiates distinct inputs', async () => {
    const a = await makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'x' });
    const b = await makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'y' });
    expect(a).not.toBe(b);
  });

  it('scopes by deployment and cycle', async () => {
    const input = { title: 'x' };
    const a = await makeIdempotencyKey('dep1', 1000, 'create_note', input);
    const b = await makeIdempotencyKey('dep2', 1000, 'create_note', input);
    const c = await makeIdempotencyKey('dep1', 2000, 'create_note', input);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('handles null, undefined, and empty objects without throwing', async () => {
    await expect(makeIdempotencyKey('dep1', 1000, 't', null)).resolves.toBeDefined();
    await expect(makeIdempotencyKey('dep1', 1000, 't', undefined)).resolves.toBeDefined();
    await expect(makeIdempotencyKey('dep1', 1000, 't', {})).resolves.toBeDefined();
    expect(await makeIdempotencyKey('dep1', 1000, 't', null))
      .toBe(await makeIdempotencyKey('dep1', 1000, 't', undefined));
  });

  it('produces a 16-hex-char truncated SHA-256 suffix', async () => {
    const key = await makeIdempotencyKey('dep1', 1000, 'create_note', { title: 'x' });
    // Format: `${deploymentId}:${cycleStartedAt}:${toolName}:${hex}`
    const hex = key.split(':').pop()!;
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });
});
