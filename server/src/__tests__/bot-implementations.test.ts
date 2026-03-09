import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vi.hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockProcessPush,
  mockLookupEntityFolderId,
  mockBroadcastToFolder,
  mockLogActivity,
  mockCreateNotification,
  mockLogger,
  mockDb,
  selectQueue,
  mockIntegrationExecutor,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

  function makeThenableChain(queue: unknown[]) {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      const val = queue.shift();
      return val instanceof Error ? Promise.reject(val) : Promise.resolve(val ?? []);
    };
    for (const method of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning', 'groupBy']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected);
    chain.catch = (onRejected?: (e: unknown) => unknown) => resolve().catch(onRejected);
    return chain;
  }

  return {
    selectQueue,
    mockProcessPush: vi.fn().mockResolvedValue([{ status: 'accepted', serverVersion: 1, serverRecord: {} }]),
    mockLookupEntityFolderId: vi.fn().mockResolvedValue(undefined),
    mockBroadcastToFolder: vi.fn(),
    mockLogActivity: vi.fn().mockResolvedValue(undefined),
    mockCreateNotification: vi.fn().mockResolvedValue(undefined),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockDb: {
      select: vi.fn(() => makeThenableChain(selectQueue)),
      insert: vi.fn(() => makeThenableChain([])),
      delete: vi.fn(() => makeThenableChain([])),
    },
    mockIntegrationExecutor: {
      run: vi.fn().mockResolvedValue({ status: 'success', durationMs: 100, entitiesCreated: 0, apiCallsMade: 0 }),
    },
  };
});

vi.mock('../services/sync-service.js', () => ({
  processPush: mockProcessPush,
  lookupEntityFolderId: mockLookupEntityFolderId,
}));
vi.mock('../ws/handler.js', () => ({ broadcastToFolder: mockBroadcastToFolder }));
vi.mock('../services/audit-service.js', () => ({ logActivity: mockLogActivity }));
vi.mock('../services/notification-service.js', () => ({ createNotification: mockCreateNotification }));
vi.mock('../lib/logger.js', () => ({ logger: mockLogger }));
vi.mock('../db/index.js', () => ({ db: mockDb }));
vi.mock('../db/schema.js', () => ({
  notes: { id: 'id', folderId: 'folderId', title: 'title', content: 'content', trashed: 'trashed', deletedAt: 'deletedAt' },
  tasks: { id: 'id', folderId: 'folderId', status: 'status', trashed: 'trashed', deletedAt: 'deletedAt' },
  standaloneIOCs: { id: 'id', folderId: 'folderId', type: 'type', value: 'value', trashed: 'trashed', deletedAt: 'deletedAt' },
  timelineEvents: { id: 'id', folderId: 'folderId', trashed: 'trashed', deletedAt: 'deletedAt' },
  folders: { id: 'id', deletedAt: 'deletedAt' },
  posts: {},
}));

// Mock the sandbox module (used by bot-context for run_code)
vi.mock('../bots/sandbox.js', () => ({
  executeCode: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 100 }),
}));

// Mock dns for bot-context
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue({ address: '1.2.3.4', family: 4 }),
}));

vi.mock('ssh2', () => ({
  Client: vi.fn().mockImplementation(() => ({ on: vi.fn(), connect: vi.fn(), end: vi.fn() })),
}));

vi.mock('../../services/integration-executor.js', () => ({
  IntegrationExecutor: vi.fn().mockImplementation(() => mockIntegrationExecutor),
}));

import type { BotConfig, BotContext, BotEvent } from '../bots/types.js';
import { GenericBot } from '../bots/implementations/generic-bot.js';
import { EnrichmentBot } from '../bots/implementations/enrichment-bot.js';
import { MonitorBot } from '../bots/implementations/monitor-bot.js';
import { createBotImplementation } from '../bots/implementations/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: 'bot-1',
    userId: 'bot-user-1',
    type: 'custom',
    name: 'Test Bot',
    description: 'A test bot',
    enabled: true,
    triggers: { events: ['entity.created'] },
    config: {},
    capabilities: ['read_entities', 'create_entities', 'update_entities'],
    allowedDomains: ['example.com'],
    scopeType: 'global',
    scopeFolderIds: [],
    rateLimitPerHour: 100,
    rateLimitPerDay: 1000,
    lastRunAt: null,
    lastError: null,
    runCount: 0,
    errorCount: 0,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeContext(config: BotConfig): BotContext {
  return {
    botConfig: config,
    botUserId: config.userId,
    runId: 'run-1',
    trigger: 'event',
    entitiesCreated: 0,
    entitiesUpdated: 0,
    apiCallsMade: 0,
    log: [],
    signal: new AbortController().signal,
  };
}

function makeEvent(overrides: Partial<BotEvent> = {}): BotEvent {
  return {
    type: 'entity.created',
    table: 'standaloneIOCs',
    entityId: 'ioc-1',
    folderId: 'folder-1',
    userId: 'user-1',
    data: { type: 'ip', value: '1.2.3.4', folderId: 'folder-1' },
    timestamp: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Bot Implementations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  describe('GenericBot', () => {
    it('can be initialized with a config', async () => {
      const config = makeConfig();
      const bot = new GenericBot(config);
      expect(bot.id).toBe('bot-1');
      expect(bot.name).toBe('Test Bot');
      expect(bot.type).toBe('custom');
    });

    it('onEvent creates execution context and calls handleEvent', async () => {
      const config = makeConfig();
      const bot = new GenericBot(config);
      const ctx = makeContext(config);
      const event = makeEvent();

      // Should not throw — GenericBot.handleEvent is a no-op
      await bot.onEvent(ctx, event);
    });

    it('onSchedule creates execution context and calls handleSchedule', async () => {
      const config = makeConfig();
      const bot = new GenericBot(config);
      const ctx = makeContext(config);

      await bot.onSchedule(ctx);
    });

    it('onWebhook creates execution context and calls handleWebhook', async () => {
      const config = makeConfig();
      const bot = new GenericBot(config);
      const ctx = makeContext(config);

      await bot.onWebhook(ctx, { foo: 'bar' });
    });

    it('onInit updates the internal config', async () => {
      const config = makeConfig();
      const bot = new GenericBot(config);
      const newConfig = makeConfig({ name: 'Updated Bot' });
      await bot.onInit(newConfig);
      expect(bot.name).toBe('Test Bot'); // name is set in constructor, not onInit
    });

    it('onDestroy is a no-op', async () => {
      const bot = new GenericBot(makeConfig());
      await bot.onDestroy(); // should not throw
    });
  });

  describe('EnrichmentBot', () => {
    it('only handles entity.created events for standaloneIOCs', async () => {
      const config = makeConfig({ type: 'enrichment' });
      const bot = new EnrichmentBot(config);
      const ctx = makeContext(config);

      // Non-IOC event should be ignored (no processPush call)
      const noteEvent = makeEvent({ type: 'entity.created', table: 'notes' });
      await bot.onEvent(ctx, noteEvent);
      expect(mockProcessPush).not.toHaveBeenCalled();

      // entity.updated should be ignored
      const updateEvent = makeEvent({ type: 'entity.updated' });
      await bot.onEvent(ctx, updateEvent);
      expect(mockProcessPush).not.toHaveBeenCalled();
    });

    it('creates enrichment note for standaloneIOC create events', async () => {
      const config = makeConfig({
        type: 'enrichment',
        capabilities: ['read_entities', 'create_entities', 'call_external_apis'],
        config: {},
      });
      const bot = new EnrichmentBot(config);
      const ctx = makeContext(config);
      const event = makeEvent();

      // processPush called to create the enrichment note
      mockProcessPush.mockResolvedValueOnce([{ status: 'accepted', serverVersion: 1, serverRecord: {} }]);
      await bot.onEvent(ctx, event);

      // Should have called processPush to create a note
      expect(mockProcessPush).toHaveBeenCalledTimes(1);
    });

    it('logs warning when folderId is missing', async () => {
      const config = makeConfig({ type: 'enrichment' });
      const bot = new EnrichmentBot(config);
      const ctx = makeContext(config);
      const event = makeEvent({ folderId: undefined });

      await bot.onEvent(ctx, event);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('MonitorBot', () => {
    it('lists investigations and creates summary on schedule', async () => {
      const config = makeConfig({
        type: 'monitor',
        capabilities: ['read_entities', 'create_entities'],
      });
      const bot = new MonitorBot(config);
      const ctx = makeContext(config);

      // Mock listing investigations — return one folder
      selectQueue.push([{ id: 'folder-1', name: 'Test Investigation', deletedAt: null }]);
      // Mock batch-listing IOCs (includes folderId for in-memory grouping)
      selectQueue.push([{ id: 'ioc-1', folderId: 'folder-1' }]);
      // Mock batch-listing tasks (includes folderId for in-memory grouping)
      selectQueue.push([{ id: 'task-1', folderId: 'folder-1' }, { id: 'task-2', folderId: 'folder-1' }]);

      await bot.onSchedule(ctx);

      // Should have created a note (via processPush)
      expect(mockProcessPush).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no investigations in scope', async () => {
      const config = makeConfig({ type: 'monitor', capabilities: ['read_entities'] });
      const bot = new MonitorBot(config);
      const ctx = makeContext(config);

      // No investigations
      selectQueue.push([]);

      await bot.onSchedule(ctx);
      expect(mockProcessPush).not.toHaveBeenCalled();
    });
  });

  describe('createBotImplementation()', () => {
    it('creates EnrichmentBot for type=enrichment', () => {
      const bot = createBotImplementation(makeConfig({ type: 'enrichment' }));
      expect(bot).toBeInstanceOf(EnrichmentBot);
    });

    it('creates MonitorBot for type=monitor', () => {
      const bot = createBotImplementation(makeConfig({ type: 'monitor' }));
      expect(bot).toBeInstanceOf(MonitorBot);
    });

    it('creates GenericBot for unknown types', () => {
      const bot = createBotImplementation(makeConfig({ type: 'custom' }));
      expect(bot).toBeInstanceOf(GenericBot);
    });

    it('creates GenericBot for type=feed', () => {
      const bot = createBotImplementation(makeConfig({ type: 'feed' }));
      expect(bot).toBeInstanceOf(GenericBot);
    });
  });

  describe('Rate limit enforcement per bot', () => {
    it('bot rate limiter respects configured limits', async () => {
      // This tests the BotRateLimiter in isolation since it's used by bot-manager
      const { BotRateLimiter } = await import('../bots/rate-limiter.js');
      const limiter = new BotRateLimiter();

      limiter.register('bot:bot-1:hour', 2, 3600_000);

      expect(limiter.tryConsume('bot:bot-1:hour')).toBe(true);
      expect(limiter.tryConsume('bot:bot-1:hour')).toBe(true);
      expect(limiter.tryConsume('bot:bot-1:hour')).toBe(false);

      limiter.destroy();
    });
  });
});
