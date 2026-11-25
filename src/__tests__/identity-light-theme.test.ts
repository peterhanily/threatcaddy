/**
 * Identity chips and the chat Sources chip stay readable in the light theme. Every palette text
 * colour they use is remapped for it in index.css (a pale colour that is not becomes about 1.2:1),
 * and each remapped colour reaches WCAG AA (4.5:1) on the light theme's card and hover backgrounds,
 * including under the Actor chips' purple tint. Gray backgrounds with opacity, which the light theme
 * does not remap, are not used.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chip from '../components/Identities/IdentityChip.tsx?raw';
import chatMessage from '../components/Chat/ChatMessage.tsx?raw';

// Read from disk: the test runner hands CSS imports over empty.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const remaps = new Map([...css.matchAll(/^\.light \.(text-[a-z]+-\d{3})\s*\{\s*color:\s*(#[0-9a-f]{6})/gim)].map(match => [match[1], match[2]]));
// The light theme's own token values (the second definition of each in index.css).
const lightToken = (name: string) => [...css.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'gi'))].at(-1)?.[1] ?? '#000000';
// Any Tailwind palette colour (theme tokens such as text-text-secondary have no shade number).
const paletteText = (source: string) => [...new Set([...source.matchAll(/\btext-[a-z]+-\d{2,3}\b/g)].map(match => match[0]))];

const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const mix = (top: number[], alpha: number, under: number[]) => top.map((value, index) => value * alpha + under[index] * (1 - alpha));
const luminance = (channels: number[]) => {
  const [r, g, b] = channels.map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
// Tailwind's purple-500 (approximately, in sRGB), the Actor chips' 15 % tint.
const PURPLE_500 = [168, 85, 247];

describe('identity colours in the light theme', () => {
  const backgrounds = { card: rgb(lightToken('bg-raised')), hover: rgb(lightToken('bg-hover')) };

  it('uses only remapped text colours in the timeline chips, each at least 4.5:1 on cards, hover and the purple tint', () => {
    const used = paletteText(chip);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter(name => !remaps.has(name))).toEqual([]);
    expect(chip).not.toMatch(/\bbg-gray-\d{3}\/\d+/);
    for (const name of used) {
      const colour = rgb(remaps.get(name) ?? '#ffffff');
      for (const [where, background] of Object.entries(backgrounds)) {
        expect(contrast(colour, background), `${name} on ${where}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colour, mix(PURPLE_500, 0.15, background)), `${name} on tinted ${where}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives identities in the chat Sources list a remapped colour of at least 4.5:1', () => {
    const identityColour = /identity:\s*'(text-[a-z]+-\d{3})'/.exec(chatMessage)?.[1] ?? '';
    expect(remaps.has(identityColour)).toBe(true);
    for (const background of Object.values(backgrounds)) expect(contrast(rgb(remaps.get(identityColour) ?? '#ffffff'), background)).toBeGreaterThanOrEqual(4.5);
  });
});
