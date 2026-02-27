import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const SETTINGS_KEY = 'threatcaddy-settings';

function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  // Migrate flat tiIocSubtypes array → per-type map
  if (Array.isArray(raw.tiIocSubtypes)) {
    const flat = raw.tiIocSubtypes as string[];
    if (flat.length > 0) {
      // Assign all old subtypes to every IOC type so user data isn't lost
      const allTypes = ['ipv4','ipv6','domain','url','email','md5','sha1','sha256','cve','mitre-attack','yara-rule','sigma-rule','file-path'];
      const perType: Record<string, string[]> = {};
      for (const t of allTypes) perType[t] = [...flat];
      raw.tiIocSubtypes = perType;
    } else {
      raw.tiIocSubtypes = undefined;
    }
  }
  // Migrate flat tiRelationshipTypes array → empty map (old format was just labels)
  if (Array.isArray(raw.tiRelationshipTypes)) {
    raw.tiRelationshipTypes = undefined;
  }
  // Migrate legacy OCI PAR fields → backupDestinations array
  if (raw.ociWritePAR && typeof raw.ociWritePAR === 'string' && !raw.backupDestinations) {
    raw.backupDestinations = [{
      id: 'migrated-oci',
      provider: 'oci',
      label: (raw.ociLabel as string) || 'OCI Backup',
      url: raw.ociWritePAR as string,
      enabled: true,
    }];
  }
  return raw;
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const raw = migrateSettings(JSON.parse(stored));
      return { ...DEFAULT_SETTINGS, ...raw } as Settings;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      document.body.classList.add('bg-gray-950', 'text-gray-100');
      document.body.classList.remove('bg-white', 'text-gray-900');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      document.body.classList.remove('bg-gray-950', 'text-gray-100');
      document.body.classList.add('bg-white', 'text-gray-900');
    }
  }, [settings.theme]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  }, [settings.theme, updateSettings]);

  return { settings, updateSettings, toggleTheme };
}
