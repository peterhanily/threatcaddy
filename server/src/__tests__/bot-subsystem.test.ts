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
    it('encryptSecret returns string starting with enc:', () => {
      const result = encryptSecret('my-api-key-12345');
      expect(result.startsWith('enc:')).toBe(true);
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

    it('decryptSecret throws on malformed enc: string (wrong number of parts)', () => {
      expect(() => decryptSecret('enc:only-one-part')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc:a:b')).toThrow('Malformed encrypted secret');
      expect(() => decryptSecret('enc:a:b:c:d')).toThrow('Malformed encrypted secret');
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
        expect((result[key] as string).startsWith('enc:')).toBe(true);
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
      expect((result.apiKey as string).startsWith('enc:')).toBe(true);
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
      expect((nested.token as string).startsWith('enc:')).toBe(true);
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
      expect((result.password as string).startsWith('enc:')).toBe(true);
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
      const decrypted = decryptConfigSecrets(encrypted);

      expect(decrypted.apiKey).toBe('key123');
      expect(decrypted.name).toBe('My Bot');
      const nested = decrypted.nested as Record<string, unknown>;
      expect(nested.webhookSecret).toBe('sec456');
      expect(nested.url).toBe('https://example.com');
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
