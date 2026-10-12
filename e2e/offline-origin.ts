import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

/** Test-owned loopback origin that can really disappear after SW installation.
 * No routing interception or offline emulation: cached SW responses remain
 * usable in every engine while uncached network requests genuinely fail. */
export async function startOfflineOrigin(options: {
  outputDir?: string;
  basePath?: string;
  serviceWorkerResponse?: 'unavailable' | 'deferred';
} = {}) {
  const root = resolve(options.outputDir ?? 'dist');
  const requestedPath = options.basePath ?? '/';
  if (!requestedPath.startsWith('/') || requestedPath.includes('?') || requestedPath.includes('#')) throw new Error('Offline fixture requires an absolute URL path');
  const basePath = requestedPath.endsWith('/') ? requestedPath : requestedPath + '/';
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  let serviceWorkerRequests = 0;
  let releaseServiceWorker!: () => void;
  const serviceWorkerGate = new Promise<void>(resolve => { releaseServiceWorker = resolve; });
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://fixture.invalid').pathname);
      if (!pathname.startsWith(basePath)) { res.writeHead(404).end(); return; }
      const relative = pathname.slice(basePath.length) || 'index.html';
      if (relative === 'sw.js') {
        serviceWorkerRequests += 1;
        if (options.serviceWorkerResponse === 'unavailable') {
          res.writeHead(503, { 'Cache-Control': 'no-store' }).end();
          return;
        }
        if (options.serviceWorkerResponse === 'deferred') await serviceWorkerGate;
        if (res.destroyed) return;
      }
      const file = resolve(root, relative);
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Offline fixture did not bind');
  const origin = 'http://127.0.0.1:' + address.port;
  const stop = async () => {
    releaseServiceWorker();
    if (!server.listening) return;
    const stopped = new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    server.closeAllConnections();
    await stopped;
  };
  return { origin, basePath, url: origin + basePath, stop, releaseServiceWorker,
    serviceWorkerRequestCount: () => serviceWorkerRequests };
}
