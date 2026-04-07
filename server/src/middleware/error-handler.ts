import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '../lib/logger.js';
import { ErrorCodes } from '../types/error-codes.js';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Global Hono `onError` handler.
 *
 * - Logs structured error info (message, stack, method, path, userId, statusCode)
 * - Returns a consistent JSON envelope: `{ error, requestId? }`
 * - Hides stack traces from the response in production
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
    error: err.message,
    stack: err.stack,
    method: c.req.method,
    path: c.req.path,
    userId,
    requestId,
    statusCode,
  });

  const body: Record<string, unknown> = {
    error: isProd ? 'Internal server error' : err.message,
    code: ErrorCodes.INTERNAL_ERROR,
  };
  if (requestId) body.requestId = requestId;

  return c.json(body, statusCode);
}
