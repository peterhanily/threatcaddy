import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], end: vi.fn() }));
vi.mock('postgres', () => ({
  default: (_url: string, options: Record<string, unknown>) => {
    mocks.options.push(options);
    const sql = async () => [{ acquired: true }];
    return Object.assign(sql, { end: mocks.end });
  },
}));

import { acquireRuntimeLease } from '../services/runtime-lease.js';

describe('acquireRuntimeLease', () => {
  beforeEach(() => { mocks.options.length = 0; mocks.end.mockReset(); });

  it('holds the lease on a connection that never expires on its own', async () => {
    const release = await acquireRuntimeLease('postgres://lease', vi.fn());
    expect(mocks.options).toHaveLength(1);
    expect(mocks.options[0]).toMatchObject({ max: 1, idle_timeout: 0, max_lifetime: null });
    await release();
    expect(mocks.end).toHaveBeenCalled();
  });
});
