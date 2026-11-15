import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DrizzleQueryError } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { sqlState } from '../lib/db-errors.js';
import { ErrorCodes } from '../types/error-codes.js';

const isProd = process.env.NODE_ENV === 'production';
const MAX_LOGGED_MESSAGE = 1024;
const MAX_LOGGED_FRAMES = 10;

const truncate = (text: string) => text.length > MAX_LOGGED_MESSAGE ? `${text.slice(0, MAX_LOGGED_MESSAGE)}…` : text;

/**
 * Bounded log fields. A DrizzleQueryError's message and stack carry the SQL
 * text and every bound parameter (row contents, password hashes), so for it
 * only the driver error's SQLSTATE, constraint and message are logged.
 */
export function errorLogFields(err: Error): Record<string, unknown> {
  const queryError = err instanceof DrizzleQueryError;
  const source: unknown = queryError ? err.cause : err;
  const constraint = (source as { constraint_name?: unknown } | undefined)?.constraint_name;
  return {
    errorName: queryError ? 'DrizzleQueryError' : err.name,
    sqlState: sqlState(err),
    constraint: typeof constraint === 'string' ? constraint : undefined,
    error: source instanceof Error ? truncate(source.message) : undefined,
    // Frames only: the first stack lines repeat the message.
    stack: queryError ? undefined : err.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, MAX_LOGGED_FRAMES).join('\n'),
  };
}

/**
 * Global Hono `onError` handler.
 *
 * - Logs bounded error info (name, SQLSTATE, truncated message, stack frames, method, path, userId, statusCode)
 * - Returns a consistent JSON envelope: `{ error, requestId? }`
 * - Never returns the message of a server error; client errors show it outside production
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  const rawStatus = 'status' in err && typeof (err as Record<string, unknown>).status === 'number'
    ? ((err as unknown as { status: number }).status as ContentfulStatusCode)
    : 500;
  // Clamp to valid HTTP error range
  const statusCode: ContentfulStatusCode = (rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500) as ContentfulStatusCode;

  // Try to pull user and requestId from context (may not be set yet)
  let userId: string | undefined;
  let requestId: string | undefined;
  try { userId = c.get('user')?.id; } catch { /* not set */ }
  try { requestId = c.get('requestId'); } catch { /* not set */ }

  logger.error('Unhandled request error', {
    ...errorLogFields(err),
    method: c.req.method,
    path: c.req.path,
    userId,
    requestId,
    statusCode,
  });

  const body: Record<string, unknown> = {
    error: isProd || statusCode >= 500 ? 'Internal server error' : err.message,
    code: ErrorCodes.INTERNAL_ERROR,
  };
  if (requestId) body.requestId = requestId;

  return c.json(body, statusCode);
}
