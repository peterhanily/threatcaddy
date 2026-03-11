/** Color scheme presets. Each scheme provides CSS variable overrides for dark and light modes. */

export interface ColorScheme {
  id: string;
  label: string;
  /** The primary accent swatch color (for previewing in the picker) */
  swatch: string;
  dark: Record<string, string>;
  light: Record<string, string>;
}

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: '#6366f1',
    dark: {}, // default — no overrides needed
    light: {},
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: '#0ea5e9',
    dark: {
      '--color-accent': '#0ea5e9',
      '--color-accent-hover': '#38bdf8',
      '--color-accent-dim': '#0284c7',
      '--color-bg-deep': '#0a0f18',
      '--color-bg-surface': '#0f1620',
      '--color-bg-raised': '#141d2b',
      '--color-bg-hover': '#1a2536',
      '--color-bg-active': '#1e2d42',
      '--color-purple': '#38bdf8',
    },
    light: {
      '--color-accent': '#0284c7',
      '--color-accent-hover': '#0ea5e9',
      '--color-accent-dim': '#0369a1',
      '--color-bg-deep': '#f0f9ff',
      '--color-bg-surface': '#e0f2fe',
      '--color-bg-raised': '#bae6fd',
      '--color-bg-hover': '#a5d8f5',
      '--color-bg-active': '#7dd3fc',
      '--color-purple': '#0ea5e9',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: '#10b981',
    dark: {
      '--color-accent': '#10b981',
      '--color-accent-hover': '#34d399',
      '--color-accent-dim': '#059669',
      '--color-bg-deep': '#0a1410',
      '--color-bg-surface': '#0f1c16',
      '--color-bg-raised': '#14261e',
      '--color-bg-hover': '#1a3028',
      '--color-bg-active': '#1e3a30',
      '--color-purple': '#34d399',
    },
    light: {
      '--color-accent': '#059669',
      '--color-accent-hover': '#10b981',
      '--color-accent-dim': '#047857',
      '--color-bg-deep': '#f0fdf4',
      '--color-bg-surface': '#dcfce7',
      '--color-bg-raised': '#bbf7d0',
      '--color-bg-hover': '#a7f3d0',
      '--color-bg-active': '#86efac',
      '--color-purple': '#10b981',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    swatch: '#f43f5e',
    dark: {
      '--color-accent': '#f43f5e',
      '--color-accent-hover': '#fb7185',
      '--color-accent-dim': '#e11d48',
      '--color-bg-deep': '#140a0e',
      '--color-bg-surface': '#1c0f14',
      '--color-bg-raised': '#26141c',
      '--color-bg-hover': '#301a24',
      '--color-bg-active': '#3a1e2c',
      '--color-purple': '#fb7185',
    },
    light: {
      '--color-accent': '#e11d48',
      '--color-accent-hover': '#f43f5e',
      '--color-accent-dim': '#be123c',
      '--color-bg-deep': '#fff1f2',
      '--color-bg-surface': '#ffe4e6',
      '--color-bg-raised': '#fecdd3',
      '--color-bg-hover': '#fda4af',
      '--color-bg-active': '#fb7185',
      '--color-purple': '#f43f5e',
    },
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: '#f59e0b',
    dark: {
      '--color-accent': '#f59e0b',
      '--color-accent-hover': '#fbbf24',
      '--color-accent-dim': '#d97706',
      '--color-bg-deep': '#14100a',
      '--color-bg-surface': '#1c160f',
      '--color-bg-raised': '#261e14',
      '--color-bg-hover': '#30261a',
      '--color-bg-active': '#3a2e1e',
      '--color-purple': '#fbbf24',
    },
    light: {
      '--color-accent': '#d97706',
      '--color-accent-hover': '#f59e0b',
      '--color-accent-dim': '#b45309',
      '--color-bg-deep': '#fffbeb',
      '--color-bg-surface': '#fef3c7',
      '--color-bg-raised': '#fde68a',
      '--color-bg-hover': '#fcd34d',
      '--color-bg-active': '#fbbf24',
      '--color-purple': '#f59e0b',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    swatch: '#64748b',
    dark: {
      '--color-accent': '#64748b',
      '--color-accent-hover': '#94a3b8',
      '--color-accent-dim': '#475569',
      '--color-bg-deep': '#0c0e12',
      '--color-bg-surface': '#12151a',
      '--color-bg-raised': '#1a1e26',
      '--color-bg-hover': '#222730',
      '--color-bg-active': '#2a303c',
      '--color-purple': '#94a3b8',
    },
    light: {
      '--color-accent': '#475569',
      '--color-accent-hover': '#64748b',
      '--color-accent-dim': '#334155',
      '--color-bg-deep': '#f8fafc',
      '--color-bg-surface': '#f1f5f9',
      '--color-bg-raised': '#e2e8f0',
      '--color-bg-hover': '#cbd5e1',
      '--color-bg-active': '#94a3b8',
      '--color-purple': '#64748b',
    },
  },
];

/** Apply a color scheme's CSS variables to the document root. */
export function applyColorScheme(schemeId: string, theme: 'dark' | 'light'): void {
  const scheme = COLOR_SCHEMES.find((s) => s.id === schemeId);
  const root = document.documentElement;

  // Clear any previously applied scheme variables
  for (const s of COLOR_SCHEMES) {
    for (const key of Object.keys(s.dark)) root.style.removeProperty(key);
    for (const key of Object.keys(s.light)) root.style.removeProperty(key);
  }

  if (!scheme) return; // default indigo — no overrides
  const vars = theme === 'dark' ? scheme.dark : scheme.light;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
