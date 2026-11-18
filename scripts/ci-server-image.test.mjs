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
  assert.ok(docker.ignore?.some(rule => rule['dependency-name'] === 'node'
    && rule['update-types']?.includes('version-update:semver-major')), 'A runtime major needs a coordinated upgrade');
  // Docker gets no Dependabot security updates, so the version-update delay is the
  // whole delay for a Node security release. Dependabot's unset cooldown is 3 days.
  const intervalDays = { daily: 1, weekly: 7 }[docker.schedule?.interval];
  assert.ok(intervalDays, 'Use a daily or weekly schedule');
  assert.ok(intervalDays + (docker.cooldown?.['default-days'] ?? 3) <= 3,
    'A Node security base image must be proposed within about three days');
});

test('Node base bump guidance names every file the contract tests compare with .node-version', () => {
  const guidance = read('docs/repository-maintenance.md');
  const comment = read('.github/dependabot.yml');
  // .nvmrc and the Dockerfile stages are checked above; README.md by ci-docs-contract.test.mjs.
  for (const path of ['.node-version', '.nvmrc', 'README.md']) {
    assert.ok(guidance.includes(`\`${path}\``), `docs/repository-maintenance.md must name ${path}`);
    assert.ok(comment.includes(path), `.github/dependabot.yml must name ${path}`);
  }
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

test('Compose publishes the API on host loopback unless the operator opts in to another address', () => {
  const ports = load(read('docker-compose.yml')).services.server.ports;
  const effective = environment => ports.map(port => port.replace(/\$\{(\w+):-([^}]*)\}/g, (_, name, fallback) => environment[name] || fallback));
  assert.deepEqual(effective({}), ['127.0.0.1:3001:3001', '127.0.0.1:3002:3002']);
  // The opt-in moves only the API; administration stays on host loopback.
  assert.deepEqual(effective({ API_PUBLISH_ADDRESS: '0.0.0.0' }), ['0.0.0.0:3001:3001', '127.0.0.1:3002:3002']);
  const deployment = read('docs/deployment.md');
  const reference = deployment.match(/### Docker Compose Reference\n\n```yaml\n([\s\S]*?)```/)?.[1];
  assert.ok(reference, 'docs/deployment.md must keep its Compose reference');
  assert.deepEqual(load(reference).services.server.ports, ports, 'The documented Compose file must publish the same ports');
  assert.match(deployment, /API_PUBLISH_ADDRESS=0\.0\.0\.0/);
});
