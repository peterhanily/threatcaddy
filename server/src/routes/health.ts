import { Hono } from 'hono';
import { sql as drizzleSql } from 'drizzle-orm';
import { access } from 'node:fs/promises';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';

/**
 * Unauthenticated readiness check. It answers only the status and the release
 * version that release verification reads; which check failed goes to the
 * server log, and uptime and memory are not reported.
 */
export function healthRoutes(version: string) {
  const app = new Hono();
  let loggedFailure = '';

  app.get('/health', async (c) => {
    const checks: Record<string, string> = {};

    // DB check with 5-second timeout
    try {
      const dbResult = await Promise.race([
        db.execute(drizzleSql`SELECT 1`).then(() => 'connected' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);
      checks.db = dbResult;
    } catch {
      checks.db = 'disconnected';
    }

    // File storage check
    const storagePath = process.env.FILE_STORAGE_PATH || '/data/files';
    try {
      await access(storagePath);
      checks.storage = 'accessible';
    } catch {
      checks.storage = 'inaccessible';
    }

    const failed = Object.fromEntries(Object.entries(checks).filter(([, v]) => v !== 'connected' && v !== 'accessible'));
    const failure = JSON.stringify(failed);
    // Log each new failure once rather than at every poll.
    if (failure !== '{}' && failure !== loggedFailure) logger.warn('Health check degraded', failed);
    loggedFailure = failure === '{}' ? '' : failure;

    const ok = failure === '{}';
    return c.json({ status: ok ? 'ok' : 'degraded', version }, ok ? 200 : 503);
  });

  return app;
}
