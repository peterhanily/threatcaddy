import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, BotConfig, BotContext } from '../bots/types.js';
const state = vi.hoisted(() => ({ insert: vi.fn(), updates: [] as Record<string, unknown>[], bots: new Map<string, Bot>() }));
vi.mock('../db/index.js', () => ({ db: {
  insert: () => ({ values: state.insert }),
  update: () => ({ set: (values: Record<string, unknown>) => { state.updates.push(values); return { where: () => Promise.resolve([]) }; } }),
} }));
vi.mock('../bots/implementations/index.js', () => ({ createBotImplementation: (config: BotConfig) => state.bots.get(config.id) }));
vi.mock('../bots/secret-store.js', () => ({ decryptConfigSecrets: (config: unknown) => config }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/notification-service.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { BotManager } from '../bots/bot-manager.js';
function fixture(id: string, manual = vi.fn().mockResolvedValue(undefined)) {
  const bot = { id, name: id, type: 'monitor', onInit: vi.fn().mockResolvedValue(undefined), onDestroy: vi.fn().mockResolvedValue(undefined), onManual: manual } as Bot;
  state.bots.set(id, bot);
  const config = { id, name: id, type: 'monitor', enabled: true, config: {}, triggers: {}, userId: `${id}-user`,
    capabilities: ['read_entities'], rateLimitPerHour: 100, rateLimitPerDay: 1000, runCount: 0, errorCount: 0 } as BotConfig;
  return { bot, config };
}
beforeEach(() => { state.insert.mockResolvedValue(undefined); state.updates.length = 0; state.bots.clear(); });

describe('bot runtime lifecycle', () => {
  it('dispatches a manual request to its handler before recording success', async () => {
    const manager = new BotManager();
    const { bot, config } = fixture('manual');
    await manager.loadBot(config);
    await manager.executeBot(config.id, 'manual');
    expect(bot.onManual).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual(expect.objectContaining({ status: 'success' }));
    await manager.shutdown();
  });

  it('cancels queued work on unload and settles all waiters on shutdown without negative accounting', async () => {
    const manager = new BotManager();
    const work: Promise<void>[] = [];
    for (let index = 0; index < 10; index++) {
      const { config } = fixture(`active-${index}`, vi.fn().mockImplementation((ctx: BotContext) => new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
      })));
      await manager.loadBot(config);
      work.push(manager.executeBot(config.id, 'manual'));
    }
    await vi.waitFor(() => expect(manager.getStats().activeRuns).toBe(10));
    const queued = fixture('queued');
    await manager.loadBot(queued.config);
    const queuedWork = manager.executeBot('queued', 'manual');
    expect(manager.getStats().queueSize).toBe(1);
    await manager.unloadBot('queued');
    await queuedWork;
    expect(queued.bot.onManual).not.toHaveBeenCalled();
    await manager.shutdown();
    await Promise.all(work);
    expect(manager.getStats()).toMatchObject({ activeRuns: 0, queueSize: 0, loadedBots: 0 });
    expect(state.updates.filter(update => update.status === 'cancelled')).toHaveLength(10);
    expect(state.updates.some(update => update.status === 'timeout')).toBe(false);
  });

  it('does not publish a bot whose asynchronous initialization was superseded by unload', async () => {
    const manager = new BotManager();
    const { config, bot } = fixture('initializing');
    let ready!: () => void;
    vi.mocked(bot.onInit).mockReturnValue(new Promise(resolve => { ready = resolve; }));
    const loading = manager.loadBot(config);
    await vi.waitFor(() => expect(bot.onInit).toHaveBeenCalled());
    await manager.unloadBot(config.id);
    ready();
    await loading;
    expect(manager.getLoadedBots()).toEqual([]);
    expect(bot.onDestroy).toHaveBeenCalledTimes(1);
    await manager.shutdown();
  });
});
