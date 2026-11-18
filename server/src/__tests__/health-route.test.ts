import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, warn } = vi.hoisted(() => ({ execute: vi.fn(), warn: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: { execute } }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

import { healthRoutes } from '../routes/health.js';

const storage = mkdtempSync(join(tmpdir(), 'threatcaddy-health-'));
afterAll(() => rmSync(storage, { recursive: true, force: true }));
beforeEach(() => {
  vi.stubEnv('FILE_STORAGE_PATH', storage);
  execute.mockReset().mockResolvedValue([{ '?column?': 1 }]);
  warn.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

async function health(app = healthRoutes('9.8.7')) {
  const response = await app.request('/health');
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('public health endpoint', () => {
  it('reports only readiness and the release version, without uptime, memory or check details', async () => {
    expect(await health()).toEqual({ status: 200, body: { status: 'ok', version: '9.8.7' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 503 with the same two fields when the database fails, and logs the failing check privately once', async () => {
    execute.mockRejectedValue(new Error('synthetic connection failure'));
    const app = healthRoutes('9.8.7');
    expect(await health(app)).toEqual({ status: 503, body: { status: 'degraded', version: '9.8.7' } });
    expect(await health(app)).toEqual({ status: 503, body: { status: 'degraded', version: '9.8.7' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ db: 'disconnected' });
    execute.mockResolvedValue([]);
    expect((await health(app)).status).toBe(200);
    execute.mockRejectedValue(new Error('synthetic connection failure'));
    expect((await health(app)).status).toBe(503);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('reports inaccessible file storage as degraded', async () => {
    vi.stubEnv('FILE_STORAGE_PATH', join(storage, 'missing'));
    expect(await health()).toEqual({ status: 503, body: { status: 'degraded', version: '9.8.7' } });
    expect(warn.mock.calls[0][1]).toEqual({ storage: 'inaccessible' });
  });
});
