import { describe, expect, it } from 'vitest';
import { applyDeploymentPolicy, deploymentOrigins } from '../lib/deployment-policy';

const html = '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\' https://static.cloudflareinsights.com; connect-src \'self\';" /></head><body></body></html>';

describe('explicit deployment privacy and connection policy', () => {
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
