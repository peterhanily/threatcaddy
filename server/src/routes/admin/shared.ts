import { logActivity as _logActivity } from '../../services/audit-service.js';
import { ADMIN_SYSTEM_USER_ID as _ADMIN_SYSTEM_USER_ID } from '../../services/admin-secret.js';

export { db } from '../../db/index.js';
export {
  users, folders, allowedEmails, sessions, activityLog,
  investigationMembers, notes, tasks, timelineEvents, whiteboards,
  standaloneIOCs, chatThreads, evidenceItems, posts, files, notifications,
  botConfigs, botRuns, adminUsers,
} from '../../db/schema.js';
export { requireAdminAuth } from '../../middleware/admin-auth.js';
export { _logActivity as logActivity };
export { _ADMIN_SYSTEM_USER_ID as ADMIN_SYSTEM_USER_ID };
export { logger } from '../../lib/logger.js';

export const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/files';

/** Get admin identity from Hono context (set by requireAdminAuth middleware) */
export function getAdminId(c: { get: (key: string) => unknown }): string {
  return (c.get('adminUserId') as string) || _ADMIN_SYSTEM_USER_ID;
}

export function logAdminAction(
  adminUserId: string,
  action: string,
  detail: string,
  opts?: { itemId?: string; itemTitle?: string; folderId?: string },
) {
  return _logActivity({
    userId: adminUserId,
    category: 'admin',
    action,
    detail,
    ...opts,
  });
}
