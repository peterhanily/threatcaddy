import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ScratchDatabase } from './database.js';
import { serverRoot } from './migrations.js';

async function freePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback test port.');
  await new Promise<void>((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}

interface StagedServer {
  folder: string;
  serverName: string;
  credentials: Record<string, string>;
  close(): Promise<void>;
}

export async function stageBuiltServer(): Promise<StagedServer> {
  const folder = await mkdtemp(resolve(tmpdir(), 'threatcaddy-server-artifact-'));
  try {
    // Deliberately copy only build output and package metadata. Never inject migrations from src.
    await cp(resolve(serverRoot, 'dist'), resolve(folder, 'dist'), { recursive: true });
    await cp(resolve(serverRoot, 'package.json'), resolve(folder, 'package.json'));
    await symlink(resolve(serverRoot, 'node_modules'), resolve(folder, 'node_modules'), 'dir');
    await mkdir(resolve(folder, 'files'));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      folder,
      serverName: `ThreatCaddy integration fixture ${randomBytes(8).toString('hex')}`,
      // Preserve the same generated credentials across restarts, as a real installation must.
      credentials: {
        JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        BOT_MASTER_KEY: randomBytes(32).toString('hex'),
        ADMIN_SECRET: randomBytes(32).toString('hex'),
      },
      close: () => rm(folder, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

export async function bootBuiltServer(database: ScratchDatabase, artifact: StagedServer): Promise<void> {
  const { folder } = artifact;
  const port = await freePort();
  let adminPort = await freePort();
  while (adminPort === port) adminPort = await freePort();
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: folder,
    // Explicit allowlist: do not inherit credentials, DATABASE_URL, provider keys, or Docker access.
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      DATABASE_URL: database.url.toString(),
      DB_POOL_MAX: '2',
      PORT: String(port), ADMIN_PORT: String(adminPort),
      ...artifact.credentials,
      FILE_STORAGE_PATH: resolve(folder, 'files'),
      DOCKER_HOST: `unix://${resolve(folder, 'no-docker.sock')}`,
      SERVER_NAME: artifact.serverName,
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-24_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const exited = new Promise<void>(resolveExit => child.once('close', () => resolveExit()));
  let becameReady = false;
  let forcedShutdown = false;
  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      let health: Record<string, unknown> | undefined;
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Compiled server exited before readiness (${child.exitCode ?? child.signalCode}).\n${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) });
        if (response.ok) health = await response.json() as Record<string, unknown>;
      } catch { /* Poll until the startup deadline; errors are reported with process output below. */ }
      // Current health opens before async initialization. Require completion, then a stability period.
      if (health?.status === 'ok' && health.db === 'connected' && health.storage === 'accessible'
        && output.includes('BotManager initialized')) {
        await delay(500);
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Compiled server exited immediately after health response.\n${output}`);
        const stableResponse = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) });
        const stableHealth = await stableResponse.json() as Record<string, unknown>;
        if (!stableResponse.ok || stableHealth.status !== 'ok' || stableHealth.db !== 'connected' || stableHealth.storage !== 'accessible') throw new Error(`Compiled server lost health during its startup stability check.\n${output}`);
        const infoResponse = await fetch(`http://127.0.0.1:${port}/api/server/info`, { signal: AbortSignal.timeout(750) });
        const info = await infoResponse.json() as Record<string, unknown>;
        if (!infoResponse.ok || info.serverName !== artifact.serverName) throw new Error(`Compiled server identity did not match this test installation.\n${output}`);
        if (/Failed to start server|Uncaught exception|Unhandled promise rejection|Failed to clean up stale bot runs/.test(output)) throw new Error(`Compiled server logged initialization errors.\n${output}`);
        const pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) as { version: string };
        if (stableHealth.version !== pkg.version) throw new Error(`Compiled /health version ${String(stableHealth.version)} differs from package version ${pkg.version}.\n${output}`);
        becameReady = true;
        return;
      }
      await delay(100);
    }
    throw new Error(`Compiled server failed readiness within 20 seconds.\n${output}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(3_000)]);
      if (child.exitCode === null && child.signalCode === null) {
        forcedShutdown = true;
        child.kill('SIGKILL');
      }
    }
    await exited;
    if (becameReady && (forcedShutdown || child.exitCode !== 0)) throw new Error(`Healthy compiled server did not shut down cleanly (${child.exitCode ?? child.signalCode}).\n${output}`);
  }
}
