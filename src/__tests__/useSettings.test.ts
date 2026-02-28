/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings } from '../hooks/useSettings';
import { DEFAULT_SETTINGS } from '../types';

const SETTINGS_KEY = 'threatcaddy-settings';

describe('useSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns DEFAULT_SETTINGS when no localStorage data', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('loads persisted settings from localStorage', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light', editorMode: 'preview' }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.theme).toBe('light');
    expect(result.current.settings.editorMode).toBe('preview');
    // Non-persisted values come from defaults
    expect(result.current.settings.defaultView).toBe('dashboard');
  });

  it('falls back to defaults on corrupted localStorage', () => {
    localStorage.setItem(SETTINGS_KEY, 'not valid json');
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('updates settings and persists to localStorage', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSettings({ theme: 'light', sidebarCollapsed: true });
    });

    expect(result.current.settings.theme).toBe('light');
    expect(result.current.settings.sidebarCollapsed).toBe(true);

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.theme).toBe('light');
    expect(stored.sidebarCollapsed).toBe(true);
  });

  it('toggles theme from dark to light and back', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.theme).toBe('dark');

    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.settings.theme).toBe('light');

    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.settings.theme).toBe('dark');
  });

  it('preserves unmodified settings on partial update', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSettings({ editorMode: 'edit' });
    });

    expect(result.current.settings.theme).toBe('dark');
    expect(result.current.settings.defaultView).toBe('dashboard');
    expect(result.current.settings.editorMode).toBe('edit');
  });

  it('stores OCI PAR settings', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSettings({
        ociWritePAR: 'https://example.com/p/write/o/',
        ociLabel: 'my-device',
      });
    });

    expect(result.current.settings.ociWritePAR).toBe('https://example.com/p/write/o/');
    expect(result.current.settings.ociLabel).toBe('my-device');
  });

  it('migrates legacy ociWritePAR to backupDestinations', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ociWritePAR: 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/',
      ociLabel: 'My OCI',
    }));
    const { result } = renderHook(() => useSettings());
    const dests = result.current.settings.backupDestinations;
    expect(dests).toBeDefined();
    expect(dests).toHaveLength(1);
    expect(dests![0].provider).toBe('oci');
    expect(dests![0].label).toBe('My OCI');
    expect(dests![0].url).toBe('https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/');
    expect(dests![0].enabled).toBe(true);
    expect(dests![0].id).toBe('migrated-oci');
  });

  it('does not re-migrate if backupDestinations already exists', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ociWritePAR: 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/',
      ociLabel: 'Old',
      backupDestinations: [{ id: 'custom', provider: 'aws-s3', label: 'S3', url: 'https://mybucket.s3.us-east-1.amazonaws.com/', enabled: true }],
    }));
    const { result } = renderHook(() => useSettings());
    const dests = result.current.settings.backupDestinations;
    expect(dests).toHaveLength(1);
    expect(dests![0].id).toBe('custom');
    expect(dests![0].provider).toBe('aws-s3');
  });

  it('uses default label when ociLabel is not set', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ociWritePAR: 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/',
    }));
    const { result } = renderHook(() => useSettings());
    const dests = result.current.settings.backupDestinations;
    expect(dests).toBeDefined();
    expect(dests![0].label).toBe('OCI Backup');
  });
});
