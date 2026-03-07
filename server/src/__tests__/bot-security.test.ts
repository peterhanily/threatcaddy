import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BotConfig, BotContext, BotCapability } from '../bots/types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
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
  posts: { id: col('id'), authorId: col('author_id'), content: col('content'), attachments: col('attachments'), folderId: col('folder_id'), mentions: col('mentions'), deleted: col('deleted'), createdAt: col('created_at'), updatedAt: col('updated_at') },
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

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
}));

// Set BOT_MASTER_KEY before importing secret-store (used by bot-manager)
process.env.BOT_MASTER_KEY = 'test-master-key-for-unit-tests-32chars!!';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBotConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: 'bot-1',
    userId: 'bot-user-1',
    type: 'enrichment',
    name: 'Test Bot',
    description: 'A test bot',
    enabled: true,
    triggers: {},
    config: {},
    capabilities: ['read_entities'],
    allowedDomains: [],
    scopeType: 'investigation',
    scopeFolderIds: ['folder-1'],
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

function makeBotContext(configOverrides: Partial<BotConfig> = {}): BotContext {
  return {
    botConfig: makeBotConfig(configOverrides),
    botUserId: 'bot-user-1',
    runId: 'run-1',
    trigger: 'manual',
    entitiesCreated: 0,
    entitiesUpdated: 0,
    apiCallsMade: 0,
    signal: new AbortController().signal,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. BotExecutionContext — scope enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe('BotExecutionContext scope enforcement', () => {
  let BotExecutionContext: typeof import('../bots/bot-context.js').BotExecutionContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../bots/bot-context.js');
    BotExecutionContext = mod.BotExecutionContext;
  });

  // ─── Scope checks ──────────────────────────────────────────────

  describe('requireScope (tested via searchNotes)', () => {
    it('scoped bot can access entities in its allowed folder', async () => {
      const ctx = makeBotContext({
        scopeType: 'investigation',
        scopeFolderIds: ['folder-1'],
        capabilities: ['read_entities'],
      });
      const exec = new BotExecutionContext(ctx);

      // searchNotes calls requireScope internally — should not throw
      // The DB mock returns [] so no rows, but the scope check happens before the query
      await expect(exec.searchNotes('folder-1', 'test')).resolves.not.toThrow();
    });

    it('scoped bot CANNOT access entities in a different folder', async () => {
      const ctx = makeBotContext({
        scopeType: 'investigation',
        scopeFolderIds: ['folder-1'],
        capabilities: ['read_entities'],
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchNotes('folder-2', 'test')).rejects.toThrow(
        /not authorized for folder folder-2/
      );
    });

    it('global bot CAN access entities in any folder', async () => {
      const ctx = makeBotContext({
        scopeType: 'global',
        scopeFolderIds: [],
        capabilities: ['read_entities'],
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchNotes('folder-1', 'test')).resolves.not.toThrow();
      await expect(exec.searchNotes('folder-2', 'test')).resolves.not.toThrow();
      await expect(exec.searchNotes('any-folder', 'test')).resolves.not.toThrow();
    });

    it('scoped bot with multiple folders can access any of them', async () => {
      const ctx = makeBotContext({
        scopeType: 'investigation',
        scopeFolderIds: ['folder-1', 'folder-2', 'folder-3'],
        capabilities: ['read_entities'],
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchNotes('folder-1', '')).resolves.not.toThrow();
      await expect(exec.searchNotes('folder-2', '')).resolves.not.toThrow();
      await expect(exec.searchNotes('folder-3', '')).resolves.not.toThrow();
      await expect(exec.searchNotes('folder-4', '')).rejects.toThrow(/not authorized/);
    });
  });

  // ─── Capability checks ─────────────────────────────────────────

  describe('requireCapability (tested via various methods)', () => {
    it('throws when bot lacks read_entities capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['post_to_feed'], // no read_entities
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchNotes('folder-1', 'test')).rejects.toThrow(
        /lacks capability: read_entities/
      );
    });

    it('throws when bot lacks post_to_feed capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.postToFeed('hello')).rejects.toThrow(
        /lacks capability: post_to_feed/
      );
    });

    it('throws when bot lacks notify_users capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.notifyUser('user-1', 'hello')).rejects.toThrow(
        /lacks capability: notify_users/
      );
    });

    it('throws when bot lacks create_entities capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(
        exec.createEntity('notes', 'n1', { title: 'test', folderId: 'folder-1' })
      ).rejects.toThrow(/lacks capability: create_entities/);
    });

    it('throws when bot lacks update_entities capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(
        exec.updateEntity('notes', 'n1', { title: 'updated' })
      ).rejects.toThrow(/lacks capability: update_entities/);
    });

    it('throws when bot lacks cross_investigation capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchAcrossInvestigations('ioc')).rejects.toThrow(
        /lacks capability: cross_investigation/
      );
    });

    it('does not throw when bot has the required capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities', 'post_to_feed'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      // post_to_feed only checks capability + scope, DB insert is mocked
      await expect(exec.postToFeed('hello world')).resolves.not.toThrow();
    });
  });

  // ─── Domain checks ─────────────────────────────────────────────

  describe('requireDomain (tested via fetchExternal)', () => {
    it('blocks calls when no allowed domains are configured', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: [],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.fetchExternal('https://evil.com/api')).rejects.toThrow(
        /No allowed domains configured/
      );
    });

    it('blocks calls to non-allowed domains', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: ['api.virustotal.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.fetchExternal('https://evil.com/api')).rejects.toThrow(
        /not allowed to call evil\.com/
      );
    });

    it('allows calls to exact-match allowed domains', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: ['api.virustotal.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      // fetchExternal calls requireDomain then does actual fetch — we just want the domain check to pass.
      // The fetch itself might fail (no network in tests), but the domain check should not throw.
      // We mock global fetch to avoid network calls.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      try {
        await expect(exec.fetchExternal('https://api.virustotal.com/v3/ip')).resolves.toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows calls to subdomains of allowed domains', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: ['virustotal.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      try {
        // sub.virustotal.com ends with .virustotal.com, so it should be allowed
        await expect(exec.fetchExternal('https://sub.virustotal.com/api')).resolves.toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects invalid URLs', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: ['example.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.fetchExternal('not-a-valid-url')).rejects.toThrow(/Invalid URL/);
    });

    it('requires call_external_apis capability', async () => {
      const ctx = makeBotContext({
        capabilities: ['read_entities'], // no call_external_apis
        allowedDomains: ['example.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      await expect(exec.fetchExternal('https://example.com/api')).rejects.toThrow(
        /lacks capability: call_external_apis/
      );
    });

    it('increments apiCallsMade counter on successful fetch', async () => {
      const ctx = makeBotContext({
        capabilities: ['call_external_apis'],
        allowedDomains: ['example.com'],
        scopeType: 'global',
      });
      const exec = new BotExecutionContext(ctx);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
      try {
        expect(ctx.apiCallsMade).toBe(0);
        await exec.fetchExternal('https://example.com/api');
        expect(ctx.apiCallsMade).toBe(1);
        await exec.fetchExternal('https://example.com/other');
        expect(ctx.apiCallsMade).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─── Abort signal checks ───────────────────────────────────────

  describe('abort signal', () => {
    it('throws when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = makeBotContext({
        capabilities: ['read_entities'],
        scopeType: 'global',
      });
      ctx.signal = controller.signal;
      const exec = new BotExecutionContext(ctx);

      await expect(exec.searchNotes('folder-1', 'test')).rejects.toThrow(
        /Bot execution aborted/
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. validateBotCreate / validateBotUpdate — pure validation functions
// ══════════════════════════════════════════════════════════════════════════════

// Mock bot-manager to provide validateCronExpression without needing the full manager
vi.mock('../bots/bot-manager.js', () => ({
  validateCronExpression: (cron: string) => {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return 'Cron expression must have 5 fields (minute hour day month weekday)';
    // Simplified: only accept known safe patterns for testing
    if (/^\*\/\d+ \* \* \* \*$/.test(cron.trim())) {
      const n = parseInt(cron.trim().split('/')[1]);
      if (n <= 0) return 'Unsupported cron pattern';
      return null;
    }
    if (/^0 \*\/\d+ \* \* \*$/.test(cron.trim())) return null;
    if (/^\d+ \d+ \* \* \*$/.test(cron.trim())) return null;
    if (/^\d+ \* \* \* \*$/.test(cron.trim())) return null;
    return 'Unsupported cron pattern';
  },
  botManager: {
    reloadBot: vi.fn().mockResolvedValue(undefined),
    unloadBot: vi.fn().mockResolvedValue(undefined),
    executeBot: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../bots/secret-store.js', () => ({
  encryptConfigSecrets: vi.fn((config: Record<string, unknown>) => config),
  decryptConfigSecrets: vi.fn((config: Record<string, unknown>) => config),
  redactConfigSecrets: vi.fn((config: Record<string, unknown>) => config),
}));

describe('validateBotCreate', () => {
  let validateBotCreate: typeof import('../services/bot-service.js').validateBotCreate;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/bot-service.js');
    validateBotCreate = mod.validateBotCreate;
  });

  it('returns null for a valid bot creation input', () => {
    const result = validateBotCreate({
      name: 'VirusTotal Enrichment',
      type: 'enrichment',
      capabilities: ['read_entities', 'call_external_apis'],
      allowedDomains: ['api.virustotal.com'],
    });
    expect(result).toBeNull();
  });

  it('returns null when only required fields (name, type) are provided', () => {
    const result = validateBotCreate({
      name: 'Minimal Bot',
      type: 'custom',
    });
    expect(result).toBeNull();
  });

  // ─── Name validation ───────────────────────────────────────────

  it('returns error for empty name', () => {
    const result = validateBotCreate({ name: '', type: 'custom' });
    expect(result).toContain('Name is required');
  });

  it('returns error for whitespace-only name', () => {
    const result = validateBotCreate({ name: '   ', type: 'custom' });
    expect(result).toContain('Name is required');
  });

  it('returns error for name exceeding 100 characters', () => {
    const longName = 'A'.repeat(101);
    const result = validateBotCreate({ name: longName, type: 'custom' });
    expect(result).toContain('Name is required');
  });

  it('allows name at exactly 100 characters', () => {
    const exactName = 'B'.repeat(100);
    const result = validateBotCreate({ name: exactName, type: 'custom' });
    expect(result).toBeNull();
  });

  it('allows name at 1 character', () => {
    const result = validateBotCreate({ name: 'X', type: 'custom' });
    expect(result).toBeNull();
  });

  // ─── Type validation ───────────────────────────────────────────

  it('returns error for invalid type', () => {
    const result = validateBotCreate({ name: 'Bot', type: 'invalid-type' });
    expect(result).toContain('Invalid type');
  });

  it('returns error for empty type', () => {
    const result = validateBotCreate({ name: 'Bot', type: '' });
    expect(result).toContain('Invalid type');
  });

  it('accepts all valid bot types', () => {
    const validTypes = ['enrichment', 'feed', 'monitor', 'triage', 'report', 'correlation', 'ai-agent', 'custom'];
    for (const type of validTypes) {
      const result = validateBotCreate({ name: 'Bot', type });
      expect(result).toBeNull();
    }
  });

  // ─── Capabilities validation ───────────────────────────────────

  it('returns error for invalid capability', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      capabilities: ['read_entities', 'hack_the_planet'],
    });
    expect(result).toContain('Invalid capability: hack_the_planet');
  });

  it('returns error when capabilities is not an array', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      capabilities: 'read_entities' as unknown as string[],
    });
    expect(result).toContain('Capabilities must be an array');
  });

  it('accepts all valid capabilities', () => {
    const allCaps: BotCapability[] = [
      'read_entities', 'create_entities', 'update_entities',
      'post_to_feed', 'notify_users', 'call_external_apis',
      'cross_investigation',
    ];
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      capabilities: allCaps,
    });
    expect(result).toBeNull();
  });

  it('accepts empty capabilities array', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      capabilities: [],
    });
    expect(result).toBeNull();
  });

  it('accepts undefined capabilities (optional field)', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
    });
    expect(result).toBeNull();
  });

  // ─── Domain validation ─────────────────────────────────────────

  it('returns error for invalid domain format', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      allowedDomains: ['https://example.com'],
    });
    expect(result).toContain('Invalid domain');
  });

  it('returns error for domain without TLD', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      allowedDomains: ['localhost'],
    });
    expect(result).toContain('Invalid domain');
  });

  it('returns error for domain with path', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      allowedDomains: ['example.com/path'],
    });
    expect(result).toContain('Invalid domain');
  });

  it('accepts valid domain names', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      allowedDomains: ['api.virustotal.com', 'example.org', 'sub.domain.co.uk'],
    });
    expect(result).toBeNull();
  });

  // ─── Cron validation ───────────────────────────────────────────

  it('returns error for invalid cron expression', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      triggers: { schedule: 'bad' },
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('accepts valid cron expression', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      triggers: { schedule: '*/5 * * * *' },
    });
    expect(result).toBeNull();
  });

  it('allows triggers without schedule (no cron validation needed)', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      triggers: { events: ['entity.created'] },
    });
    expect(result).toBeNull();
  });

  it('returns error when webhook trigger is enabled but webhookSecret is missing from config', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      triggers: { webhook: true },
    });
    expect(result).toContain('webhookSecret is required');
  });

  it('accepts webhook trigger when webhookSecret is provided in config', () => {
    const result = validateBotCreate({
      name: 'Bot',
      type: 'custom',
      triggers: { webhook: true },
      config: { webhookSecret: 'my-secret-123' },
    });
    expect(result).toBeNull();
  });
});

describe('validateBotUpdate', () => {
  let validateBotUpdate: typeof import('../services/bot-service.js').validateBotUpdate;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/bot-service.js');
    validateBotUpdate = mod.validateBotUpdate;
  });

  it('returns updates object for valid name change', () => {
    const result = validateBotUpdate({ name: 'New Name' });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.name).toBe('New Name');
      expect(result.updates.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('trims name whitespace', () => {
    const result = validateBotUpdate({ name: '  Trimmed  ' });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.name).toBe('Trimmed');
    }
  });

  it('returns error for empty name', () => {
    const result = validateBotUpdate({ name: '' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Name must be 1-100 characters');
    }
  });

  it('returns error for name exceeding 100 characters', () => {
    const result = validateBotUpdate({ name: 'X'.repeat(101) });
    expect('error' in result).toBe(true);
  });

  it('returns error for invalid capability in update', () => {
    const result = validateBotUpdate({ capabilities: ['read_entities', 'fly'] });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Invalid capability: fly');
    }
  });

  it('returns error when capabilities is not an array', () => {
    const result = validateBotUpdate({ capabilities: 'read_entities' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Capabilities must be an array');
    }
  });

  it('accepts valid capabilities in update', () => {
    const result = validateBotUpdate({ capabilities: ['read_entities', 'create_entities'] });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.capabilities).toEqual(['read_entities', 'create_entities']);
    }
  });

  it('returns error for invalid domain in update', () => {
    const result = validateBotUpdate({ allowedDomains: ['not a domain'] });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Invalid domain');
    }
  });

  it('accepts valid domains in update', () => {
    const result = validateBotUpdate({ allowedDomains: ['api.example.com'] });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.allowedDomains).toEqual(['api.example.com']);
    }
  });

  it('returns error for invalid scopeType', () => {
    const result = validateBotUpdate({ scopeType: 'universe' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Invalid scopeType');
    }
  });

  it('accepts valid scopeType values', () => {
    for (const scopeType of ['global', 'investigation', 'tag-based']) {
      const result = validateBotUpdate({ scopeType });
      expect('updates' in result).toBe(true);
      if ('updates' in result) {
        expect(result.updates.scopeType).toBe(scopeType);
      }
    }
  });

  it('returns error for invalid cron in triggers', () => {
    const result = validateBotUpdate({ triggers: { schedule: 'bad' } });
    expect('error' in result).toBe(true);
  });

  it('accepts valid cron in triggers', () => {
    const result = validateBotUpdate({ triggers: { schedule: '*/10 * * * *' } });
    expect('updates' in result).toBe(true);
  });

  it('handles description update', () => {
    const result = validateBotUpdate({ description: 'New description' });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.description).toBe('New description');
    }
  });

  it('defaults rateLimitPerHour to 100 when invalid value provided', () => {
    const result = validateBotUpdate({ rateLimitPerHour: -5 });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.rateLimitPerHour).toBe(100);
    }
  });

  it('accepts valid rateLimitPerHour', () => {
    const result = validateBotUpdate({ rateLimitPerHour: 50 });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.rateLimitPerHour).toBe(50);
    }
  });

  it('defaults rateLimitPerDay to 1000 when invalid value provided', () => {
    const result = validateBotUpdate({ rateLimitPerDay: 0 });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.rateLimitPerDay).toBe(1000);
    }
  });

  it('accepts valid rateLimitPerDay', () => {
    const result = validateBotUpdate({ rateLimitPerDay: 500 });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.rateLimitPerDay).toBe(500);
    }
  });

  it('sets non-array allowedDomains to empty array', () => {
    const result = validateBotUpdate({ allowedDomains: 'example.com' as unknown });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.allowedDomains).toEqual([]);
    }
  });

  it('sets non-array scopeFolderIds to empty array', () => {
    const result = validateBotUpdate({ scopeFolderIds: 'folder-1' as unknown });
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.scopeFolderIds).toEqual([]);
    }
  });

  it('always includes updatedAt even with empty body', () => {
    const result = validateBotUpdate({});
    expect('updates' in result).toBe(true);
    if ('updates' in result) {
      expect(result.updates.updatedAt).toBeInstanceOf(Date);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Webhook auth flow — timing-safe secret comparison
// ══════════════════════════════════════════════════════════════════════════════

describe('Webhook auth flow', () => {
  it('rejects request without X-Webhook-Secret header (returns 401)', async () => {
    const { timingSafeEqual } = await import('node:crypto');

    // Simulate the webhook auth logic from bots.ts lines 118-128
    const storedSecret = 'my-webhook-secret-123';
    const providedSecret = ''; // missing header

    const secretBuf = Buffer.from(storedSecret);
    const headerBuf = Buffer.from(providedSecret);

    // Lengths differ, so this should fail
    const isValid = secretBuf.length === headerBuf.length && timingSafeEqual(secretBuf, headerBuf);
    expect(isValid).toBe(false);
  });

  it('rejects request with wrong secret (returns 401)', async () => {
    const { timingSafeEqual } = await import('node:crypto');

    const storedSecret = 'correct-secret';
    const providedSecret = 'wrong-secret!!';

    const secretBuf = Buffer.from(storedSecret);
    const headerBuf = Buffer.from(providedSecret);

    // Lengths differ
    const isValid = secretBuf.length === headerBuf.length && timingSafeEqual(secretBuf, headerBuf);
    expect(isValid).toBe(false);
  });

  it('rejects request with same-length but wrong secret', async () => {
    const { timingSafeEqual } = await import('node:crypto');

    const storedSecret = 'secret-aaa';
    const providedSecret = 'secret-bbb';

    const secretBuf = Buffer.from(storedSecret);
    const headerBuf = Buffer.from(providedSecret);

    // Same length but different content
    expect(secretBuf.length).toBe(headerBuf.length);
    const isValid = secretBuf.length === headerBuf.length && timingSafeEqual(secretBuf, headerBuf);
    expect(isValid).toBe(false);
  });

  it('accepts request with correct secret', async () => {
    const { timingSafeEqual } = await import('node:crypto');

    const storedSecret = 'my-webhook-secret-123';
    const providedSecret = 'my-webhook-secret-123';

    const secretBuf = Buffer.from(storedSecret);
    const headerBuf = Buffer.from(providedSecret);

    const isValid = secretBuf.length === headerBuf.length && timingSafeEqual(secretBuf, headerBuf);
    expect(isValid).toBe(true);
  });

  it('length check prevents timingSafeEqual from throwing on mismatched buffer sizes', async () => {
    const { timingSafeEqual } = await import('node:crypto');

    const secretBuf = Buffer.from('short');
    const headerBuf = Buffer.from('much-longer-value');

    // timingSafeEqual throws on different lengths, but the length guard prevents that
    expect(secretBuf.length === headerBuf.length).toBe(false);
    // If we bypassed the guard, timingSafeEqual would throw
    expect(() => timingSafeEqual(secretBuf, headerBuf)).toThrow();
  });
});
