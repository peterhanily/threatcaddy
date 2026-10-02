import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig, BotContext } from '../bots/types.js';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), connect: vi.fn(), exec: vi.fn(), end: vi.fn(), http: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('../lib/bounded-http.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/bounded-http.js')>(), requestPinned: mocks.http }));
vi.mock('ssh2', () => ({ Client: class extends EventEmitter {
  connect(options: unknown) { mocks.connect(options); queueMicrotask(() => this.emit('ready')); }
  exec(command: string, callback: (error: null, stream: EventEmitter & { stderr: EventEmitter }) => void) {
    mocks.exec(command);
    const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    callback(null, stream);
    queueMicrotask(() => { stream.emit('data', Buffer.from('healthy')); stream.emit('close', 0); });
  }
  end() { mocks.end(); }
} }));
vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../services/sync-service.js', () => ({ processPush: vi.fn(), lookupEntityFolderId: vi.fn() }));
vi.mock('../services/notification-service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../services/audit-service.js', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ws/handler.js', () => ({ broadcastToFolder: vi.fn() }));
vi.mock('../bots/sandbox.js', () => ({ executeCode: vi.fn() }));
import { BotExecutionContext } from '../bots/bot-context.js';

const hostKey = Buffer.from('ordinary test server identity');
const fingerprint = `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
function fixture(settings: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const botConfig = {
    id: 'bot', name: 'Operations', type: 'integration', userId: 'bot-user', description: '', enabled: true,
    capabilities: ['execute_remote', 'call_external_apis'], allowedDomains: ['service.example'],
    scopeType: 'investigation', scopeFolderIds: ['case'], triggers: {}, rateLimitPerHour: 10, rateLimitPerDay: 20,
    lastRunAt: null, lastError: null, runCount: 0, errorCount: 0, createdBy: 'admin', createdAt: new Date(), updatedAt: new Date(),
    config: { allowedHosts: ['service.example'], sshOperations: { health: { executable: '/usr/bin/health', args: ['--summary'] } },
      sshCredentials: { 'service.example': { username: 'monitor', hostFingerprint: fingerprint } }, ...settings },
  } satisfies BotConfig;
  const context: BotContext = { botConfig, botUserId: 'bot-user', runId: 'run', trigger: 'manual',
    entitiesCreated: 0, entitiesUpdated: 0, apiCallsMade: 0, log: [], signal: controller.signal };
  return { context, controller, execution: new BotExecutionContext(context) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ address: '203.0.113.10', family: 4 });
  mocks.http.mockResolvedValue(Response.json({ status: 'healthy' }));
});

describe('configured outbound operations', () => {
  it('passes the original HTTPS identity and the checked address to the transport', async () => {
    const { execution } = fixture();
    await execution.fetchExternal('https://service.example/status');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.http.mock.calls[0][0].hostname).toBe('service.example');
    expect(mocks.http.mock.calls[0][1]).toEqual({ address: '203.0.113.10', family: 4 });
  });

  it('leaves an empty outbound allowlist deny-by-default', async () => {
    const { execution, context } = fixture();
    context.botConfig.allowedDomains = [];
    await expect(execution.fetchExternal('https://service.example/status')).rejects.toThrow('No allowed domains');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.http).not.toHaveBeenCalled();
  });

  it('runs only a configured fixed operation using the pinned address and verified host key', async () => {
    const { execution } = fixture();
    expect(await execution.execSSH('service.example', 'health')).toEqual({ exitCode: 0, stdout: 'healthy', stderr: '' });
    expect(mocks.exec).toHaveBeenCalledWith("'/usr/bin/health' '--summary'");
    const connection = mocks.connect.mock.calls[0][0];
    expect(connection.host).toBe('203.0.113.10');
    expect(connection.username).toBe('monitor');
    expect(connection.hostVerifier(hostKey)).toBe(true);
    expect(connection.hostVerifier(Buffer.from('replacement server identity'))).toBe(false);
  });

  it('requires migration of legacy command-prefix configuration', async () => {
    const { execution } = fixture({ sshOperations: undefined, allowedCommands: ['health'] });
    await expect(execution.execSSH('service.example', 'health')).rejects.toThrow('legacy command prefixes');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('requires an explicitly verified host identity', async () => {
    const { execution } = fixture({ sshCredentials: { 'service.example': { username: 'monitor' } } });
    await expect(execution.execSSH('service.example', 'health')).rejects.toThrow('hostFingerprint');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
