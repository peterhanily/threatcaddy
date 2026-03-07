import type { Bot, BotConfig } from '../types.js';
import { EnrichmentBot } from './enrichment-bot.js';
import { MonitorBot } from './monitor-bot.js';
import { GenericBot } from './generic-bot.js';

export { GenericBot } from './generic-bot.js';
export { EnrichmentBot } from './enrichment-bot.js';
export { MonitorBot } from './monitor-bot.js';

/** Create a Bot implementation based on the config type. */
export function createBotImplementation(config: BotConfig): Bot {
  switch (config.type) {
    case 'enrichment': return new EnrichmentBot(config);
    case 'monitor': return new MonitorBot(config);
    default: return new GenericBot(config);
  }
}
