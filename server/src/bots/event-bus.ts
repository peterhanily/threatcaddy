import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { BotEvent, BotEventType } from './types.js';
import { logger } from '../lib/logger.js';

/** Tracks current bot event chain depth to prevent infinite mutual bot loops */
export const botEventDepth = new AsyncLocalStorage<number>();

/** Tracks all bot user IDs in the current event chain to prevent amplification */
export const botEventOrigins = new AsyncLocalStorage<string[]>();

/**
 * In-process event bus for bot triggers.
 * Wired into sync-service to emit events on every entity mutation.
 * Listeners are registered by BotManager.
 */
class BotEventBus extends EventEmitter {
  constructor() {
    super();
    // Don't let a bad listener crash the server
    this.setMaxListeners(100);
  }

  emit(event: string, ...args: unknown[]): boolean {
    try {
      return super.emit(event, ...args);
    } catch (err) {
      logger.error('BotEventBus listener error', { event, error: String(err) });
      return false;
    }
  }

  /** Emit a typed bot event */
  emitBotEvent(event: BotEvent): void {
    // Emit the specific event type (e.g., 'entity.created')
    this.emit(event.type, event);
    // Also emit a wildcard so BotManager can route all events
    this.emit('*', event);
  }

  /** Subscribe to a specific event type */
  onBotEvent(type: BotEventType | '*', handler: (event: BotEvent) => void): void {
    this.on(type, handler);
  }

  /** Unsubscribe from a specific event type */
  offBotEvent(type: BotEventType | '*', handler: (event: BotEvent) => void): void {
    this.off(type, handler);
  }
}

// Singleton
export const botEventBus = new BotEventBus();

/**
 * Helper to emit entity lifecycle events from sync-service.
 * Call this after a successful processPush operation.
 */
export function emitEntityEvent(
  op: 'put' | 'delete',
  table: string,
  entityId: string,
  folderId: string | undefined,
  userId: string,
  isNew: boolean,
  data?: Record<string, unknown>,
): void {
  let type: BotEventType;
  if (op === 'delete') {
    type = 'entity.deleted';
  } else if (isNew) {
    type = 'entity.created';
  } else {
    type = 'entity.updated';
  }

  // Special investigation lifecycle events
  if (table === 'folders') {
    if (isNew) {
      type = 'investigation.created';
    } else if (data?.status === 'closed') {
      type = 'investigation.closed';
    } else if (data?.status === 'archived') {
      type = 'investigation.archived';
    }
  }

  const depth = botEventDepth.getStore() || 0;
  const originBotIds = botEventOrigins.getStore() || [];
  botEventBus.emitBotEvent({
    type,
    table,
    entityId,
    folderId: folderId ?? (table === 'folders' ? entityId : undefined),
    userId,
    data,
    timestamp: new Date(),
    depth,
    originBotIds,
  });
}
