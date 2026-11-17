import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_SCHEMES, applyColorScheme } from '../lib/theme-schemes';
import { SyncErrorBanner } from '../components/Common/SyncErrorBanner';

vi.mock('../contexts/UIModalContext', () => ({
  useUIModals: () => ({ screenshareMaxLevel: null, openSettings: () => {}, setForceAnalystMode: () => {}, setMobileSidebarOpen: () => {} }),
}));

type Theme = 'dark' | 'light';
// Vitest runs with css: false, so a ?raw CSS import would be empty.
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(match => [match[1], match[2].toLowerCase()]));
}
function lightRemap(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\.light ${escaped}\\s*\\{\\s*${property}:\\s*(#[0-9a-f]{6});`, 'i').exec(css);
  if (!match) throw new Error(`Missing light remap for ${selector}`);
  return match[1].toLowerCase();
}

const defaults: Record<Theme, Record<string, string>> = {
  dark: tokens(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''),
  light: tokens(/\n\.light\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''),
};
// Surfaces a focused control can sit on, plus the unfocused input border.
// Dark uses Tailwind 4's grays (oklch converted to sRGB); light uses the
// remaps in index.css.
const grays: Record<Theme, Record<string, string>> = {
  dark: { 'gray-950': '#030712', 'gray-900': '#101828', 'gray-800': '#1e2939', 'border-gray-700': '#364153' },
  light: {
    'gray-950': lightRemap('.bg-gray-950', 'background-color'),
    'gray-900': lightRemap('.bg-gray-900', 'background-color'),
    'gray-800': lightRemap('.bg-gray-800', 'background-color'),
    'border-gray-700': lightRemap('.border-gray-700', 'border-color'),
  },
};
const surfaces = ['--color-bg-deep', '--color-bg-surface', '--color-bg-raised', '--color-bg-hover'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}
/** Component source lines (file:line) matching a class pattern. */
const offenders = (pattern: RegExp) => sources(resolve(__dirname, '../components'))
  .flatMap(file => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => pattern.test(line) ? [`${file.split('/src/')[1]}:${index + 1}`] : []));

afterEach(() => applyColorScheme('indigo', 'dark'));

describe('keyboard focus indicator contrast (WCAG 1.4.11)', () => {
  for (const scheme of COLOR_SCHEMES) {
    for (const theme of ['dark', 'light'] as const) {
      it(`${scheme.id} ${theme}: the focus ring reaches 3:1 on every surface and against the unfocused border`, () => {
        const token = (name: string) => scheme[theme][name] ?? defaults[theme][name];
        // A scheme that recolours the accent must also set its own ring, not inherit indigo's.
        if (scheme[theme]['--color-accent']) expect(scheme[theme]['--color-focus-ring'], 'scheme focus ring').toBeDefined();
        const ring = token('--color-focus-ring');
        expect(ring, 'focus ring token').toMatch(/^#[0-9a-f]{6}$/i);
        const against = { ...Object.fromEntries(surfaces.map(name => [name, token(name)])), ...grays[theme] };
        for (const [name, color] of Object.entries(against)) {
          expect(contrast(ring, color), `${ring} on ${name} ${color}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it('keeps white text on the default filled accent at 4.5:1', () => {
    expect(contrast('#ffffff', defaults.dark['--color-accent'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', defaults.light['--color-accent'])).toBeGreaterThanOrEqual(4.5);
  });

  it('draws focus outlines, focused borders and focus rings with the focus token', () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-focus-ring\);/);
    expect(css).toMatch(/\.focus\\:border-accent:focus\s*\{\s*border-color:\s*var\(--color-focus-ring\);/);
    expect(css).toMatch(/\.focus\\:ring-accent:focus\s*\{\s*--tw-ring-color:\s*var\(--color-focus-ring\);/);
    expect(css).toMatch(/\.focus-visible\\:outline-accent:focus-visible\s*\{\s*outline-color:\s*var\(--color-focus-ring\);/);
  });

  it('adds a ring to outline-less inputs whose unfocused border is gray-600', () => {
    // The focus token reaches only 1.96-2.96:1 against a gray-600 border in
    // several schemes, so recolouring that 1px border is not enough.
    expect(offenders(/^(?=.*(?<![\w:-])border-gray-600(?![\w/-]))(?=.*focus:outline-none)(?=.*focus:border-accent)(?!.*focus:ring-[12] focus:ring-accent(?![\w-]))/)).toEqual([]);
  });

  it('clears a scheme focus ring when switching back to the default scheme', () => {
    applyColorScheme('ocean', 'dark');
    expect(document.documentElement.style.getPropertyValue('--color-focus-ring')).not.toBe('');
    applyColorScheme('indigo', 'dark');
    expect(document.documentElement.style.getPropertyValue('--color-focus-ring')).toBe('');
  });
});

describe('accent foreground utilities', () => {
  // --color-accent and --color-purple are fill colours (2.8:1 and 4.0:1 in the
  // dark theme). Only .text-accent, hover:text-accent(-hover) and .text-purple
  // are remapped to the readable *-text tokens in index.css.
  for (const scheme of COLOR_SCHEMES) {
    for (const theme of ['dark', 'light'] as const) {
      it(`${scheme.id} ${theme}: accent and purple text follow the scheme and reach 4.5:1 on every surface`, () => {
        const token = (name: string) => scheme[theme][name] ?? defaults[theme][name];
        const backgrounds = Object.entries(grays[theme]).filter(([name]) => !name.startsWith('border-'));
        // Selected items put accent and purple text on --color-bg-active (sidebar, IOC toggles).
        const textSurfaces = [...surfaces, '--color-bg-active'];
        const against = { ...Object.fromEntries(textSurfaces.map(surface => [surface, token(surface)])), ...Object.fromEntries(backgrounds) };
        for (const name of ['--color-accent-text', '--color-purple-text']) {
          // A scheme that recolours the accent must not fall back to indigo text.
          if (scheme[theme]['--color-accent']) expect(scheme[theme][name], `${name} override`).toBeDefined();
          for (const [surface, color] of Object.entries(against)) {
            expect(contrast(token(name), color), `${name} ${token(name)} on ${surface} ${color}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }

  it('uses no translucent or state variant of the fill colours for text and icons', () => {
    expect(offenders(/(?<![\w-])(?:[\w-]+:)*text-(?:accent|purple)\/\d+/)).toEqual([]);
    expect(offenders(/(?<![\w-])(?!hover:)[\w-]+:text-accent(?![\w/-])/)).toEqual([]);
  });

  it('lets checked toggle labels change colour', () => {
    // .dark/.light .text-gray-N remaps are unlayered, so they always beat a
    // peer-checked:text-* utility and the checked label would never recolour.
    expect(offenders(/(?<![\w:-])text-gray-\d+(?![\w/-]).*peer-checked:text-|peer-checked:text-.*(?<![\w:-])text-gray-\d+(?![\w/-])/)).toEqual([]);
  });

  it('lets hover:text-accent recolour remapped gray text', () => {
    // .dark/.light .text-gray-N have the same specificity as
    // .hover\:text-accent:hover, so the hover rule must come later.
    const lastGrayRemap = Math.max(...[...css.matchAll(/^\.(?:dark|light) \.text-gray-\d+\s*\{/gm)].map(match => match.index));
    for (const selector of ['.hover\\:text-accent:hover', '.hover\\:text-accent-hover:hover']) {
      expect(css.indexOf(selector), selector).toBeGreaterThan(lastGrayRemap);
    }
  });

  it('puts white text on the 4.5:1 accent fill, not the purple fill', () => {
    expect(offenders(/(?<![\w-])bg-purple(?![\w/-]).*(?<![\w-])text-white(?![\w/-])|(?<![\w-])text-white(?![\w/-]).*(?<![\w-])bg-purple(?![\w/-])/)).toEqual([]);
  });
});

describe('light-theme emerald text', () => {
  // Tailwind 4 emerald-500 and amber-500 in sRGB. The chat approval card's Approve label is
  // text-emerald-400 on bg-emerald-500/20 (/30 on hover), inside the card's bg-amber-500/5.
  const emerald500 = '#00bc7d';
  const amber500 = '#fe9a00';
  const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const over = (base: string, top: string, alpha: number) =>
    `#${rgb(base).map((value, i) => Math.round(value * (1 - alpha) + rgb(top)[i] * alpha).toString(16).padStart(2, '0')).join('')}`;

  for (const scheme of COLOR_SCHEMES) {
    it(`${scheme.id} light: the approval card's Approve label reaches 4.5:1 at rest and on hover`, () => {
      const color = lightRemap('.text-emerald-400', 'color');
      const token = (name: string) => scheme.light[name] ?? defaults.light[name];
      // The card sits on a page, panel or raised surface, never on a row's --color-bg-hover fill.
      const cardSurfaces = surfaces.filter(name => name !== '--color-bg-hover');
      const backgrounds = Object.entries(grays.light).filter(([name]) => !name.startsWith('border-'));
      const against = { ...Object.fromEntries(cardSurfaces.map(name => [name, token(name)])), ...Object.fromEntries(backgrounds) };
      for (const [surface, background] of Object.entries(against)) {
        for (const alpha of [0.2, 0.3]) {
          const fill = over(over(background, amber500, 0.05), emerald500, alpha);
          expect(contrast(color, fill), `${color} on ${surface} ${background} + emerald-500/${alpha * 100}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('leaves the dark theme\'s emerald text alone', () => {
    expect([...css.matchAll(/^([^{}\n]*)\.text-emerald-400\s*\{/gm)].map(match => match[1].trim())).toEqual(['.light']);
  });
});

describe('light-theme amber text', () => {
  // Tailwind's amber 100-500 is 1.06-2.04:1 on light surfaces, so every plain
  // text-amber-N utility in the app needs a .light remap.
  const plainAmber = /(?<![\w:/-])text-amber-\d+(?![\w/-])/g;
  const srcDir = resolve(__dirname, '..');
  const shades = [...new Set(readdirSync(srcDir, { encoding: 'utf8', recursive: true })
    .filter(path => /\.tsx?$/.test(path) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(path))
    .flatMap(path => readFileSync(join(srcDir, path), 'utf8').match(plainAmber) ?? []))].sort();
  // Remapped gray fills and the CaddyShack --bg-* surfaces (e.g. the server
  // connection card). Selected-item --color-bg-active fills are not text surfaces here.
  const lightBackgrounds = {
    ...Object.fromEntries(['950', '900', '800', '700'].map(shade => [`gray-${shade}`, lightRemap(`.bg-gray-${shade}`, 'background-color')])),
    ...Object.fromEntries([...(/\n\.light\s*\{([^}]*--bg-primary[^}]*)\}/.exec(css)?.[1] ?? '').matchAll(/(--bg-[a-z]+):\s*(#[0-9a-f]{6});/gi)].map(match => [match[1], match[2].toLowerCase()])),
  };

  /** The light colour of the nearest text or background palette utility on the element or an ancestor. */
  function lightPaint(element: Element, kind: 'text' | 'bg'): string {
    const utility = new RegExp(`^${kind}-[a-z]+-\\d+$`);
    for (let node: Element | null = element; node; node = node.parentElement) {
      const name = [...node.classList].find(item => utility.test(item));
      if (name) return lightRemap(`.${name}`, kind === 'text' ? 'color' : 'background-color');
    }
    throw new Error(`No ${kind} colour on or above ${element.tagName}`);
  }

  for (const scheme of COLOR_SCHEMES) {
    it(`${scheme.id} light: every amber text shade in use reaches 4.5:1 on every light surface`, () => {
      expect(shades.length).toBeGreaterThan(0);
      const token = (name: string) => scheme.light[name] ?? defaults.light[name];
      const against = { ...Object.fromEntries(surfaces.map(name => [name, token(name)])), ...lightBackgrounds };
      for (const shade of shades) {
        const color = lightRemap(`.${shade}`, 'color');
        for (const [surface, background] of Object.entries(against)) {
          expect(contrast(color, background), `${shade} ${color} on ${surface} ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('keeps the sync error banner message and its Review button readable', () => {
    render(createElement(SyncErrorBanner, { error: 'Synthetic held-back note notice' }));
    for (const element of [screen.getByText('Synthetic held-back note notice'), screen.getByRole('button', { name: 'Review sync settings' })]) {
      const [text, background] = [lightPaint(element, 'text'), lightPaint(element, 'bg')];
      expect(contrast(text, background), `${element.tagName} ${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the dark-theme amber on surfaces that stay dark amber in the light theme', () => {
    // bg-amber-950 at 50% or more stays dark in both themes, where the dark
    // light-theme remap would be 1.4-2.1:1.
    const darkAmber = sources(resolve(__dirname, '../components')).filter(file => /(?<![\w:-])bg-amber-950\/[5-9]\d(?!\d)/.test(readFileSync(file, 'utf8')));
    expect(darkAmber.flatMap(file => readFileSync(file, 'utf8').split('\n')
      .flatMap((line, index) => line.match(plainAmber) ? [`${file.split('/src/')[1]}:${index + 1}`] : []))).toEqual([]);
  });
});
