import { describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';

const { logger, failure } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  failure: { error: undefined as unknown },
}));
vi.mock('../lib/logger.js', () => ({ logger }));
vi.mock('../db/index.js', () => ({ db: { select: () => { throw failure.error; } } }));
vi.mock('../services/investigation-lifecycle.js', () => ({ purgeExpiredInvestigation: vi.fn() }));
vi.mock('../services/investigation-policy.js', () => ({ lockInvestigationPolicy: vi.fn() }));
vi.mock('../services/storage-policy.js', () => ({ removeCommittedBlobs: vi.fn() }));
vi.mock('../ws/handler.js', () => ({ revokeFolderAccess: vi.fn() }));

import { pruneOldData } from '../services/cleanup-service.js';

const SECRET = 'parameter-value-that-must-not-reach-logs';

describe('data pruning failures', () => {
  it('log the SQLSTATE and driver message, never the failed SQL or its parameters', async () => {
    failure.error = new DrizzleQueryError('select "key", "value" from "server_settings" where "key" = $1', [SECRET],
      Object.assign(new Error('canceling statement due to statement timeout'), { name: 'PostgresError', code: '57014' }));
    await pruneOldData();
    expect(logger.error).toHaveBeenCalledWith('Data pruning failed', { error: 'DrizzleQueryError 57014: canceling statement due to statement timeout' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });
});
