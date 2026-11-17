/**
 * The standalone file now carries an image-only CSP. The connection preflight
 * must keep treating it as a build without connection limits, while the hosted
 * policy (connect-src) still refuses unconfigured origins.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assertConfiguredConnection } from '../lib/connection-policy';

function setPolicy(content: string | undefined, connectOrigins?: string) {
  document.head.innerHTML = '';
  if (content !== undefined) {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = content;
    document.head.appendChild(meta);
  }
  if (connectOrigins !== undefined) {
    const meta = document.createElement('meta');
    meta.name = 'threatcaddy-connect-origins';
    meta.content = connectOrigins;
    document.head.appendChild(meta);
  }
}
afterEach(() => { document.head.innerHTML = ''; });

const LAN_LLM = 'http://192.168.1.50:11434/v1/chat/completions';
const TEAM_SERVER = 'https://team.example/api/auth/login';

describe('assertConfiguredConnection', () => {
  it('allows any endpoint in the standalone file, whose policy only limits images', () => {
    setPolicy("img-src 'self' data: blob: https://*.basemaps.cartocdn.com");
    expect(() => assertConfiguredConnection(LAN_LLM)).not.toThrow();
    expect(() => assertConfiguredConnection(TEAM_SERVER)).not.toThrow();
  });

  it('allows any endpoint without a build policy', () => {
    setPolicy(undefined);
    expect(() => assertConfiguredConnection(LAN_LLM)).not.toThrow();
  });

  it('refuses unconfigured origins under the hosted policy and allows configured ones', () => {
    setPolicy("default-src 'self'; img-src 'self' data:; connect-src 'self' http://localhost:*;", 'https://team.example wss://team.example');
    expect(() => assertConfiguredConnection(LAN_LLM)).toThrow(/does not allow connections to http:\/\/192\.168\.1\.50:11434/);
    expect(() => assertConfiguredConnection(TEAM_SERVER)).not.toThrow();
    expect(() => assertConfiguredConnection('http://localhost:11434/v1')).not.toThrow();
  });

  it('treats a policy with only default-src as limiting connections', () => {
    setPolicy("default-src 'self'");
    expect(() => assertConfiguredConnection(LAN_LLM)).toThrow(/does not allow connections/);
  });
});
