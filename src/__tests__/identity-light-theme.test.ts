/**
 * Identity chips and the chat Sources chip stay readable in the light theme: every palette text
 * colour they use is remapped for it in index.css (a pale colour that is not becomes about 1.2:1 on
 * the light background), and gray backgrounds with opacity, which the light theme does not remap,
 * are not used.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chip from '../components/Identities/IdentityChip.tsx?raw';
import chatMessage from '../components/Chat/ChatMessage.tsx?raw';

// Read from disk: the test runner hands CSS imports over empty.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const remapped = new Set([...css.matchAll(/^\.light \.(text-[a-z]+-\d{3})\s*\{/gm)].map(match => match[1]));
// Any Tailwind palette colour (theme tokens such as text-text-secondary have no shade number).
const paletteText = (source: string) => [...new Set([...source.matchAll(/\btext-[a-z]+-\d{2,3}\b/g)].map(match => match[0]))];

describe('identity colours in the light theme', () => {
  it('uses only text colours the light theme remaps, in the timeline chips', () => {
    const used = paletteText(chip);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter(name => !remapped.has(name))).toEqual([]);
    expect(chip).not.toMatch(/\bbg-gray-\d{3}\/\d+/);
  });

  it('uses a remapped colour for identities in the chat Sources list', () => {
    const identityColour = /identity:\s*'(text-[a-z]+-\d{3})'/.exec(chatMessage)?.[1];
    expect(identityColour && remapped.has(identityColour)).toBe(true);
  });
});
