import { BotExecutionContext } from '../bot-context.js';
import type { Bot, BotConfig, BotContext, BotEvent, BotType } from '../types.js';

/**
 * GenericBot: base class for all bot implementations.
 * Implements the Bot interface and delegates to overridable handler methods
 * that receive a capability-gated BotExecutionContext.
 */
export class GenericBot implements Bot {
  readonly id: string;
  readonly name: string;
  readonly type: BotType;
  protected config: BotConfig;

  constructor(config: BotConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.config = config;
  }

  async onInit(config: BotConfig): Promise<void> {
    this.config = config;
  }

  async onDestroy(): Promise<void> {
    // no-op — subclasses can override
  }

  async onEvent(ctx: BotContext, event: BotEvent): Promise<void> {
    const execCtx = new BotExecutionContext(ctx);
    await this.handleEvent(execCtx, event);
  }

  async onSchedule(ctx: BotContext): Promise<void> {
    const execCtx = new BotExecutionContext(ctx);
    await this.handleSchedule(execCtx);
  }

  async onWebhook(ctx: BotContext, payload: Record<string, unknown>): Promise<void> {
    const execCtx = new BotExecutionContext(ctx);
    await this.handleWebhook(execCtx, payload);
  }

  // ─── Overridable Handlers ────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async handleEvent(execCtx: BotExecutionContext, event: BotEvent): Promise<void> {
    // no-op — subclasses override
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async handleSchedule(execCtx: BotExecutionContext): Promise<void> {
    // no-op — subclasses override
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async handleWebhook(execCtx: BotExecutionContext, payload: Record<string, unknown>): Promise<void> {
    // no-op — subclasses override
  }
}
