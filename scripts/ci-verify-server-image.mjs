// Acceptance check for the exact Docker image that CI may later promote.
// Supports an isolated Docker bridge fixture, or Linux host networking with a
// dedicated empty test database.
// The server will migrate this test database; never point it at retained data.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.env.TEST_SERVER_IMAGE;
const isolated = process.env.TEST_ISOLATED_POSTGRES === '1';
let databaseUrl = process.env.TEST_DATABASE_URL;
if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]+$/.test(image)) {
  throw new Error('TEST_SERVER_IMAGE must identify an already built test image');
}
if (isolated && databaseUrl) throw new Error('Isolated mode does not accept an existing TEST_DATABASE_URL');
if (!isolated && !databaseUrl) throw new Error('TEST_DATABASE_URL or TEST_ISOLATED_POSTGRES=1 is required');
const database = databaseUrl ? new URL(databaseUrl) : undefined;
if (database && (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    || !/^\/threatcaddy_test(?:_[a-z0-9_]+)?$/.test(database.pathname)
    || database.search || database.hash)) {
  throw new Error('Refusing a database outside a local threatcaddy_test namespace');
}
if (!isolated && process.platform !== 'linux') {
  throw new Error('Image acceptance uses Linux host networking; run it on the CI Linux runner');
}

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    // Environment values are passed by name below, so this never prints keys.
    throw new Error(`docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }
  return args[0] === 'logs'
    ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    : result.stdout?.trim() ?? '';
}

const keys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'production',
  JWT_PRIVATE_KEY: keys.privateKey,
  JWT_PUBLIC_KEY: keys.publicKey,
  BOT_MASTER_KEY: randomBytes(32).toString('hex'),
  ADMIN_SECRET: randomBytes(32).toString('hex'),
  PORT: '3001',
  ADMIN_PORT: '3002',
  FILE_STORAGE_PATH: '/data/files',
  SERVER_NAME: `Image acceptance ${randomBytes(8).toString('hex')}`,
});

let container;
let expectedVersion;
let network;
let postgres;
let serverOrigin = 'http://127.0.0.1:3001';
const fixtureId = `threatcaddy-image-${randomBytes(8).toString('hex')}`;
const labels = ['--label', `com.threatcaddy.acceptance=${fixtureId}`];
function refreshServerOrigin() {
  if (!isolated) return;
  const binding = docker(['port', container, '3001/tcp']);
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Fixture did not publish an isolated loopback port');
  serverOrigin = `http://${binding}`;
}
async function assertReady(label, expectedInitializations) {
  const deadline = Date.now() + 60_000;
  let lastFailure = 'No health response';
  while (Date.now() < deadline) {
    const state = docker(['inspect', '--format', '{{.State.Running}}', container]);
    if (state !== 'true') throw new Error(`${label}: server exited before readiness`);
    const logs = docker(['logs', '--tail', '200', container]);
    if (/Failed to start server|Uncaught exception|Unhandled promise rejection|Failed to clean up stale bot runs|Failed to load bot/.test(logs)) {
      throw new Error(`${label}: image logged initialization errors`);
    }
    const initialized = (logs.match(/BotManager initialized/g) ?? []).length >= expectedInitializations;
    try {
      const response = await fetch(`${serverOrigin}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      const health = await response.json();
      if (initialized && response.status === 200 && health.status === 'ok'
          && health.db === 'connected' && health.storage === 'accessible') {
        if (health.version !== expectedVersion) {
          throw new Error(`Health version ${health.version} differs from image package version ${expectedVersion}`);
        }
        // Do not accept a brief healthy response followed by failed initialization.
        await delay(2_000);
        if (docker(['inspect', '--format', '{{.State.Running}}', container]) !== 'true') {
          throw new Error('Server exited immediately after health response');
        }
        const stableResponse = await fetch(`${serverOrigin}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        const stableHealth = await stableResponse.json();
        if (!stableResponse.ok || stableHealth.status !== 'ok'
            || stableHealth.db !== 'connected' || stableHealth.storage !== 'accessible'
            || stableHealth.version !== expectedVersion) {
          throw new Error('Image lost health or package identity during the startup stability check');
        }
        const info = await fetch(`${serverOrigin}/api/server/info`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!info.ok) throw new Error(`Server info returned ${info.status}`);
        const serverInfo = await info.json();
        if (serverInfo.serverName !== process.env.SERVER_NAME) {
          throw new Error('Server info does not identify this test image instance');
        }
        const settledLogs = docker(['logs', '--tail', '200', container]);
        if (/Failed to start server|Uncaught exception|Unhandled promise rejection|Failed to clean up stale bot runs|Failed to load bot/.test(settledLogs)) {
          throw new Error('Image logged initialization errors after health response');
        }
        console.log(`${label}: database, storage and public server info are available`);
        return;
      }
      lastFailure = `Initialized=${initialized}; health returned ${response.status}: ${JSON.stringify(health)}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await delay(1_000);
  }
  throw new Error(`${label}: readiness timed out: ${lastFailure}`);
}

try {
  if (isolated) {
    network = docker(['network', 'create', ...labels, fixtureId]);
    Object.assign(process.env, { POSTGRES_USER: 'tc_test', POSTGRES_PASSWORD: randomBytes(24).toString('hex'), POSTGRES_DB: 'threatcaddy_test_image' });
    postgres = docker(['run', '--detach', ...labels, '--network', network, '--network-alias', 'fixture-db',
      '--tmpfs', '/var/lib/postgresql/data:rw',
      ...['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'].flatMap(name => ['--env', name]), 'postgres:17-alpine']);
    databaseUrl = `postgres://tc_test:${process.env.POSTGRES_PASSWORD}@fixture-db:5432/threatcaddy_test_image`;
    process.env.DATABASE_URL = databaseUrl;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (docker(['exec', postgres, 'pg_isready', '-U', 'tc_test', '-d', 'threatcaddy_test_image'], { allowFailure: true }).includes('accepting connections')) {
        ready = true;
        break;
      }
      await delay(1_000);
    }
    if (!ready) throw new Error('Isolated fixture PostgreSQL did not become ready');
  }
  const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  const metadata = JSON.parse(docker(['run', '--rm', ...labels, '--network', 'none', '--entrypoint', 'node', imageId,
    '-p', 'JSON.stringify({ version: JSON.parse(require("node:fs").readFileSync("/app/package.json", "utf8")).version, node: process.versions.node })']));
  const expectedNode = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
  if (metadata.node !== expectedNode) {
    throw new Error(`Image Node ${metadata.node} differs from the verified runtime ${expectedNode}`);
  }
  expectedVersion = metadata.version;
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(expectedVersion)) {
    throw new Error('Image package has no valid version');
  }
  container = docker(['run', '--detach', ...labels,
    ...(isolated ? ['--network', network, '--publish', '127.0.0.1::3001'] : ['--network', 'host']),
    ...['DATABASE_URL', 'NODE_ENV', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY',
      'BOT_MASTER_KEY', 'ADMIN_SECRET', 'PORT', 'ADMIN_PORT', 'FILE_STORAGE_PATH', 'SERVER_NAME']
      .flatMap((name) => ['--env', name]), imageId]);
  refreshServerOrigin();
  await assertReady('Initial image startup', 1);
  docker(['stop', '--time', '10', container]);
  if (docker(['inspect', '--format', '{{.State.ExitCode}}', container]) !== '0') {
    throw new Error('Healthy image did not shut down cleanly before restart');
  }
  docker(['start', container]);
  refreshServerOrigin();
  await assertReady('Image restart after migration', 2);
  console.log(`Verified image ${imageId}`);
} catch (error) {
  if (container) console.error(docker(['logs', '--tail', '200', container], { allowFailure: true }));
  throw error;
} finally {
  if (container) docker(['rm', '--force', container], { allowFailure: true });
  if (postgres) docker(['rm', '--force', postgres], { allowFailure: true });
  if (network) docker(['network', 'rm', network], { allowFailure: true });
}
