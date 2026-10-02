import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); });

describe('isolated workspace selection', () => {
  it('keeps the original database stable while new server/account pairs get separate deterministic profiles', async () => {
    const p = await import('../lib/workspace-profiles');
    localStorage.setItem('threatcaddy-settings', JSON.stringify({ llmApiKey: 'synthetic-secret' }));
    const profiles = await Promise.all([
      p.prepareAuthenticatedWorkspace('https://one.example', 'alice', 'One Alice'),
      p.prepareAuthenticatedWorkspace('https://one.example', 'bob', 'One Bob'),
      p.prepareAuthenticatedWorkspace('https://two.example', 'alice', 'Two Alice'),
      p.prepareAuthenticatedWorkspace('https://two.example', 'bob', 'Two Bob'),
    ]);
    expect(new Set(profiles.map(x => x.id)).size).toBe(4);
    expect(p.getWorkspaceDatabaseName()).toBe('ThreatCaddyDB');
    expect(p.listWorkspaceProfiles()).toHaveLength(5);
    const again = await p.prepareAuthenticatedWorkspace('HTTPS://ONE.EXAMPLE:443/', 'alice', 'Same');
    expect(again.id).toBe(profiles[0].id);
    p.activateWorkspace(again.id);
    // Imported callbacks remain pinned to the original DB until the reload.
    expect(p.getActiveWorkspaceId()).toBe('default');
    vi.resetModules();
    const next = await import('../lib/workspace-profiles');
    expect(next.getWorkspaceDatabaseName()).toBe(`ThreatCaddyDB:${again.id}`);
    expect(localStorage.getItem(next.workspaceStorageKey('threatcaddy-settings'))).toBeNull();
    expect(localStorage.getItem('threatcaddy-settings')).toContain('synthetic-secret');
  });

  it('only adopts the original data when its previously verified account matches', async () => {
    const p = await import('../lib/workspace-profiles');
    const identity = { serverUrl: 'https://one.example', userId: 'alice' };
    expect((await p.prepareAuthenticatedWorkspace(identity.serverUrl, identity.userId, 'Old', identity)).id).toBe('default');
    expect((await p.prepareAuthenticatedWorkspace(identity.serverUrl, 'bob', 'New', identity)).id).not.toBe('default');
  });

  it('creates distinct empty local profiles without copying settings, auth, or selecting them early', async () => {
    const p = await import('../lib/workspace-profiles');
    localStorage.setItem('threatcaddy-settings', '{"language":"ar"}');
    localStorage.setItem('threatcaddy-auth', 'synthetic existing auth');
    const first = await p.createLocalWorkspace();
    const second = await p.createLocalWorkspace();
    expect(first.id).toMatch(/^[a-f\d]{64}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.serverUrl).toBeUndefined();
    expect(first.userId).toBeUndefined();
    expect(p.getActiveWorkspaceId()).toBe('default');
    expect(localStorage.getItem(p.workspaceStorageKey('threatcaddy-settings', first.id))).toBeNull();
    expect(localStorage.getItem(p.workspaceStorageKey('threatcaddy-auth', first.id))).toBeNull();
    expect(localStorage.getItem('threatcaddy-auth')).toBe('synthetic existing auth');
    expect(p.listWorkspaceProfiles()).toHaveLength(3);
  });

  it('reuses a restored local workspace only for its verified account binding', async () => {
    const p = await import('../lib/workspace-profiles');
    const local = await p.createLocalWorkspace();
    p.activateWorkspace(local.id);
    vi.resetModules();
    const active = await import('../lib/workspace-profiles');
    const binding = { serverUrl: 'https://team.example', userId: 'alice' };
    const restored = await active.prepareAuthenticatedWorkspace(binding.serverUrl, binding.userId, 'Restored Alice', binding);
    expect(restored.id).toBe(local.id);
    expect(active.getWorkspaceDatabaseName()).toBe(`ThreatCaddyDB:${local.id}`);
    const other = await active.prepareAuthenticatedWorkspace(binding.serverUrl, 'bob', 'Bob', binding);
    expect(other.id).not.toBe(local.id);
    expect(active.getActiveWorkspaceId()).toBe(local.id);
  });

  it('inherits protection without copying session keys, credentials, or settings', async () => {
    const p = await import('../lib/workspace-profiles');
    const next = await p.prepareAuthenticatedWorkspace('https://one.example', 'alice', 'One');
    const metadata = { version: 1, enabledAt: 1, salt: 'salt', wrappedKey: 'wrapped', recoverySalt: 'salt', recoveryWrappedKey: 'wrapped' };
    localStorage.setItem('threatcaddy-encryption', JSON.stringify(metadata));
    sessionStorage.setItem('threatcaddy-session-cache', 'synthetic-key');
    p.preserveEncryptionForNewWorkspace(next.id);
    expect(localStorage.getItem(p.workspaceStorageKey('threatcaddy-encryption', next.id))).toBe(JSON.stringify(metadata));
    expect(sessionStorage.getItem(p.workspaceStorageKey('threatcaddy-session-cache', next.id))).toBeNull();
    localStorage.removeItem(p.workspaceStorageKey('threatcaddy-encryption', next.id));
    expect(localStorage.getItem('threatcaddy-encryption')).toBe(JSON.stringify(metadata));
  });

  it.each(['null', '{}', '{"version":1}', '{"version":1,"enabledAt":1,"salt":"x","wrappedKey":"x","recoverySalt":"x","recoveryWrappedKey":"x","transition":"encrypting"}'])('refuses invalid or converting encryption metadata: %s', async raw => {
    const p = await import('../lib/workspace-profiles');
    const next = await p.prepareAuthenticatedWorkspace('https://one.example', 'alice', 'One');
    localStorage.setItem('threatcaddy-encryption', raw);
    expect(() => p.preserveEncryptionForNewWorkspace(next.id)).toThrow();
    expect(localStorage.getItem(p.workspaceStorageKey('threatcaddy-encryption', next.id))).toBeNull();
  });

  it('rejects unknown and malformed selections without falling back to a different dataset', async () => {
    const p = await import('../lib/workspace-profiles');
    expect(() => p.activateWorkspace('a'.repeat(64))).toThrow('Unknown workspace');
    sessionStorage.setItem('threatcaddy-active-workspace', '../other');
    vi.resetModules();
    await expect(import('../lib/workspace-profiles')).rejects.toThrow('Invalid workspace selection');
  });
});
