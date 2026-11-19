// @vitest-environment node
/**
 * SITE-8 / NARRATIVE-5 / SITE-10: the hosted site publishes an RFC 9116
 * security.txt, and its privacy policy states that threatcaddy.com loads no
 * analytics and that no integration catalog is fetched.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { securityTxtExpiry, securityTxtRenewalWarning } from '../../build/security-txt';

vi.mock('vite-plugin-pwa', () => ({ VitePWA: () => ({ name: 'vite-plugin-pwa-under-test' }) }));
// The hosted config reads VITE_* values from .env files; this test needs none of them.
vi.mock('vite', async (importOriginal) => ({ ...(await importOriginal<typeof import('vite')>()), loadEnv: () => ({}) }));

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

// RFC 9116: consumers treat an expired file as stale. Every build says when it
// is due; none fails on a date, so an older release still builds after it.
describe('security.txt renewal', () => {
  const file = 'Contact: https://example.invalid/report\nExpires: 2027-11-17T23:59:59Z\n';
  const at = (date: string) => Date.parse(date);

  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('stays quiet until 30 days before Expires, then asks for renewal', () => {
    expect(securityTxtRenewalWarning(file, at('2027-10-18T00:00:00Z'))).toBeUndefined();
    expect(securityTxtRenewalWarning(file, at('2027-10-19T00:00:00Z'))).toBe(
      'public/.well-known/security.txt expires on 2027-11-17T23:59:59Z, in 29 days: renew Expires (at most a year ahead) before publishing.');
    expect(securityTxtRenewalWarning(file, at('2027-11-18T00:00:00Z'))).toBe(
      'public/.well-known/security.txt expired on 2027-11-17T23:59:59Z: renew Expires (at most a year ahead) before publishing.');
    expect(securityTxtRenewalWarning('Contact: https://example.invalid/report\n', at('2027-01-01T00:00:00Z'))).toBe(
      'public/.well-known/security.txt has no valid Expires field.');
  });

  it('warns in the build log, as a GitHub Actions annotation there, and never fails the build', () => {
    const warn = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const start = (now: string) => {
      const plugin = securityTxtExpiry(resolve(__dirname, '../../public/.well-known/security.txt'), () => at(now));
      expect(plugin.apply).toBe('build');
      (plugin.buildStart as unknown as (this: { warn: typeof warn }) => void).call({ warn });
    };
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    start('2026-11-19T00:00:00Z');
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    start('2027-12-01T00:00:00Z');
    const message = 'public/.well-known/security.txt expired on 2027-11-17T23:59:59Z: renew Expires (at most a year ahead) before publishing.';
    expect(warn).toHaveBeenCalledExactlyOnceWith(message);
    expect(log).toHaveBeenCalledExactlyOnceWith(`::warning title=security.txt::${message}`);
    vi.stubEnv('GITHUB_ACTIONS', '');
    start('2027-12-01T00:00:00Z');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });

  it('is checked by the hosted build, which publishes the file', async () => {
    const { default: config } = await import('../../vite.config');
    const resolved = await (config as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)({ mode: 'production', command: 'build', isSsrBuild: false, isPreview: false });
    const plugins = ((resolved.plugins ?? []) as PluginOption[]).flat(Infinity as 1).filter(Boolean) as Plugin[];
    expect(plugins.map(plugin => plugin.name)).toContain('security-txt-expiry');
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
