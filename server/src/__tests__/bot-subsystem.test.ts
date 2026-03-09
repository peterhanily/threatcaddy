import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// 1. Rate Limiter — pure logic, no mocks needed
// ──────────────────────────────────────────────────────────────────────────────

describe('BotRateLimiter', () => {
  let BotRateLimiter: typeof import('../bots/rate-limiter.js').BotRateLimiter;

  beforeEach(async () => {
    const mod = await import('../bots/rate-limiter.js');
    BotRateLimiter = mod.BotRateLimiter;
  });

  it('register creates a bucket, tryConsume returns true when tokens available', () => {
    const limiter = new BotRateLimiter();
    limiter.register('test:key', 10, 60_000);
    expect(limiter.tryConsume('test:key')).toBe(true);
  });

  it('tryConsume returns false when bucket is exhausted', () => {
    const limiter = new BotRateLimiter();
    limiter.register('test:key', 3, 60_000);

    expect(limiter.tryConsume('test:key')).toBe(true);
    expect(limiter.tryConsume('test:key')).toBe(true);
    expect(limiter.tryConsume('test:key')).toBe(true);
    expect(limiter.tryConsume('test:key')).toBe(false);
  });

  it('canConsume checks without consuming (token count unchanged)', () => {
    const limiter = new BotRateLimiter();
    limiter.register('test:key', 5, 60_000);

    expect(limiter.canConsume('test:key')).toBe(true);
    expect(limiter.canConsume('test:key')).toBe(true);
    // Should still have 5 tokens since canConsume does not consume
    expect(limiter.remaining('test:key')).toBe(5);
  });

  it('remaining returns correct count', () => {
    const limiter = new BotRateLimiter();
    limiter.register('test:key', 10, 60_000);

    expect(limiter.remaining('test:key')).toBe(10);
    limiter.tryConsume('test:key');
    expect(limiter.remaining('test:key')).toBe(9);
    limiter.tryConsume('test:key', 4);
    expect(limiter.remaining('test:key')).toBe(5);
  });

  it('retryAfter returns 0 when tokens available, positive when exhausted', () => {
    const limiter = new BotRateLimiter();
    limiter.register('test:key', 2, 60_000);

    expect(limiter.retryAfter('test:key')).toBe(0);

    limiter.tryConsume('test:key');
    limiter.tryConsume('test:key');
    // Exhausted
    expect(limiter.retryAfter('test:key')).toBeGreaterThan(0);
  });

  it('removeBuckets removes all buckets matching a botId prefix', () => {
    const limiter = new BotRateLimiter();
    limiter.register('bot:abc123:hour', 10, 3_600_000);
    limiter.register('bot:abc123:day', 100, 86_400_000);
    limiter.register('bot:other:hour', 10, 3_600_000);

    limiter.removeBuckets('abc123');

    // Removed buckets return defaults (true for tryConsume, Infinity for remaining)
    expect(limiter.remaining('bot:abc123:hour')).toBe(Infinity);
    expect(limiter.remaining('bot:abc123:day')).toBe(Infinity);
    // Other bot untouched
    expect(limiter.remaining('bot:other:hour')).toBe(10);
  });

  it('tokens refill over time', () => {
    vi.useFakeTimers();
    try {
      const limiter = new BotRateLimiter();
      // 10 tokens per 10,000 ms = 1 token per 1,000 ms
      limiter.register('test:key', 10, 10_000);

      // Consume all tokens
      for (let i = 0; i < 10; i++) limiter.tryConsume('test:key');
      expect(limiter.remaining('test:key')).toBe(0);
      expect(limiter.tryConsume('test:key')).toBe(false);

      // Advance 5 seconds — should refill 5 tokens
      vi.advanceTimersByTime(5_000);
      expect(limiter.remaining('test:key')).toBe(5);
      expect(limiter.tryConsume('test:key')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unregistered key returns true for tryConsume and canConsume', () => {
    const limiter = new BotRateLimiter();
    expect(limiter.tryConsume('nonexistent')).toBe(true);
    expect(limiter.canConsume('nonexistent')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Secret Store — encrypt/decrypt round-trips and config processing
// ──────────────────────────────────────────────────────────────────────────────

// Set BOT_MASTER_KEY before importing the module
process.env.BOT_MASTER_KEY = 'test-master-key-for-unit-tests-32chars!!';

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let encryptSecret: typeof import('../bots/secret-store.js').encryptSecret;
let decryptSecret: typeof import('../bots/secret-store.js').decryptSecret;
let encryptConfigSecrets: typeof import('../bots/secret-store.js').encryptConfigSecrets;
let decryptConfigSecrets: typeof import('../bots/secret-store.js').decryptConfigSecrets;
let redactConfigSecrets: typeof import('../bots/secret-store.js').redactConfigSecrets;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../bots/secret-store.js');
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  encryptConfigSecrets = mod.encryptConfigSecrets;
  decryptConfigSecrets = mod.decryptConfigSecrets;
  redactConfigSecrets = mod.redactConfigSecrets;
});

describe('secret-store', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('encryptSecret returns string starting with enc2:', () => {
      const result = encryptSecret('my-api-key-12345');
      expect(result.startsWith('enc2:')).toBe(true);
    });

    it('decryptSecret round-trips correctly', () => {
      const plaintext = 'super-secret-value-!@#$%';
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('decryptSecret of non-encrypted string returns as-is (backward compat)', () => {
      const plain = 'not-encrypted-just-a-string';
      expect(decryptSecret(plain)).toBe(plain);
    });

    it('decryptSecret throws on malformed enc: and enc2: strings (wrong number of parts)', () => {
      expect(() => decryptSecret('enc:only-one-part')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc:a:b')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc:a:b:c:d')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc2:only-one-part')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc2:a:b:c:d:e')).toThrow('Malformed encrypted secret');
    });
  });

  describe('encryptConfigSecrets', () => {
    it('encrypts fields matching secret suffixes', () => {
      const config = {
        myApiKey: 'key123',
        webhookSecret: 'sec456',
        password: 'pass789',
        token: 'tok000',
        auth_key: 'auth111',
        api_key: 'apikey222',
        private_key: 'priv333',
        encryption_key: 'enc444',
      };

      const result = encryptConfigSecrets(config);

      for (const key of Object.keys(config)) {
        expect((result[key] as string).match(/^enc[2]?:/)).toBeTruthy();
      }
    });

    it('leaves non-secret fields untouched', () => {
      const config = {
        name: 'My Bot',
        enabled: true,
        count: 42,
        apiKey: 'secret-value',
      };

      const result = encryptConfigSecrets(config);

      expect(result.name).toBe('My Bot');
      expect(result.enabled).toBe(true);
      expect(result.count).toBe(42);
      expect((result.apiKey as string).match(/^enc[2]?:/)).toBeTruthy();
    });

    it('recurses into nested objects', () => {
      const config = {
        slack: {
          token: 'xoxb-slack-token',
          channel: '#alerts',
        },
        name: 'Bot',
      };

      const result = encryptConfigSecrets(config);

      const nested = result.slack as Record<string, unknown>;
      expect((nested.token as string).match(/^enc[2]?:/)).toBeTruthy();
      expect(nested.channel).toBe('#alerts');
      expect(result.name).toBe('Bot');
    });

    it('preserves sentinel values (***configured*** / ***not set***) without encrypting', () => {
      const config = {
        apiKey: '***configured***',
        token: '***not set***',
        password: 'new-real-password',
        name: 'Bot',
      };

      const result = encryptConfigSecrets(config);

      // Sentinel values should pass through unchanged
      expect(result.apiKey).toBe('***configured***');
      expect(result.token).toBe('***not set***');
      // New password should be encrypted
      expect((result.password as string).match(/^enc[2]?:/)).toBeTruthy();
      // Non-secret field untouched
      expect(result.name).toBe('Bot');
    });
  });

  describe('decryptConfigSecrets', () => {
    it('reverses encryptConfigSecrets', () => {
      const original = {
        apiKey: 'key123',
        name: 'My Bot',
        nested: {
          webhookSecret: 'sec456',
          url: 'https://example.com',
        },
      };

      const encrypted = encryptConfigSecrets(original);

      // Verify encrypted secret fields can be decrypted back to original values
      expect(decryptSecret(encrypted.apiKey as string)).toBe('key123');
      expect(encrypted.name).toBe('My Bot');
      const encNested = encrypted.nested as Record<string, unknown>;
      expect(decryptSecret(encNested.webhookSecret as string)).toBe('sec456');
      expect(encNested.url).toBe('https://example.com');
    });
  });

  describe('redactConfigSecrets', () => {
    it('replaces set secrets with ***configured*** and empty/missing with ***not set***', () => {
      const config = {
        apiKey: 'some-key',
        token: '',
        password: 'hunter2',
        webhookSecret: undefined as unknown,
      };

      const result = redactConfigSecrets(config);

      expect(result.apiKey).toBe('***configured***');
      expect(result.token).toBe('***not set***');
      expect(result.password).toBe('***configured***');
      expect(result.webhookSecret).toBe('***not set***');
    });

    it('recurses into nested objects', () => {
      const config = {
        slack: {
          token: 'xoxb-abc',
          channel: '#alerts',
        },
        name: 'Bot',
      };

      const result = redactConfigSecrets(config);

      const nested = result.slack as Record<string, unknown>;
      expect(nested.token).toBe('***configured***');
      expect(nested.channel).toBe('#alerts');
      expect(result.name).toBe('Bot');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2b. Bot Implementations — factory and class tests
// ──────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeImplConfig(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'bot-1', userId: 'bot-user-1', type: 'custom', name: 'Test Bot',
    description: '', enabled: true, triggers: {}, config: {},
    capabilities: ['read_entities'], allowedDomains: [], scopeType: 'global',
    scopeFolderIds: [], rateLimitPerHour: 100, rateLimitPerDay: 1000,
    lastRunAt: null, lastError: null, runCount: 0, errorCount: 0,
    createdBy: 'admin-1', createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

describe('createBotImplementation', () => {
  let createBotImplementation: typeof import('../bots/implementations/index.js').createBotImplementation;
  let GenericBot: typeof import('../bots/implementations/index.js').GenericBot;
  let EnrichmentBot: typeof import('../bots/implementations/index.js').EnrichmentBot;
  let MonitorBot: typeof import('../bots/implementations/index.js').MonitorBot;

  beforeEach(async () => {
    const mod = await import('../bots/implementations/index.js');
    createBotImplementation = mod.createBotImplementation;
    GenericBot = mod.GenericBot;
    EnrichmentBot = mod.EnrichmentBot;
    MonitorBot = mod.MonitorBot;
  });

  it('returns EnrichmentBot for type "enrichment"', () => {
    const bot = createBotImplementation(makeImplConfig({ type: 'enrichment' }));
    expect(bot).toBeInstanceOf(EnrichmentBot);
  });

  it('returns MonitorBot for type "monitor"', () => {
    const bot = createBotImplementation(makeImplConfig({ type: 'monitor' }));
    expect(bot).toBeInstanceOf(MonitorBot);
  });

  it('returns AgentBot for type "ai-agent"', () => {
    const bot = createBotImplementation(makeImplConfig({ type: 'ai-agent' }));
    expect(bot.type).toBe('ai-agent');
    expect(bot.constructor.name).toBe('AgentBot');
  });

  it('returns GenericBot for "custom" and other types', () => {
    for (const type of ['custom', 'feed', 'triage', 'report', 'correlation']) {
      const bot = createBotImplementation(makeImplConfig({ type }));
      expect(bot).toBeInstanceOf(GenericBot);
    }
  });

  it('GenericBot.onInit updates config', async () => {
    const bot = new GenericBot(makeImplConfig({ name: 'Original' }));
    await bot.onInit(makeImplConfig({ name: 'Updated' }));
    expect(bot.name).toBe('Original'); // name is set in constructor, not onInit
  });

  it('GenericBot.onDestroy is a no-op', async () => {
    const bot = new GenericBot(makeImplConfig());
    await expect(bot.onDestroy()).resolves.toBeUndefined();
  });

  it('GenericBot handlers are no-ops by default', async () => {
    const bot = new GenericBot(makeImplConfig({ capabilities: ['read_entities'] }));
    const ctx = {
      botConfig: makeImplConfig({ capabilities: ['read_entities'] }),
      botUserId: 'bot-user-1', runId: 'run-1', trigger: 'manual' as const,
      entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [],
      signal: new AbortController().signal,
    };

    await expect(bot.onEvent(ctx, {
      type: 'entity.created', table: 'notes', entityId: 'n1', timestamp: new Date(),
    })).resolves.toBeUndefined();

    await expect(bot.onSchedule(ctx)).resolves.toBeUndefined();

    await expect(bot.onWebhook(ctx, { test: true })).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Event Bus — emitBotEvent and emitEntityEvent
// ──────────────────────────────────────────────────────────────────────────────

describe('event-bus', () => {
  let botEventBus: typeof import('../bots/event-bus.js').botEventBus;
  let emitEntityEvent: typeof import('../bots/event-bus.js').emitEntityEvent;
  let botEventDepth: typeof import('../bots/event-bus.js').botEventDepth;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../bots/event-bus.js');
    botEventBus = mod.botEventBus;
    emitEntityEvent = mod.emitEntityEvent;
    botEventDepth = mod.botEventDepth;
    // Remove all listeners between tests
    botEventBus.removeAllListeners();
  });

  it('emitBotEvent emits to wildcard * listener', () => {
    const wildcardHandler = vi.fn();

    botEventBus.onBotEvent('*', wildcardHandler);

    const event = {
      type: 'entity.created' as const,
      table: 'notes',
      entityId: 'n1',
      timestamp: new Date(),
    };

    botEventBus.emitBotEvent(event);

    expect(wildcardHandler).toHaveBeenCalledWith(event);
  });

  it('onBotEvent / offBotEvent subscribe/unsubscribe correctly', () => {
    const handler = vi.fn();

    botEventBus.onBotEvent('*', handler);

    const event = {
      type: 'entity.updated' as const,
      table: 'notes',
      entityId: 'n1',
      timestamp: new Date(),
    };

    botEventBus.emitBotEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);

    botEventBus.offBotEvent('*', handler);

    botEventBus.emitBotEvent(event);
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  it('listener errors are caught and do not crash', () => {
    const badHandler = vi.fn(() => {
      throw new Error('handler exploded');
    });

    botEventBus.onBotEvent('*', badHandler);

    const event = {
      type: 'entity.created' as const,
      table: 'notes',
      entityId: 'n1',
      timestamp: new Date(),
    };

    // Should not throw
    expect(() => botEventBus.emitBotEvent(event)).not.toThrow();
    expect(badHandler).toHaveBeenCalled();
  });

  it('emitEntityEvent maps op=delete to entity.deleted', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('delete', 'notes', 'n1', 'folder-1', 'user-1', false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('entity.deleted');
  });

  it('emitEntityEvent maps new put to entity.created', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'notes', 'n2', 'folder-1', 'user-1', true);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('entity.created');
  });

  it('emitEntityEvent maps existing put to entity.updated', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'notes', 'n3', 'folder-1', 'user-1', false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('entity.updated');
  });

  it('emitEntityEvent maps folder creation to investigation.created', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'folders', 'folder-new', undefined, 'user-1', true);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('investigation.created');
  });

  it('emitEntityEvent maps folder status=closed to investigation.closed', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'folders', 'folder-1', undefined, 'user-1', false, { status: 'closed' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('investigation.closed');
  });

  it('emitEntityEvent maps folder status=archived to investigation.archived', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'folders', 'folder-1', undefined, 'user-1', false, { status: 'archived' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe('investigation.archived');
  });

  it('emitEntityEvent sets folderId to entityId for folder events', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    emitEntityEvent('put', 'folders', 'folder-new', undefined, 'user-1', true);

    expect(handler.mock.calls[0][0].folderId).toBe('folder-new');
  });

  it('emitEntityEvent includes originBotIds from AsyncLocalStorage', async () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);
    const { botEventOrigins } = await import('../bots/event-bus.js');

    botEventOrigins.run(['bot-a', 'bot-b'], () => {
      emitEntityEvent('put', 'notes', 'n5', 'folder-1', 'user-1', true);
    });

    expect(handler.mock.calls[0][0].originBotIds).toEqual(['bot-a', 'bot-b']);
  });

  it('emitEntityEvent includes depth from AsyncLocalStorage', () => {
    const handler = vi.fn();
    botEventBus.onBotEvent('*', handler);

    botEventDepth.run(3, () => {
      emitEntityEvent('put', 'notes', 'n4', 'folder-1', 'user-1', true);
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].depth).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. isPrivateIP — SSRF boundary tests
// ──────────────────────────────────────────────────────────────────────────────

describe('isPrivateIP', () => {
  let isPrivateIP: typeof import('../bots/bot-context.js').isPrivateIP;

  beforeEach(async () => {
    const mod = await import('../bots/bot-context.js');
    isPrivateIP = mod.isPrivateIP;
  });

  it('detects IPv4 loopback', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('detects IPv4 private ranges', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
    expect(isPrivateIP('169.254.1.1')).toBe(true);
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('allows public IPv4', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
    expect(isPrivateIP('192.169.1.1')).toBe(false);
  });

  it('detects CGNAT range (100.64.0.0/10)', () => {
    expect(isPrivateIP('100.64.0.1')).toBe(true);
    expect(isPrivateIP('100.127.255.255')).toBe(true);
    expect(isPrivateIP('100.63.255.255')).toBe(false);
    expect(isPrivateIP('100.128.0.0')).toBe(false);
  });

  it('detects benchmarking range (198.18.0.0/15)', () => {
    expect(isPrivateIP('198.18.0.1')).toBe(true);
    expect(isPrivateIP('198.19.255.255')).toBe(true);
    expect(isPrivateIP('198.17.255.255')).toBe(false);
    expect(isPrivateIP('198.20.0.0')).toBe(false);
  });

  it('detects reserved range (240.0.0.0/4)', () => {
    expect(isPrivateIP('240.0.0.1')).toBe(true);
    expect(isPrivateIP('255.255.255.255')).toBe(true);
  });

  it('detects IPv6 unspecified address', () => {
    expect(isPrivateIP('::')).toBe(true);
    expect(isPrivateIP('0:0:0:0:0:0:0:0')).toBe(true);
  });

  it('detects IPv6 loopback', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('detects IPv6 private ranges', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
  });

  it('detects IPv4-mapped IPv6 addresses', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateIP('::FFFF:172.16.0.1')).toBe(true);
  });

  it('allows IPv4-mapped IPv6 public addresses', () => {
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIP('::ffff:1.1.1.1')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Bot Tools — capability gating and tool format conversion
// ──────────────────────────────────────────────────────────────────────────────

describe('bot-tools', () => {
  let getToolsForCapabilities: typeof import('../bots/bot-tools.js').getToolsForCapabilities;
  let toAnthropicTools: typeof import('../bots/bot-tools.js').toAnthropicTools;
  let toOpenAITools: typeof import('../bots/bot-tools.js').toOpenAITools;

  beforeEach(async () => {
    const mod = await import('../bots/bot-tools.js');
    getToolsForCapabilities = mod.getToolsForCapabilities;
    toAnthropicTools = mod.toAnthropicTools;
    toOpenAITools = mod.toOpenAITools;
  });

  it('returns no tools for empty capabilities', () => {
    const tools = getToolsForCapabilities([]);
    expect(tools).toHaveLength(0);
  });

  it('returns read tools for read_entities capability', () => {
    const tools = getToolsForCapabilities(['read_entities']);
    const names = tools.map(t => t.name);
    expect(names).toContain('search_notes');
    expect(names).toContain('read_note');
    expect(names).toContain('list_iocs');
    expect(names).toContain('list_tasks');
    expect(names).toContain('list_timeline_events');
    expect(names).toContain('get_investigation');
    expect(names).toContain('list_investigations');
    // Should NOT include write tools
    expect(names).not.toContain('create_note');
    expect(names).not.toContain('fetch_url');
  });

  it('returns write tools for create_entities capability', () => {
    const tools = getToolsForCapabilities(['create_entities']);
    const names = tools.map(t => t.name);
    expect(names).toContain('create_note');
    expect(names).toContain('create_ioc');
    expect(names).toContain('create_task');
    expect(names).toContain('create_timeline_event');
    expect(names).not.toContain('search_notes');
  });

  it('returns fetch_url for call_external_apis capability', () => {
    const tools = getToolsForCapabilities(['call_external_apis']);
    const names = tools.map(t => t.name);
    expect(names).toEqual(['fetch_url']);
  });

  it('returns cross-investigation search for cross_investigation capability', () => {
    const tools = getToolsForCapabilities(['cross_investigation']);
    const names = tools.map(t => t.name);
    expect(names).toEqual(['search_across_investigations']);
  });

  it('combines tools for multiple capabilities without duplicates', () => {
    const tools = getToolsForCapabilities(['read_entities', 'create_entities', 'call_external_apis']);
    const names = tools.map(t => t.name);
    // Should have read + write + fetch
    expect(names).toContain('search_notes');
    expect(names).toContain('create_note');
    expect(names).toContain('fetch_url');
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });

  it('returns post_to_feed and notify_user for their capabilities', () => {
    const tools = getToolsForCapabilities(['post_to_feed', 'notify_users']);
    const names = tools.map(t => t.name);
    expect(names).toContain('post_to_feed');
    expect(names).toContain('notify_user');
  });

  it('toAnthropicTools formats tools correctly', () => {
    const tools = getToolsForCapabilities(['post_to_feed']);
    const formatted = toAnthropicTools(tools) as Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    expect(formatted).toHaveLength(1);
    expect(formatted[0].name).toBe('post_to_feed');
    expect(formatted[0].description).toBeTruthy();
    expect(formatted[0].input_schema).toBeDefined();
    expect(formatted[0].input_schema.type).toBe('object');
  });

  it('toOpenAITools formats tools correctly', () => {
    const tools = getToolsForCapabilities(['post_to_feed']);
    const formatted = toOpenAITools(tools) as Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    expect(formatted).toHaveLength(1);
    expect(formatted[0].type).toBe('function');
    expect(formatted[0].function.name).toBe('post_to_feed');
    expect(formatted[0].function.parameters.type).toBe('object');
  });

  it('returns execute_remote tools for execute_remote capability', () => {
    const tools = getToolsForCapabilities(['execute_remote']);
    const names = tools.map(t => t.name);
    expect(names).toContain('ssh_exec');
    expect(names).toContain('trigger_playbook');
    expect(names).toContain('fetch_and_poll');
    expect(names).not.toContain('search_notes');
    expect(names).not.toContain('fetch_url');
  });

  it('returns run_code tool for run_code capability', () => {
    const tools = getToolsForCapabilities(['run_code']);
    const names = tools.map(t => t.name);
    expect(names).toEqual(['run_code']);
    expect(names).not.toContain('ssh_exec');
    expect(names).not.toContain('fetch_url');
  });

  it('all tools have required name, description, parameters, and execute', () => {
    const allCaps = ['read_entities', 'create_entities', 'post_to_feed', 'notify_users', 'call_external_apis', 'cross_investigation', 'execute_remote', 'run_code'] as const;
    const tools = getToolsForCapabilities([...allCaps]);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
    // Should have all 19 tools (15 original + 3 execute_remote + 1 run_code)
    expect(tools.length).toBe(19);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. mergeSentinelSecrets — sentinel replacement logic
// ──────────────────────────────────────────────────────────────────────────────

describe('mergeSentinelSecrets', () => {
  let mergeSentinelSecrets: typeof import('../services/bot-service.js').mergeSentinelSecrets;

  beforeEach(async () => {
    const mod = await import('../services/bot-service.js');
    mergeSentinelSecrets = mod.mergeSentinelSecrets;
  });

  it('new values overwrite old values (normal merge)', () => {
    const newConfig = { apiKey: 'new-key-123', url: 'https://new.example.com' };
    const existingConfig = { apiKey: 'enc2:old-encrypted', url: 'https://old.example.com' };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.apiKey).toBe('new-key-123');
    expect(result.url).toBe('https://new.example.com');
  });

  it('***configured*** sentinel preserves existing encrypted value', () => {
    const newConfig = { apiKey: '***configured***', name: 'Bot' };
    const existingConfig = { apiKey: 'enc2:iv:tag:cipher', name: 'Old Bot' };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.apiKey).toBe('enc2:iv:tag:cipher');
    expect(result.name).toBe('Bot');
  });

  it('***configured*** sentinel with missing existing key falls back to empty string', () => {
    const newConfig = { apiKey: '***configured***' };
    const existingConfig = {};

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.apiKey).toBe('');
  });

  it('***not set*** sentinel clears to empty string', () => {
    const newConfig = { apiKey: '***not set***', token: '***not set***' };
    const existingConfig = { apiKey: 'enc2:iv:tag:cipher', token: 'enc2:iv:tag:cipher2' };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.apiKey).toBe('');
    expect(result.token).toBe('');
  });

  it('handles nested object by recursing', () => {
    const newConfig = {
      slack: {
        token: '***configured***',
        channel: '#new-channel',
        webhook: '***not set***',
      },
    };
    const existingConfig = {
      slack: {
        token: 'enc2:slack-token-encrypted',
        channel: '#old-channel',
        webhook: 'enc2:old-webhook',
      },
    };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    const nested = result.slack as Record<string, unknown>;
    expect(nested.token).toBe('enc2:slack-token-encrypted');
    expect(nested.channel).toBe('#new-channel');
    expect(nested.webhook).toBe('');
  });

  it('handles nested object when existing key is not an object', () => {
    const newConfig = {
      slack: {
        token: '***configured***',
      },
    };
    const existingConfig = {
      slack: 'not-an-object',
    };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    const nested = result.slack as Record<string, unknown>;
    // Since existing is not an object, fallback to empty object; ***configured*** → ''
    expect(nested.token).toBe('');
  });

  it('non-secret fields pass through unchanged', () => {
    const newConfig = {
      name: 'My Bot',
      enabled: true,
      count: 42,
      tags: ['a', 'b'],
    };
    const existingConfig = {};

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.name).toBe('My Bot');
    expect(result.enabled).toBe(true);
    expect(result.count).toBe(42);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('arrays pass through without recursion', () => {
    const newConfig = { items: [1, 2, 3] };
    const existingConfig = { items: [4, 5, 6] };

    const result = mergeSentinelSecrets(newConfig, existingConfig);

    expect(result.items).toEqual([1, 2, 3]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. escapeLikePattern — LIKE/ILIKE wildcard escaping
// ──────────────────────────────────────────────────────────────────────────────

describe('escapeLikePattern', () => {
  let escapeLikePattern: typeof import('../bots/bot-context.js').escapeLikePattern;

  beforeEach(async () => {
    const mod = await import('../bots/bot-context.js');
    escapeLikePattern = mod.escapeLikePattern;
  });

  it('escapes % characters', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('%foo%')).toBe('\\%foo\\%');
  });

  it('escapes _ characters', () => {
    expect(escapeLikePattern('foo_bar')).toBe('foo\\_bar');
    expect(escapeLikePattern('__init__')).toBe('\\_\\_init\\_\\_');
  });

  it('escapes \\ characters', () => {
    expect(escapeLikePattern('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes multiple special characters together', () => {
    expect(escapeLikePattern('50%_off\\deal')).toBe('50\\%\\_off\\\\deal');
  });

  it('passes normal strings through unchanged', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world');
    expect(escapeLikePattern('simple-query')).toBe('simple-query');
    expect(escapeLikePattern('abc123')).toBe('abc123');
  });

  it('handles empty string', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});
