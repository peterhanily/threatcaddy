import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DrizzleQueryError } from 'drizzle-orm';
import { globalErrorHandler } from '../middleware/error-handler.js';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$Zml4dHVyZXNhbHQ$fixture-hash-of-typed-password';

function uniqueViolation() {
  return new DrizzleQueryError(
    'insert into "admin_users" ("id", "username", "display_name", "password_hash") values ($1, $2, $3, $4)',
    ['admin-id', 'admin', 'Administrator', HASH],
    Object.assign(new Error('duplicate key value violates unique constraint "admin_users_username_unique"'), {
      name: 'PostgresError', code: '23505', constraint_name: 'admin_users_username_unique',
      detail: 'Key (username)=(admin) already exists.',
    }),
  );
}

let logged = '';
function appThrowing(error: Error) {
  const app = new Hono();
  app.onError(globalErrorHandler);
  app.post('/boom', () => { throw error; });
  return app;
}

beforeEach(() => {
  logged = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => { logged += String(chunk); return true; });
});
afterEach(() => vi.restoreAllMocks());

describe('globalErrorHandler', () => {
  it('never returns or logs the failed query or its parameters for database errors', async () => {
    const response = await appThrowing(uniqueViolation()).request('/boom', { method: 'POST' });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    for (const output of [text, logged]) {
      expect(output).not.toContain(HASH);
      expect(output).not.toContain('Failed query');
      expect(output).not.toContain('insert into');
    }
    const entry = JSON.parse(logged.trim());
    expect(entry).toMatchObject({
      level: 'error', errorName: 'DrizzleQueryError', sqlState: '23505', constraint: 'admin_users_username_unique',
      error: 'duplicate key value violates unique constraint "admin_users_username_unique"', method: 'POST', path: '/boom', statusCode: 500,
    });
    expect(entry.stack).toBeUndefined();
  });

  it('returns a fixed body for unexpected server errors and logs a bounded message', async () => {
    const message = `unexpected failure ${'x'.repeat(10_000)} secret-tail`;
    const response = await appThrowing(new Error(message)).request('/boom', { method: 'POST' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    const entry = JSON.parse(logged.trim());
    expect(entry.errorName).toBe('Error');
    expect(entry.error.startsWith('unexpected failure x')).toBe(true);
    expect(entry.error.length).toBeLessThanOrEqual(1100);
    expect(logged).not.toContain('secret-tail');
    expect(entry.stack).toMatch(/^\s+at /);
    expect(logged.length).toBeLessThan(5_000);
  });

  it('keeps client error statuses carried by the error', async () => {
    const response = await appThrowing(Object.assign(new Error('Forbidden here'), { status: 403 })).request('/boom', { method: 'POST' });
    expect(response.status).toBe(403);
    expect(JSON.parse(logged.trim()).statusCode).toBe(403);
  });
});
