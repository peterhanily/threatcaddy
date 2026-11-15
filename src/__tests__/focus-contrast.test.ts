import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_SCHEMES, applyColorScheme } from '../lib/theme-schemes';

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
        const against = { ...Object.fromEntries(surfaces.map(surface => [surface, token(surface)])), ...Object.fromEntries(backgrounds) };
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

  it('puts white text on the 4.5:1 accent fill, not the purple fill', () => {
    expect(offenders(/(?<![\w-])bg-purple(?![\w/-]).*(?<![\w-])text-white(?![\w/-])|(?<![\w-])text-white(?![\w/-]).*(?<![\w-])bg-purple(?![\w/-])/)).toEqual([]);
  });
});
