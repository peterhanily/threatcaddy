import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const dockerfile = read('server/Dockerfile');
const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
// Node 24.22.3 (2026-11-10) is the security release for the http/http2/tls CVEs.
const NODE_SECURITY_FLOOR = [24, 22, 3];

test('both image stages use the recorded Node runtime by digest, at or above the security release', () => {
  const stages = [...dockerfile.matchAll(/^FROM node:(\d+\.\d+\.\d+)-alpine@sha256:([a-f0-9]{64})\b/gm)];
  assert.equal(stages.length, 2, 'Both Dockerfile stages must pin node:<version>-alpine by digest');
  assert.equal(stages[0][1], stages[1][1]);
  assert.equal(stages[0][2], stages[1][2]);
  const version = read('.node-version').trim();
  assert.equal(read('.nvmrc').trim(), version);
  assert.equal(stages[0][1], version, 'CI acceptance compares the image NODE_VERSION with .node-version');
  const order = version.split('.').map(Number).reduce((result, part, index) => result || part - NODE_SECURITY_FLOOR[index], 0);
  assert.ok(order >= 0, `Node ${version} is older than the ${NODE_SECURITY_FLOOR.join('.')} security release`);
});

test('Dependabot proposes new Node 24 server base images; the test above makes .node-version follow', () => {
  const updates = load(read('.github/dependabot.yml')).updates;
  const docker = updates.find(update => update['package-ecosystem'] === 'docker' && update.directory === '/server');
  assert.ok(docker, 'Nothing would report a newer node:<version>-alpine base for server/Dockerfile');
  assert.ok(docker.schedule?.interval);
  assert.ok(docker.ignore?.some(rule => rule['dependency-name'] === 'node'
    && rule['update-types']?.includes('version-update:semver-major')), 'A runtime major needs a coordinated upgrade');
});

test('runtime OS packages use minimum-version constraints, never exact revisions Alpine later removes', () => {
  const installs = [...dockerfile.matchAll(/apk add[^\n]*/g)].map(match => match[0]);
  assert.ok(installs.length > 0);
  for (const install of installs) {
    assert.doesNotMatch(install, /['"\s][a-z0-9][a-z0-9.+_-]*=[^\s'"]+/i, `Exact apk pin: ${install}`);
  }
  // CVE-2026-4738: the Node base ships an older zlib, so the floor must still upgrade it.
  assert.match(runtimeStage, /apk add --no-cache 'zlib>=1\.4-r0'/);
});

test('the runtime image defaults to production behaviour and reports its own health', () => {
  assert.match(runtimeStage, /^ENV NODE_ENV=production$/m);
  const healthcheck = runtimeStage.match(/^HEALTHCHECK (?:[^\n]*\\\n)*[^\n]*/m)?.[0];
  assert.ok(healthcheck, 'Runtime stage must declare a HEALTHCHECK');
  assert.match(healthcheck, /CMD \["node",/);
  assert.match(healthcheck, /\/health/);
  assert.ok(runtimeStage.indexOf('HEALTHCHECK') < runtimeStage.indexOf('CMD ["node", "dist/index.js"]'));
});

test('Compose bounds container logs for both services', () => {
  const compose = load(read('docker-compose.yml'));
  for (const name of ['server', 'db']) {
    const logging = compose.services[name].logging;
    assert.ok(logging, `${name} must bound its container logs`);
    assert.match(logging.options['max-size'], /^\d+m$/);
    assert.match(logging.options['max-file'], /^\d+$/);
  }
});
