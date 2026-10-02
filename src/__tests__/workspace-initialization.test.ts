import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ migrate: vi.fn(), open: vi.fn(), prepare: vi.fn(), content: vi.fn(), enabled: vi.fn(), key: vi.fn() }));
vi.mock('../db', () => ({ db: { open: mocks.open }, runWorkspaceContentMigrations: mocks.content }));
vi.mock('../lib/db-migration', () => ({ migrateIndexedDB: mocks.migrate }));
vi.mock('../lib/encryptionMiddleware', () => ({ ensureEncryptionReady: mocks.prepare, getSessionKey: mocks.key }));
vi.mock('../lib/encryptionStore', () => ({ isEncryptionEnabled: mocks.enabled }));

import { initializeWorkspace, isWorkspaceInitialized } from '../lib/workspace-initialization';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.key.mockReturnValue({});
});

describe('workspace startup ordering', () => {
  it('does not open or migrate a locked workspace', async () => {
    mocks.key.mockReturnValue(null);
    await expect(initializeWorkspace()).rejects.toThrow('Unlock the workspace');
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(isWorkspaceInitialized()).toBe(false);
  });

  it('waits for migration, schema opening and coverage before permitting consumers', async () => {
    const events: string[] = [];
    mocks.migrate.mockImplementation(async () => { events.push('migration'); });
    mocks.open.mockImplementation(async () => { events.push('schema'); });
    mocks.prepare.mockImplementation(async () => {
      expect(isWorkspaceInitialized()).toBe(false);
      events.push('coverage');
    });
    mocks.content.mockImplementation(async () => { events.push('content'); });
    await initializeWorkspace();
    expect(events).toEqual(['schema', 'coverage', 'migration', 'content']);
    expect(isWorkspaceInitialized()).toBe(true);
  });

  it('remains unready if coverage conversion fails and can retry safely', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(initializeWorkspace()).rejects.toThrow('Storage unavailable');
    expect(isWorkspaceInitialized()).toBe(false);
    await initializeWorkspace();
    expect(isWorkspaceInitialized()).toBe(true);
  });
});
