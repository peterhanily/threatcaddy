import { describe, it, expect, beforeEach } from 'vitest';
import { migrateStorageKeys } from '../lib/storage-migration';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('migrateStorageKeys', () => {
  it('does nothing when no old keys exist', () => {
    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-encryption')).toBeNull();
    expect(localStorage.getItem('threatcaddy-settings')).toBeNull();
    expect(localStorage.getItem('threatcaddy-saved-searches')).toBeNull();
    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBeNull();
  });

  it('migrates browsernotes-encryption to threatcaddy-encryption', () => {
    localStorage.setItem('browsernotes-encryption', '{"version":1}');

    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-encryption')).toBe('{"version":1}');
    expect(localStorage.getItem('browsernotes-encryption')).toBeNull();
  });

  it('migrates browsernotes-settings to threatcaddy-settings', () => {
    localStorage.setItem('browsernotes-settings', '{"theme":"dark"}');

    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-settings')).toBe('{"theme":"dark"}');
    expect(localStorage.getItem('browsernotes-settings')).toBeNull();
  });

  it('migrates browsernotes-saved-searches to threatcaddy-saved-searches', () => {
    localStorage.setItem('browsernotes-saved-searches', '[{"query":"apt29"}]');

    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-saved-searches')).toBe('[{"query":"apt29"}]');
    expect(localStorage.getItem('browsernotes-saved-searches')).toBeNull();
  });

  it('migrates browsernotes-session-cache in sessionStorage', () => {
    sessionStorage.setItem('browsernotes-session-cache', '{"key":"abc"}');

    migrateStorageKeys();

    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBe('{"key":"abc"}');
    expect(sessionStorage.getItem('browsernotes-session-cache')).toBeNull();
  });

  it('migrates all keys in a single call', () => {
    localStorage.setItem('browsernotes-encryption', 'enc');
    localStorage.setItem('browsernotes-settings', 'settings');
    localStorage.setItem('browsernotes-saved-searches', 'searches');
    sessionStorage.setItem('browsernotes-session-cache', 'cache');

    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-encryption')).toBe('enc');
    expect(localStorage.getItem('threatcaddy-settings')).toBe('settings');
    expect(localStorage.getItem('threatcaddy-saved-searches')).toBe('searches');
    expect(sessionStorage.getItem('threatcaddy-session-cache')).toBe('cache');

    // All old keys removed
    expect(localStorage.getItem('browsernotes-encryption')).toBeNull();
    expect(localStorage.getItem('browsernotes-settings')).toBeNull();
    expect(localStorage.getItem('browsernotes-saved-searches')).toBeNull();
    expect(sessionStorage.getItem('browsernotes-session-cache')).toBeNull();
  });

  it('skips migration when new key already exists (no overwrite)', () => {
    localStorage.setItem('browsernotes-encryption', 'old-value');
    localStorage.setItem('threatcaddy-encryption', 'existing-value');

    migrateStorageKeys();

    // New key should NOT be overwritten
    expect(localStorage.getItem('threatcaddy-encryption')).toBe('existing-value');
    // Old key should NOT be removed (since migration was skipped)
    expect(localStorage.getItem('browsernotes-encryption')).toBe('old-value');
  });

  it('is idempotent (safe to call multiple times)', () => {
    localStorage.setItem('browsernotes-settings', '{"theme":"light"}');

    migrateStorageKeys();
    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-settings')).toBe('{"theme":"light"}');
    expect(localStorage.getItem('browsernotes-settings')).toBeNull();
  });

  it('preserves exact value (no transformation)', () => {
    const complex = JSON.stringify({
      version: 1,
      salt: 'abc123==',
      wrappedKey: 'xyz789==',
      nested: { deep: [1, 2, 3] },
      unicode: 'émojis 🔐',
    });
    localStorage.setItem('browsernotes-encryption', complex);

    migrateStorageKeys();

    expect(localStorage.getItem('threatcaddy-encryption')).toBe(complex);
  });
});
