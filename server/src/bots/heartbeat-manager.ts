/**
 * Phase 1 containment: automatic handoff cannot preserve the client policy yet.
 * Retain the interface while preventing heartbeat-based activation or revocation
 * of another user's deployments. Phase 4 requires owner-scoped fenced leases.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BotManager } from './bot-manager.js';
import { logger } from '../lib/logger.js';
import { HANDOFF_UNAVAILABLE } from './handoff-policy.js';

export class HeartbeatManager {
  constructor(_db: NodePgDatabase) { void _db; }
  setBotManager(_manager: BotManager) { void _manager; }
  start() { logger.info('Automatic agent handoff is disabled pending policy enforcement'); }
  stop() {}
  async recordHeartbeat(_folderId: string, _userId: string): Promise<{ serverWasRunning: boolean }> {
    void _folderId;
    void _userId;
    throw new Error(HANDOFF_UNAVAILABLE);
  }
}
