import type { Bot, BotConfig } from '../types.js';
import { AgentBot } from './agent-bot.js';
import { EnrichmentBot } from './enrichment-bot.js';
import { IntegrationBot } from './integration-bot.js';
import { MonitorBot } from './monitor-bot.js';
import { GenericBot } from './generic-bot.js';

export { GenericBot } from './generic-bot.js';
export { EnrichmentBot } from './enrichment-bot.js';
export { IntegrationBot } from './integration-bot.js';
export { MonitorBot } from './monitor-bot.js';
export { AgentBot } from './agent-bot.js';

/** Create a Bot implementation based on the config type. */
export function createBotImplementation(config: BotConfig): Bot {
  switch (config.type) {
    case 'enrichment': return new EnrichmentBot(config);
    case 'integration': return new IntegrationBot(config);
    case 'monitor': return new MonitorBot(config);
    case 'ai-agent': return new AgentBot(config);
    default: return new GenericBot(config);
  }
}
