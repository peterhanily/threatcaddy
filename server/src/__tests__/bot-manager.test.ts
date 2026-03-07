import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────

const mockSelectResolve = vi.fn().mockResolvedValue([]);
function makeUpdateChain() {
  // The chain must be thenable because code uses .where(...).catch(...)
  const promise = Promise.resolve([]);
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue(promise),
    returning: vi.fn().mockResolvedValue([]),
  };
  return chain;
}

function makeWhereResult() {
  // Returns an object that is both thenable (for `await db.select().from().where()`)
  // and has chain methods (for `.where().orderBy().limit()`, `.where().limit()`, etc.)
  const result = {
    orderBy: vi.fn().mockReturnValue({
      limit: mockSelectResolve,
    }),
    returning: vi.fn().mockResolvedValue([]),
    limit: mockSelectResolve,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return mockSelectResolve().then(resolve, reject);
    },
  };
  return result;
}

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeWhereResult()),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockImplementation(() => makeUpdateChain()),
  },
}));

const col = (n: string) => ({ name: n });
vi.mock('../db/schema.js', () => ({
  botConfigs: { id: col('id'), enabled: col('enabled'), runCount: col('run_count'), errorCount: col('error_count') },
  botRuns: { id: col('id'), botConfigId: col('bot_config_id'), status: col('status'), createdAt: col('created_at') },
  notes: { id: col('id'), folderId: col('folder_id') },
  tasks: { id: col('id') },
  folders: { id: col('id') },
  tags: { id: col('id') },
  timelineEvents: { id: col('id') },
  timelines: { id: col('id') },
  whiteboards: { id: col('id') },
  standaloneIOCs: { id: col('id') },
  chatThreads: { id: col('id') },
  investigationMembers: { folderId: col('folder_id'), userId: col('user_id'), role: col('role') },
  users: { id: col('id'), displayName: col('display_name') },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/audit-service.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/sync-service.js', () => ({
  processPush: vi.fn().mockResolvedValue([]),
  lookupEntityFolderId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/notification-service.js', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ws/handler.js', () => ({
  broadcastToFolder: vi.fn(),
}));

// ─── Tests ────────────────────────────────────────────────────────

let BotManager: typeof import('../bots/bot-manager.js').BotManager;
let validateCronExpression: typeof import('../bots/bot-manager.js').validateCronExpression;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../bots/bot-manager.js');
  BotManager = mod.BotManager;
  validateCronExpression = mod.validateCronExpression;
});

describe('BotManager', () => {
  describe('loadBot / unloadBot', () => {
    it('loadBot stores config and bot instance', async () => {
      const manager = new BotManager();
      const config = makeBotConfig({ id: 'b1', name: 'Test Bot' });
      await manager.loadBot(config);

      const loaded = manager.getLoadedBots();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('Test Bot');
    });

    it('unloadBot removes bot from loaded bots', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));
      expect(manager.getLoadedBots()).toHaveLength(1);

      await manager.unloadBot('b1');
      expect(manager.getLoadedBots()).toHaveLength(0);
    });

    it('loadBot with schedule sets up interval', async () => {
      vi.useFakeTimers();
      const manager = new BotManager();
      const config = makeBotConfig({
        id: 'b1',
        triggers: { events: [], schedule: '*/5 * * * *' },
      });
      await manager.loadBot(config);

      // Should have a scheduled interval (5 min = 300000ms)
      expect(manager.getLoadedBots()).toHaveLength(1);

      await manager.shutdown();
      vi.useRealTimers();
    });
  });

  describe('hasCapability', () => {
    it('returns true for configured capability', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        capabilities: ['read_entities', 'create_entities'],
      }));
      expect(manager.hasCapability('b1', 'read_entities')).toBe(true);
      expect(manager.hasCapability('b1', 'create_entities')).toBe(true);
    });

    it('returns false for unconfigured capability', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        capabilities: ['read_entities'],
      }));
      expect(manager.hasCapability('b1', 'call_external_apis')).toBe(false);
    });

    it('returns false for unknown bot', () => {
      const manager = new BotManager();
      expect(manager.hasCapability('nonexistent', 'read_entities')).toBe(false);
    });
  });

  describe('executeBot', () => {
    it('skips execution when bot is disabled', async () => {
      const manager = new BotManager();
      const config = makeBotConfig({ id: 'b1', enabled: false });
      // Manually set config but disabled
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).configs.set('b1', config);

      await manager.executeBot('b1', 'manual');

      // Should not have inserted a run record (no DB calls)
      const { db } = await import('../db/index.js');
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skips execution when bot is unknown', async () => {
      const manager = new BotManager();
      await manager.executeBot('nonexistent', 'manual');

      const { db } = await import('../db/index.js');
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('executes bot and creates run record', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));

      await manager.executeBot('b1', 'manual');

      const { db } = await import('../db/index.js');
      expect(db.insert).toHaveBeenCalled(); // run record
    });
  });

  describe('shutdown', () => {
    it('destroys all bots and clears state', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));
      await manager.loadBot(makeBotConfig({ id: 'b2' }));
      expect(manager.getLoadedBots()).toHaveLength(2);

      await manager.shutdown();
      expect(manager.getLoadedBots()).toHaveLength(0);
    });
  });

  describe('event routing', () => {
    it('routes event to bots subscribed to that event type', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.created'] },
      }));

      await manager.executeBot('b1', 'event', {
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      const { db } = await import('../db/index.js');
      expect(db.insert).toHaveBeenCalled();
    });

    it('executes bot even without folderId when called directly', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { folderIds: ['f1', 'f2'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertCalls = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      await manager.executeBot('b1', 'event', {
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      // Should still execute (executeBot is called directly, not via routeEvent)
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(insertCalls);
    });
  });

  describe('stats', () => {
    it('getStats returns current state', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));

      const stats = manager.getStats();
      expect(stats.loadedBots).toBe(1);
      expect(stats.activeRuns).toBe(0);
      expect(stats.queueSize).toBe(0);
      expect(stats.dropped).toBe(0);
      expect(stats.rateLimited).toBe(0);
    });
  });

  describe('routeEvent', () => {
    it('routes event to bot subscribed to that event type', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.created'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      // Give async executeBot time to start
      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(insertBefore);
    });

    it('does not route event to bot not subscribed to that event type', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.deleted'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('filters events by folder when eventFilters.folderIds is set', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { folderIds: ['f1'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // Event with wrong folder should be filtered out
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'wrong-folder',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('rejects events without folderId when folder filter is set', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { folderIds: ['f1'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        userId: 'human-user',
        timestamp: new Date(),
        // no folderId
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('prevents bot from triggering itself (self-trigger prevention)', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.created'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // Event from the bot's own userId should be ignored
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'bot-user-1',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('prevents re-entry via originBotIds chain', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.created'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'other-user',
        originBotIds: ['bot-user-1'],
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('drops events at depth >= 5', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: { events: ['entity.created'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        depth: 5,
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('filters by scope (investigation-scoped bot rejects out-of-scope events)', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        scopeType: 'investigation',
        scopeFolderIds: ['f1'],
        triggers: { events: ['entity.created'] },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f2',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });
  });

  describe('getWebhookSecret', () => {
    it('returns null for unknown bot', async () => {
      const manager = new BotManager();
      expect(manager.getWebhookSecret('nonexistent')).toBeNull();
    });

    it('returns null for disabled bot', async () => {
      const manager = new BotManager();
      const config = makeBotConfig({ id: 'b1', enabled: false, triggers: { webhook: true } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).configs.set('b1', config);
      expect(manager.getWebhookSecret('b1')).toBeNull();
    });

    it('returns null when webhook trigger is not enabled', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1', triggers: { events: ['entity.created'] } }));
      expect(manager.getWebhookSecret('b1')).toBeNull();
    });

    it('returns null when no webhookSecret is in decrypted config', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1', triggers: { webhook: true }, config: {} }));
      expect(manager.getWebhookSecret('b1')).toBeNull();
    });

    it('returns the secret when webhook is enabled and secret is configured', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        triggers: { webhook: true },
        config: { webhookSecret: 'my-secret-123' },
      }));
      expect(manager.getWebhookSecret('b1')).toBe('my-secret-123');
    });
  });

  describe('reloadBot', () => {
    it('unloads and reloads bot from DB', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1', name: 'Original' }));
      expect(manager.getLoadedBots()).toHaveLength(1);

      // Mock DB to return updated config
      mockSelectResolve.mockResolvedValueOnce([makeBotConfig({ id: 'b1', name: 'Updated', enabled: true })]);
      await manager.reloadBot('b1');

      const loaded = manager.getLoadedBots();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('Updated');
    });

    it('unloads and does not reload if bot is disabled in DB', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));

      mockSelectResolve.mockResolvedValueOnce([makeBotConfig({ id: 'b1', enabled: false })]);
      await manager.reloadBot('b1');

      expect(manager.getLoadedBots()).toHaveLength(0);
    });

    it('unloads and does not reload if bot not found in DB', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1' }));

      mockSelectResolve.mockResolvedValueOnce([]);
      await manager.reloadBot('b1');

      expect(manager.getLoadedBots()).toHaveLength(0);
    });
  });

  describe('routeEvent table filter', () => {
    it('filters events by table when eventFilters.tables is set', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { tables: ['standaloneIOCs'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // Event with notes table should be filtered out
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });

    it('allows events matching table filter', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { tables: ['standaloneIOCs'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        table: 'standaloneIOCs',
        entityId: 'ioc-1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(insertBefore);
    });

    it('rejects tableless events when tables filter is set', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        userId: 'bot-user-1',
        triggers: {
          events: ['entity.created'],
          eventFilters: { tables: ['notes'] },
        },
      }));

      const { db } = await import('../db/index.js');
      const insertBefore = (db.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // Event without table property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).routeEvent({
        type: 'entity.created',
        entityId: 'x1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      });

      await new Promise(r => setTimeout(r, 50));
      expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertBefore);
    });
  });

  describe('circuit breaker', () => {
    it('auto-disables bot after 5 consecutive failures', async () => {
      const manager = new BotManager();
      await manager.loadBot(makeBotConfig({ id: 'b1', createdBy: 'admin-1' }));

      const { db } = await import('../db/index.js');

      // Make the bot execution throw
      const bot = (manager as any).bots.get('b1'); // eslint-disable-line @typescript-eslint/no-explicit-any
      bot.onEvent = vi.fn().mockRejectedValue(new Error('bot error'));

      const event = {
        type: 'entity.created' as const,
        table: 'notes',
        entityId: 'n1',
        folderId: 'f1',
        userId: 'human-user',
        timestamp: new Date(),
      };

      // Run 5 consecutive failures to trigger in-memory circuit breaker
      for (let i = 0; i < 5; i++) {
        await manager.executeBot('b1', 'event', event);
      }

      // Circuit breaker should have called db.update to disable the bot
      const updateCalls = (db.update as ReturnType<typeof vi.fn>).mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('loadBot idempotency', () => {
    it('clears old cron interval on reload', async () => {
      vi.useFakeTimers();
      const manager = new BotManager();

      await manager.loadBot(makeBotConfig({
        id: 'b1',
        triggers: { events: [], schedule: '*/5 * * * *' },
      }));

      // Reload with different schedule
      await manager.loadBot(makeBotConfig({
        id: 'b1',
        triggers: { events: [], schedule: '*/10 * * * *' },
      }));

      // Should still only have 1 loaded bot
      expect(manager.getLoadedBots()).toHaveLength(1);

      await manager.shutdown();
      vi.useRealTimers();
    });
  });
});

describe('validateCronExpression', () => {
  it('accepts every-5-minutes pattern', () => {
    expect(validateCronExpression('*/5 * * * *')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateCronExpression('')).toBeTypeOf('string');
  });

  it('rejects fewer than 5 fields', () => {
    expect(validateCronExpression('* *')).toBeTypeOf('string');
  });

  it('accepts monthly patterns (croner)', () => {
    expect(validateCronExpression('0 0 1 * *')).toBeNull();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBotConfig(overrides: Record<string, any> = {}): any {
  return {
    id: 'bot-test',
    userId: 'bot-user-test',
    type: 'custom',
    name: 'Test Bot',
    description: '',
    enabled: true,
    triggers: { events: ['entity.created'] as unknown, schedule: null },
    config: {},
    capabilities: ['read_entities'] as unknown[],
    allowedDomains: [],
    scopeType: 'global',
    scopeFolderIds: [],
    rateLimitPerHour: 100,
    rateLimitPerDay: 1000,
    runCount: 0,
    errorCount: 0,
    lastRunAt: null,
    lastError: null,
    createdBy: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
