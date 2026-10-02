import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { request } from 'node:http';
import { requestPinned } from '../src/lib/bounded-http.js';

describe('pinned HTTPS transport against an isolated local TLS server', () => {
  let directory: string;
  let server: https.Server;
  let port: number;
  let certificate: Buffer;
  let observedHost: string | undefined;
  let observedName: string | false | null;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'threatcaddy-tls-fixture-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
      '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:fixture.test'], { stdio: 'ignore' });
    certificate = await readFile(join(directory, 'cert.pem'));
    server = https.createServer({ key: await readFile(join(directory, 'key.pem')), cert: certificate }, (req, res) => {
      observedHost = req.headers.host;
      observedName = (req.socket as import('node:tls').TLSSocket).servername;
      if (req.url === '/slow') { res.writeHead(200); res.write('pending'); return; }
      if (req.url === '/redirect') { res.writeHead(302, { location: '/ordinary' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      res.end(gzipSync('ordinary status response'));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  function fetchFixture(path: string, signal = AbortSignal.timeout(3_000), maximum = 1024, hostname = 'fixture.test') {
    // Trust only this fixture certificate; normal hostname verification stays on.
    const transport: typeof request = ((url, options, callback) => https.request(url, { ...options, ca: certificate }, callback)) as typeof request;
    return requestPinned(new URL(`https://${hostname}:${port}${path}`), { address: '127.0.0.1', family: 4 }, {},
      { signal, maximum, request: transport });
  }
  it('preserves original Host and SNI while pinning the actual connection and decoding a bounded body', async () => {
    expect(await (await fetchFixture('/ordinary')).text()).toBe('ordinary status response');
    expect(observedHost).toBe(`fixture.test:${port}`);
    expect(observedName).toBe('fixture.test');
  });
  it('still requires the certificate to match the original hostname', async () => {
    await expect(fetchFixture('/ordinary', undefined, undefined, 'other.test')).rejects.toThrow(/Hostname\/IP does not match/);
  });
  it('keeps the deadline active after response headers arrive', async () => {
    await expect(fetchFixture('/slow', AbortSignal.timeout(100))).rejects.toThrow();
  });
  it('bounds decompressed response bytes', async () => {
    await expect(fetchFixture('/ordinary', undefined, 10)).rejects.toThrow('exceeds 10 bytes');
  });
  it('does not follow redirects outside the prechecked request', async () => {
    await expect(fetchFixture('/redirect')).rejects.toThrow('redirects are not permitted');
  });
});
