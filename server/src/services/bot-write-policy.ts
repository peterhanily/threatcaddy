import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import type { BotCapability, BotContext } from '../bots/types.js';
import type { FeedTransaction } from '../middleware/feed-access.js';
import type { SyncMutationAuthorizer } from './sync-service.js';

/** Called under the sync writer lock. Both the run's grant and the current
 * stored grant must cover the actual row being changed and its destination. */
export async function authorizeBotWrite(
  tx: FeedTransaction, context: BotContext, capability: BotCapability,
  folderIds: unknown[],
): Promise<void> {
  context.signal.throwIfAborted();
  const [account] = await tx.select({ active: schema.users.active, role: schema.users.role })
    .from(schema.users).where(eq(schema.users.id, context.botUserId)).for('share');
  const [config] = await tx.select({
    userId: schema.botConfigs.userId, enabled: schema.botConfigs.enabled,
    capabilities: schema.botConfigs.capabilities, scopeType: schema.botConfigs.scopeType,
    scopeFolderIds: schema.botConfigs.scopeFolderIds,
  }).from(schema.botConfigs).where(eq(schema.botConfigs.id, context.botConfig.id)).for('share');
  if (!account?.active || account.role === 'viewer' || !config?.enabled
    || config.userId !== context.botUserId || !context.botConfig.capabilities.includes(capability)
    || !Array.isArray(config.capabilities) || !config.capabilities.includes(capability)) {
    throw new Error('Bot write is no longer authorized');
  }
  for (const folderId of new Set(folderIds)) {
    for (const grant of [context.botConfig, config]) {
      if (grant.scopeType === 'global') continue;
      if (grant.scopeType !== 'investigation' || typeof folderId !== 'string' || !folderId
        || !Array.isArray(grant.scopeFolderIds) || !grant.scopeFolderIds.includes(folderId)) {
        throw new Error('Bot write is outside its current investigation scope');
      }
    }
    if (folderId === null || folderId === undefined || folderId === '') continue;
    if (typeof folderId !== 'string') throw new Error('Invalid bot investigation scope');
    const [folder] = await tx.select({ id: schema.folders.id }).from(schema.folders)
      .where(and(eq(schema.folders.id, folderId), isNull(schema.folders.deletedAt))).limit(1);
    if (!folder) throw new Error('Bot investigation is unavailable');
    if ((config.scopeType !== 'global' || context.botConfig.scopeType !== 'global')
      && !await checkInvestigationAccess(context.botUserId, folderId, 'editor', tx)) {
      throw new Error('Bot investigation access has been revoked');
    }
  }
  context.signal.throwIfAborted();
}

export function botMutationAuthorizer(context: BotContext, mode: 'create' | 'update'): SyncMutationAuthorizer {
  return async (tx, _change, existing, next) => {
    if (mode === 'update' && !existing) throw new Error('Bot update target no longer exists');
    await authorizeBotWrite(tx, context, mode === 'create' ? 'create_entities' : 'update_entities',
      [...(existing ? [existing.folderId] : []), next.folderId]);
  };
}
