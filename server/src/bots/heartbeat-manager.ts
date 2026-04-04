/**
 * HeartbeatManager — monitors client heartbeats and enables/disables
 * server-side caddy-agent bots based on client presence.
 *
 * Protocol:
 * - Client sends heartbeat POST every 30s while running agents
 * - If heartbeat stale >90s, server enables the corresponding bot_configs
 * - When heartbeat resumes, server disables bots (client takes over)
 */

import { eq, lt, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { agentHeartbeats, botConfigs } from '../db/schema.js';
import type { BotManager } from './bot-manager.js';

const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds
const GRACE_PERIOD_MS = 90_000;   // 90 seconds before server takes over

export class HeartbeatManager {
  private db: NodePgDatabase;
  private botManager: BotManager | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(db: NodePgDatabase) {
    this.db = db;
  }

  /** Wire to BotManager (called after BotManager is initialized). */
  setBotManager(manager: BotManager) {
    this.botManager = manager;
  }

  /** Start monitoring heartbeats. */
  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.check().catch(console.error), CHECK_INTERVAL_MS);
    console.log('[HeartbeatManager] Started monitoring (interval: 30s, grace: 90s)');
  }

  /** Stop monitoring. */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[HeartbeatManager] Stopped');
  }

  /**
   * Record a heartbeat from a client.
   * If server was running agents, disables them and returns true.
   */
  async recordHeartbeat(folderId: string, userId: string): Promise<{ serverWasRunning: boolean }> {
    const now = new Date();
    const takeoverAt = new Date(now.getTime() + GRACE_PERIOD_MS);

    // Upsert heartbeat
    await this.db
      .insert(agentHeartbeats)
      .values({ folderId, userId, lastBeat: now, serverTakeoverAt: takeoverAt })
      .onConflictDoUpdate({
        target: agentHeartbeats.folderId,
        set: { userId, lastBeat: now, serverTakeoverAt: takeoverAt },
      });

    // Check if server was running agents for this investigation
    let serverWasRunning = false;
    const enabledBots = await this.db.select()
      .from(botConfigs)
      .where(and(
        eq(botConfigs.sourceType, 'caddy-agent'),
        eq(botConfigs.enabled, true),
      ));

    const matchingBots = enabledBots.filter(b =>
      Array.isArray(b.scopeFolderIds) && (b.scopeFolderIds as string[]).includes(folderId)
    );

    if (matchingBots.length > 0) {
      serverWasRunning = true;
      // Disable server bots — client is back
      for (const bot of matchingBots) {
        await this.db.update(botConfigs)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(botConfigs.id, bot.id));
        this.botManager?.unloadBot?.(bot.id);
      }
      console.log(`[HeartbeatManager] Client back for folder ${folderId} — disabled ${matchingBots.length} server bot(s)`);
    }

    return { serverWasRunning };
  }

  /** Periodic check for stale heartbeats. */
  private async check() {
    const now = new Date();

    // Find stale heartbeats (takeover time has passed)
    const staleHeartbeats = await this.db.select()
      .from(agentHeartbeats)
      .where(lt(agentHeartbeats.serverTakeoverAt, now));

    for (const hb of staleHeartbeats) {
      // Find caddy-agent bots for this investigation that are currently disabled
      const disabledBots = await this.db.select()
        .from(botConfigs)
        .where(and(
          eq(botConfigs.sourceType, 'caddy-agent'),
          eq(botConfigs.enabled, false),
        ));

      const matchingBots = disabledBots.filter(b =>
        Array.isArray(b.scopeFolderIds) && (b.scopeFolderIds as string[]).includes(hb.folderId)
      );

      if (matchingBots.length > 0) {
        // Enable server bots — client is away
        for (const bot of matchingBots) {
          await this.db.update(botConfigs)
            .set({ enabled: true, updatedAt: new Date() })
            .where(eq(botConfigs.id, bot.id));
          await this.botManager?.reloadBot?.(bot.id);
        }
        console.log(`[HeartbeatManager] Client stale for folder ${hb.folderId} — enabled ${matchingBots.length} server bot(s)`);
      }
    }
  }
}
