// @vitest-environment node
/**
 * SITE-8 / NARRATIVE-5 / SITE-10: the hosted site publishes an RFC 9116
 * security.txt, and its privacy policy states that threatcaddy.com loads no
 * analytics and that no integration catalog is fetched.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('security.txt', () => {
  const text = read('public/.well-known/security.txt');
  const fields = new Map<string, string[]>();
  for (const line of text.split('\n').filter(entry => entry && !entry.startsWith('#'))) {
    const [, name = line, value = ''] = /^([A-Za-z-]+): (\S+)$/.exec(line) ?? [];
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }

  it('names the private reporting route, the policy, the language and its canonical address', () => {
    expect([...fields.keys()].sort()).toEqual(['Canonical', 'Contact', 'Expires', 'Policy', 'Preferred-Languages']);
    expect(fields.get('Contact')).toEqual(['https://github.com/peterhanily/threatcaddy/security/advisories/new']);
    expect(fields.get('Policy')).toEqual(['https://github.com/peterhanily/threatcaddy/blob/main/SECURITY.md']);
    expect(fields.get('Preferred-Languages')).toEqual(['en']);
    expect(fields.get('Canonical')).toEqual(['https://threatcaddy.com/.well-known/security.txt']);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('expires once, no more than a year after it was written', () => {
    const expires = fields.get('Expires') ?? [];
    expect(expires).toHaveLength(1);
    expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const time = Date.parse(expires[0]);
    expect(time).toBeGreaterThan(Date.parse('2026-11-18T00:00:00Z'));
    expect(time).toBeLessThanOrEqual(Date.parse('2027-11-18T00:00:00Z'));
  });
});

describe('privacy policy', () => {
  const page = read('public/privacy.html').replace(/\s+/g, ' ');

  it('says the hosted site loads no analytics and links to private vulnerability reporting', () => {
    expect(page).toContain('threatcaddy.com loads no analytics');
    expect(page).toContain('href="https://github.com/peterhanily/threatcaddy/security/advisories/new"');
  });

  it('lists no integration catalog download among third-party requests', () => {
    expect(page).not.toMatch(/catalog/i);
  });
});
