import { describe, expect, it } from 'vitest';
import sourceHtml from '../../index.html?raw';
import { applyDeploymentPolicy, deploymentOrigins } from '../lib/deployment-policy';

const html = '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\' https://static.cloudflareinsights.com; connect-src \'self\';" /></head><body></body></html>';

describe('explicit deployment privacy and connection policy', () => {
  it('ships a source policy without invalid interior host wildcards or provider-wide replacements', () => {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(sourceHtml)?.[1];
    expect(policy).toBeDefined();
    // CSP host-part permits only a leading "*." wildcard (or a bare "*").
    // See https://www.w3.org/TR/CSP3/#grammardef-host-part.
    const hostSources = policy?.match(/(?:https?|wss?):\/\/[^\s;]+/g) ?? [];
    expect(hostSources.length).toBeGreaterThan(0);
    for (const expression of hostSources) {
      const host = expression.replace(/^[a-z]+:\/\//, '').split(/[/:]/)[0];
      expect(host, expression).toMatch(/^(?:\*\.)?[a-z\d-]+(?:\.[a-z\d-]+)*$/i);
    }
    expect(policy).not.toContain('https://*.amazonaws.com');
    expect(policy).not.toContain('https://*.oraclecloud.com');
  });
  it('supports regional storage through explicit origins without broad cloud-provider access', () => {
    const output = applyDeploymentPolicy(sourceHtml, {
      connectOrigins: 'https://backup.s3.eu-west-1.amazonaws.com https://objectstorage.eu-dublin-1.oraclecloud.com',
    });
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(output)?.[1];
    expect(policy).toBeDefined();
    const connectSources = policy?.split(';').find(directive => directive.trim().startsWith('connect-src '))?.trim().split(/\s+/).slice(1);
    expect(connectSources).toContain('https://backup.s3.eu-west-1.amazonaws.com');
    expect(connectSources).toContain('https://objectstorage.eu-dublin-1.oraclecloud.com');
    expect(connectSources).not.toContain('https://*.amazonaws.com');
    expect(connectSources).not.toContain('https://*.oraclecloud.com');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
  });
  it('ships no analytics script or analytics origins by default', () => {
    expect(applyDeploymentPolicy(html, {})).not.toContain('cloudflareinsights');
  });
  it('injects only the explicitly configured site token and matching CSP', () => {
    const output = applyDeploymentPolicy(html, { analyticsToken: 'a'.repeat(32) });
    expect(output.match(/beacon.min.js/g)).toHaveLength(1);
    expect(output).toContain(`"token":"${'a'.repeat(32)}"`);
    expect(output).toContain('connect-src \'self\' https://cloudflareinsights.com;');
  });
  it('adds exact remote server and websocket origins without weakening other directives', () => {
    const output = applyDeploymentPolicy(html, { connectOrigins: 'https://team.example.test:8443' });
    expect(output).toContain('connect-src \'self\' https://team.example.test:8443 wss://team.example.test:8443;');
    expect(output).toContain('script-src \'self\';');
  });
  it.each(['https://*.example.test', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test/?q=a', 'https://example.test/#a', 'data:text/plain,hello'])('rejects unsafe or ambiguous origin %s', value => {
    expect(() => deploymentOrigins(value)).toThrow();
  });
  it('rejects invalid analytics configuration', () => {
    expect(() => applyDeploymentPolicy(html, { analyticsToken: 'not-a-token' })).toThrow();
  });
});
