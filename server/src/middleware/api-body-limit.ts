import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_SYNC_BYTES = 16 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const ordinary = bodyLimit({ maxSize: 1024 * 1024 });
const file = bodyLimit({ maxSize: MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES });
const backup = bodyLimit({ maxSize: MAX_BACKUP_BYTES + MULTIPART_OVERHEAD_BYTES });
const sync = bodyLimit({ maxSize: MAX_SYNC_BYTES });

// One selected limit: stacking these middlewares also enforces the smallest one.
export const apiBodyLimit: MiddlewareHandler = (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/files/upload') return file(c, next);
  if (c.req.method === 'POST' && /^\/api\/backups\/?$/.test(c.req.path)) return backup(c, next);
  if (c.req.method === 'POST' && c.req.path === '/api/sync/push') return sync(c, next);
  return ordinary(c, next);
};
