import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks for bot-manager.ts dependencies ─────────────────────

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

const col = (n: string) => ({ name: n });
vi.mock('../db/schema.js', () => ({
  botConfigs: { id: col('id'), enabled: col('enabled'), runCount: col('run_count'), errorCount: col('error_count') },
  botRuns: { id: col('id'), botConfigId: col('bot_config_id'), status: col('status') },
  notes: { id: col('id'), folderId: col('folder_id'), title: col('title'), content: col('content'), tags: col('tags'), trashed: col('trashed'), deletedAt: col('deleted_at'), createdAt: col('created_at'), updatedAt: col('updated_at') },
  tasks: { id: col('id'), folderId: col('folder_id'), status: col('status'), trashed: col('trashed'), deletedAt: col('deleted_at') },
  folders: { id: col('id'), name: col('name'), deletedAt: col('deleted_at') },
  tags: { id: col('id') },
  timelineEvents: { id: col('id'), folderId: col('folder_id'), trashed: col('trashed'), deletedAt: col('deleted_at') },
  timelines: { id: col('id') },
  whiteboards: { id: col('id') },
  standaloneIOCs: { id: col('id'), folderId: col('folder_id'), type: col('type'), value: col('value'), trashed: col('trashed'), deletedAt: col('deleted_at') },
  chatThreads: { id: col('id') },
  posts: { id: col('id') },
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
  processPush: vi.fn().mockResolvedValue([{ status: 'accepted', serverRecord: {} }]),
  lookupEntityFolderId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/notification-service.js', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ws/handler.js', () => ({
  broadcastToFolder: vi.fn(),
}));

// ─── Section 1: validateCronExpression ──────────────────────────

let validateCronExpression: (cron: string) => string | null;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../bots/bot-manager.js');
  validateCronExpression = mod.validateCronExpression;
});

describe('validateCronExpression', () => {
  describe('valid expressions (should return null)', () => {
    it('every 5 minutes: */5 * * * *', () => {
      expect(validateCronExpression('*/5 * * * *')).toBeNull();
    });

    it('every 30 minutes: */30 * * * *', () => {
      expect(validateCronExpression('*/30 * * * *')).toBeNull();
    });

    it('every 6 hours: 0 */6 * * *', () => {
      expect(validateCronExpression('0 */6 * * *')).toBeNull();
    });

    it('every hour: 0 */1 * * *', () => {
      expect(validateCronExpression('0 */1 * * *')).toBeNull();
    });

    it('daily at midnight: 0 0 * * *', () => {
      expect(validateCronExpression('0 0 * * *')).toBeNull();
    });

    it('hourly at minute 30: 30 * * * *', () => {
      expect(validateCronExpression('30 * * * *')).toBeNull();
    });

    it('daily at 8am: 0 8 * * *', () => {
      expect(validateCronExpression('0 8 * * *')).toBeNull();
    });
  });

  describe('invalid expressions (should return error string)', () => {
    it('rejects "bad" (too few fields)', () => {
      const result = validateCronExpression('bad');
      expect(result).toBeTypeOf('string');
      expect(result).not.toBeNull();
    });

    it('rejects "* * *" (too few fields)', () => {
      const result = validateCronExpression('* * *');
      expect(result).toBeTypeOf('string');
      expect(result).not.toBeNull();
    });

    it('rejects "*/0 * * * *" (invalid interval)', () => {
      const result = validateCronExpression('*/0 * * * *');
      expect(result).toBeTypeOf('string');
      expect(result).not.toBeNull();
    });

    it('rejects empty string', () => {
      const result = validateCronExpression('');
      expect(result).toBeTypeOf('string');
      expect(result).not.toBeNull();
    });

    it('rejects whitespace only', () => {
      const result = validateCronExpression('   ');
      expect(result).toBeTypeOf('string');
      expect(result).not.toBeNull();
    });
  });
});

// ─── Section 2: Cron expression validation (croner) ──

describe('cron expression validation (croner)', () => {
  it('valid minute intervals return null', () => {
    expect(validateCronExpression('*/1 * * * *')).toBeNull();
    expect(validateCronExpression('*/10 * * * *')).toBeNull();
    expect(validateCronExpression('*/60 * * * *')).toBeNull();
  });

  it('valid hourly intervals return null', () => {
    expect(validateCronExpression('0 */2 * * *')).toBeNull();
    expect(validateCronExpression('0 */12 * * *')).toBeNull();
    expect(validateCronExpression('0 */24 * * *')).toBeNull();
  });

  it('specific hour patterns return null (daily)', () => {
    expect(validateCronExpression('15 3 * * *')).toBeNull();
    expect(validateCronExpression('0 23 * * *')).toBeNull();
  });

  it('complex patterns now supported via croner', () => {
    // croner supports full cron syntax including day-of-week and monthly
    expect(validateCronExpression('* * * * 1')).toBeNull();
    expect(validateCronExpression('0 0 1 * *')).toBeNull();
  });
});

// ─── Section 3: Domain validation regex ─────────────────────────

describe('domain validation regex', () => {
  // The regex from server/src/routes/bots.ts line 92
  const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;

  describe('valid domains', () => {
    it('api.virustotal.com', () => {
      expect(DOMAIN_REGEX.test('api.virustotal.com')).toBe(true);
    });

    it('example.com', () => {
      expect(DOMAIN_REGEX.test('example.com')).toBe(true);
    });

    it('sub.domain.example.co.uk', () => {
      expect(DOMAIN_REGEX.test('sub.domain.example.co.uk')).toBe(true);
    });
  });

  describe('invalid domains', () => {
    it('rejects protocol prefix: https://example.com', () => {
      expect(DOMAIN_REGEX.test('https://example.com')).toBe(false);
    });

    it('rejects path: /path', () => {
      expect(DOMAIN_REGEX.test('/path')).toBe(false);
    });

    it('rejects no TLD: example', () => {
      expect(DOMAIN_REGEX.test('example')).toBe(false);
    });

    it('rejects leading dot: .com', () => {
      expect(DOMAIN_REGEX.test('.com')).toBe(false);
    });

    it('rejects spaces: exam ple.com', () => {
      expect(DOMAIN_REGEX.test('exam ple.com')).toBe(false);
    });
  });
});

// ─── Section 4: isSecretField logic via encryptConfigSecrets / redactConfigSecrets ──

describe('secret field detection (encryptConfigSecrets / redactConfigSecrets)', () => {
  let encryptConfigSecrets: (config: Record<string, unknown>) => Record<string, unknown>;
  let redactConfigSecrets: (config: Record<string, unknown>) => Record<string, unknown>;

  beforeEach(async () => {
    // Ensure the master key is set so the crypto module can derive a key
    process.env.BOT_MASTER_KEY = 'test-key-for-unit-tests-1234567890';
    const mod = await import('../bots/secret-store.js');
    encryptConfigSecrets = mod.encryptConfigSecrets;
    redactConfigSecrets = mod.redactConfigSecrets;
  });

  describe('encryptConfigSecrets identifies secret fields', () => {
    it('encrypts apiKey field', () => {
      const result = encryptConfigSecrets({ apiKey: 'my-key-123' });
      expect(result.apiKey).toBeTypeOf('string');
      expect((result.apiKey as string).startsWith('enc:')).toBe(true);
    });

    it('encrypts webhookSecret field', () => {
      const result = encryptConfigSecrets({ webhookSecret: 'secret-value' });
      expect((result.webhookSecret as string).startsWith('enc:')).toBe(true);
    });

    it('encrypts dbPassword field', () => {
      const result = encryptConfigSecrets({ dbPassword: 'pass123' });
      expect((result.dbPassword as string).startsWith('enc:')).toBe(true);
    });

    it('encrypts authToken field', () => {
      const result = encryptConfigSecrets({ authToken: 'tok_abc' });
      expect((result.authToken as string).startsWith('enc:')).toBe(true);
    });

    it('encrypts api_key field', () => {
      const result = encryptConfigSecrets({ api_key: 'key-val' });
      expect((result.api_key as string).startsWith('enc:')).toBe(true);
    });

    it('encrypts private_key field', () => {
      const result = encryptConfigSecrets({ private_key: 'priv-val' });
      expect((result.private_key as string).startsWith('enc:')).toBe(true);
    });

    it('does NOT encrypt name field', () => {
      const result = encryptConfigSecrets({ name: 'My Bot' });
      expect(result.name).toBe('My Bot');
    });

    it('does NOT encrypt url field', () => {
      const result = encryptConfigSecrets({ url: 'https://api.example.com' });
      expect(result.url).toBe('https://api.example.com');
    });

    it('does NOT encrypt enabled field', () => {
      const result = encryptConfigSecrets({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('does NOT encrypt timeout field', () => {
      const result = encryptConfigSecrets({ timeout: 5000 });
      expect(result.timeout).toBe(5000);
    });
  });

  describe('redactConfigSecrets identifies secret fields', () => {
    it('redacts apiKey with ***configured*** when value present', () => {
      const result = redactConfigSecrets({ apiKey: 'real-key' });
      expect(result.apiKey).toBe('***configured***');
    });

    it('redacts webhookSecret with ***configured*** when value present', () => {
      const result = redactConfigSecrets({ webhookSecret: 'real-secret' });
      expect(result.webhookSecret).toBe('***configured***');
    });

    it('redacts dbPassword with ***not set*** when empty', () => {
      const result = redactConfigSecrets({ dbPassword: '' });
      expect(result.dbPassword).toBe('***not set***');
    });

    it('redacts authToken', () => {
      const result = redactConfigSecrets({ authToken: 'tok_abc' });
      expect(result.authToken).toBe('***configured***');
    });

    it('redacts api_key', () => {
      const result = redactConfigSecrets({ api_key: 'some-key' });
      expect(result.api_key).toBe('***configured***');
    });

    it('redacts private_key', () => {
      const result = redactConfigSecrets({ private_key: 'priv-data' });
      expect(result.private_key).toBe('***configured***');
    });

    it('does NOT redact name field', () => {
      const result = redactConfigSecrets({ name: 'My Bot' });
      expect(result.name).toBe('My Bot');
    });

    it('does NOT redact url field', () => {
      const result = redactConfigSecrets({ url: 'https://api.example.com' });
      expect(result.url).toBe('https://api.example.com');
    });

    it('does NOT redact enabled field', () => {
      const result = redactConfigSecrets({ enabled: true });
      expect(result.enabled).toBe(true);
    });

    it('does NOT redact timeout field', () => {
      const result = redactConfigSecrets({ timeout: 5000 });
      expect(result.timeout).toBe(5000);
    });
  });

  describe('nested object handling', () => {
    it('encrypts secret fields inside nested objects', () => {
      const result = encryptConfigSecrets({
        credentials: { apiKey: 'nested-key', url: 'https://example.com' },
      });
      const nested = result.credentials as Record<string, unknown>;
      expect((nested.apiKey as string).startsWith('enc:')).toBe(true);
      expect(nested.url).toBe('https://example.com');
    });

    it('redacts secret fields inside nested objects', () => {
      const result = redactConfigSecrets({
        credentials: { apiKey: 'nested-key', url: 'https://example.com' },
      });
      const nested = result.credentials as Record<string, unknown>;
      expect(nested.apiKey).toBe('***configured***');
      expect(nested.url).toBe('https://example.com');
    });
  });
});
