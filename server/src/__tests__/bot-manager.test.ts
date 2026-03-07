import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: mockSelectResolve,
          }),
          returning: vi.fn().mockResolvedValue([]),
          limit: mockSelectResolve,
        }),
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

  it('rejects unsupported patterns', () => {
    expect(validateCronExpression('0 0 1 * *')).toBeTypeOf('string');
  });
});

// ─── Helpers ──────────────────────────────────────────────────────

function makeBotConfig(overrides: Partial<any> = {}): any {
  return {
    id: 'bot-test',
    userId: 'bot-user-test',
    type: 'custom',
    name: 'Test Bot',
    description: '',
    enabled: true,
    triggers: { events: ['entity.created'] as any, schedule: null },
    config: {},
    capabilities: ['read_entities'] as any[],
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
