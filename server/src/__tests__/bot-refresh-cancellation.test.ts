import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, BotConfig } from '../bots/types.js';
const state = vi.hoisted(() => ({ bot: undefined as unknown, read: vi.fn() }));
vi.mock('../db/index.js', () => ({ db: { select: () => ({ from: () => ({ where: state.read }) }) } }));
vi.mock('../bots/implementations/index.js', () => ({ createBotImplementation: () => state.bot }));
vi.mock('../bots/secret-store.js', () => ({ decryptConfigSecrets: (config: unknown) => config }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn() }));
vi.mock('../services/notification-service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { BotManager } from '../bots/bot-manager.js';
const config = { id: 'fixture', name: 'Fictional observer', type: 'monitor', enabled: true, config: {}, triggers: {},
  capabilities: ['read_entities'], rateLimitPerHour: 10, rateLimitPerDay: 100 } as BotConfig;
let bot: Bot;
beforeEach(() => {
  bot = { id: config.id, name: config.name, type: 'monitor', onInit: vi.fn().mockResolvedValue(undefined), onDestroy: vi.fn().mockResolvedValue(undefined) } as unknown as Bot;
  state.bot = bot; state.read.mockReset();
});

describe('bounded bot refresh lifecycle', () => {
  it('never initializes a pre-aborted reload', async () => {
    const manager = new BotManager(); const controller = new AbortController(); controller.abort();
    await expect(manager.reloadBot(config.id, config, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bot.onInit).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
  });
  it('does not publish late initialization after its refresh was cancelled', async () => {
    const manager = new BotManager(); const controller = new AbortController();
    let initialized!: () => void;
    vi.mocked(bot.onInit).mockReturnValue(new Promise<void>(resolve => { initialized = resolve; }));
    const loading = manager.loadBot(config, { signal: controller.signal });
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(bot.onInit).toHaveBeenCalled());
    controller.abort(); await rejected;
    initialized(); await vi.waitFor(() => expect(bot.onDestroy).toHaveBeenCalledOnce());
    expect(manager.getLoadedBots()).toEqual([]);
    expect(manager.getStats()).toMatchObject({ loadedBots: 0, activeRuns: 0 });
    await manager.shutdown();
  });
  it('removes loaded state immediately even if destruction hangs beyond cancellation', async () => {
    const manager = new BotManager(); await manager.loadBot(config);
    let destroyed!: () => void;
    vi.mocked(bot.onDestroy).mockReturnValue(new Promise<void>(resolve => { destroyed = resolve; }));
    const controller = new AbortController();
    const unloading = manager.unloadBot(config.id, { signal: controller.signal });
    const rejected = expect(unloading).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.getLoadedBots()).toEqual([]);
    controller.abort(); await rejected; destroyed(); await manager.shutdown();
  });
  it('does not load a late database result after cancellation', async () => {
    const manager = new BotManager(); const controller = new AbortController();
    let read!: (rows: BotConfig[]) => void;
    state.read.mockReturnValue(new Promise(resolve => { read = resolve; }));
    const loading = manager.reloadBot(config.id, undefined, { signal: controller.signal });
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(state.read).toHaveBeenCalled());
    controller.abort(); await rejected; read([config]); await Promise.resolve();
    expect(bot.onInit).not.toHaveBeenCalled(); expect(manager.getLoadedBots()).toEqual([]);
    await manager.shutdown();
  });
  it('does not reactivate a stale enabled snapshot after a newer unload supersedes the reload', async () => {
    const manager = new BotManager();
    let read!: (rows: BotConfig[]) => void;
    state.read.mockReturnValue(new Promise(resolve => { read = resolve; }));
    const loading = manager.reloadBot(config.id);
    await vi.waitFor(() => expect(state.read).toHaveBeenCalled());
    await manager.unloadBot(config.id);
    read([config]); await loading;
    expect(bot.onInit).not.toHaveBeenCalled(); expect(manager.getLoadedBots()).toEqual([]);
    await manager.shutdown();
  });
});
