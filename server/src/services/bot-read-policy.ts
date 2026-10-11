import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import { botConfigs, users } from '../db/schema.js';
import type { BotContext } from '../bots/types.js';

type ReadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReadCapability = 'read_entities' | 'cross_investigation';

/** Hold the policy boundary through the actual read. Visibility is applied in
 * SQL before limits, using the intersection of the run and current grants.
 * Global grants retain broad access, but never to a missing/deleted folder. */
export async function withBotReadPolicy<T>(context: BotContext, capability: ReadCapability,
  read: (tx: ReadTransaction, visibleScope: (folderColumn: AnyPgColumn) => SQL) => Promise<T>): Promise<T> {
  context.signal.throwIfAborted();
  const result = await db.transaction(async tx => {
    const clock = await tx.execute(sql`SELECT id FROM sync_clock WHERE id = 1 FOR SHARE`);
    if (!clock.length) throw new Error('Bot read authorization lock is unavailable');
    const [account] = await tx.select({ active: users.active }).from(users)
      .where(eq(users.id, context.botUserId)).for('share');
    const [config] = await tx.select({
      userId: botConfigs.userId, enabled: botConfigs.enabled, capabilities: botConfigs.capabilities,
      scopeType: botConfigs.scopeType, scopeFolderIds: botConfigs.scopeFolderIds,
    }).from(botConfigs).where(eq(botConfigs.id, context.botConfig.id)).for('share');
    const run = context.botConfig;
    if (!account?.active || !config?.enabled || config.userId !== context.botUserId
      || run.userId !== context.botUserId || !run.capabilities.includes(capability)
      || !Array.isArray(config.capabilities) || !config.capabilities.includes(capability)) {
      throw new Error('Bot read is no longer authorized');
    }
    const scopedGrants: string[][] = [];
    for (const grant of [run, config]) {
      if (grant.scopeType === 'global') continue;
      if (grant.scopeType !== 'investigation' || !Array.isArray(grant.scopeFolderIds)) {
        throw new Error('Invalid bot investigation scope');
      }
      const ids: string[] = [];
      for (const id of grant.scopeFolderIds) {
        if (typeof id !== 'string' || !id) throw new Error('Invalid bot investigation scope');
        ids.push(id);
      }
      scopedGrants.push(ids);
    }
    const visibleScope = (folderColumn: AnyPgColumn): SQL => {
      const folder = sql`EXISTS (SELECT 1 FROM folders AS bot_read_folder
        WHERE bot_read_folder.id = ${folderColumn} AND bot_read_folder.deleted_at IS NULL)`;
      if (!scopedGrants.length) return sql`(${folderColumn} IS NULL OR ${folderColumn} = '' OR ${folder})`;
      const member = sql`EXISTS (SELECT 1 FROM investigation_members AS bot_read_member
        WHERE bot_read_member.folder_id = ${folderColumn} AND bot_read_member.user_id = ${context.botUserId}
          AND bot_read_member.role IN ('owner', 'editor', 'viewer'))`;
      const scopes = scopedGrants.map(ids => ids.length ? inArray(folderColumn, ids) : sql`false`);
      return sql`${and(folder, member, ...scopes)}`;
    };
    context.signal.throwIfAborted();
    const result = await read(tx, visibleScope);
    context.signal.throwIfAborted();
    return result;
  });
  // Read-only results can be discarded even if cancellation arrived while the
  // database was completing the transaction after the callback returned.
  context.signal.throwIfAborted();
  return result;
}
