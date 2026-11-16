import { bodyLimit } from 'hono/body-limit';
import type { Context, MiddlewareHandler } from 'hono';
import { ErrorCodes } from '../types/error-codes.js';
import { requireAuth } from './auth.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_SYNC_BYTES = 16 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
function payloadTooLarge(c: Context): Response {
  // The HTTP/1 server may stop draining an unread body and close its socket.
  // Advertise closure before a client pools that socket for another request.
  c.header('Connection', 'close');
  const requestId = c.get('requestId') as string | undefined;
  return c.json({ error: 'Payload too large', code: ErrorCodes.PAYLOAD_TOO_LARGE,
    ...(requestId ? { requestId } : {}) }, 413);
}
const ordinary = bodyLimit({ maxSize: 1024 * 1024, onError: payloadTooLarge });
const file = bodyLimit({ maxSize: MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES, onError: payloadTooLarge });
const backup = bodyLimit({ maxSize: MAX_BACKUP_BYTES + MULTIPART_OVERHEAD_BYTES, onError: payloadTooLarge });
const sync = bodyLimit({ maxSize: MAX_SYNC_BYTES, onError: payloadTooLarge });

function largeLimit(c: Context): MiddlewareHandler | undefined {
  if (c.req.method === 'POST' && c.req.path === '/api/files/upload') return file;
  if (c.req.method === 'POST' && /^\/api\/backups\/?$/.test(c.req.path)) return backup;
  if (c.req.method === 'POST' && c.req.path === '/api/sync/push') return sync;
}

// One selected limit: stacking these middlewares also enforces the smallest one.
// bodyLimit buffers a body without Content-Length up to its limit before next(),
// and this runs before the route rate limiters. A large limit therefore applies
// only after authentication; anonymous requests never exceed the ordinary limit.
export const apiBodyLimit: MiddlewareHandler = async (c, next) => {
  const limit = largeLimit(c);
  if (!limit) return ordinary(c, next);
  let limited: Response | void = undefined;
  const denied = await requireAuth(c, async () => { limited = await limit(c, next); });
  return denied ?? limited;
};
