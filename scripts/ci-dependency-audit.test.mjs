import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { evaluateAudit, parsePnpmLock, productionPaths, validateExceptions } from './ci-dependency-audit.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// Unmodified `--audit-level=high --json` output of the CI commands on 18 November 2026
// (pnpm 10.29.1 for root, npm 11.19.0 for server and extension).
const fixture = project => JSON.parse(read(`fixtures/dependency-audit/${project}-audit.json`));
const GHSA = 'GHSA-fc5q-39xc-vjpf';
const REVIEWED_PATH = '.>@excalidraw/excalidraw>sass>@parcel/watcher>picomatch';
const allowlist = () => ({ exceptions: [{
  id: GHSA, package: 'picomatch', severity: 'high', vulnerableVersions: '<=4.0.7', projects: ['root', 'server'],
  reviewed: '2026-11-18', reason: 'Fixture reason.', endsWhen: 'Fixture end.',
  reviewedProductionPaths: { root: [REVIEWED_PATH] },
}] });

// The root lockfile's graph around picomatch, in pnpm's lockfile v9 layout: lint tooling
// reaches it as a development dependency, and Excalidraw's Sass through an optional watcher.
const pnpmLock = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@excalidraw/excalidraw':
        specifier: ^0.18.1
        version: 0.18.1(react@19.3.1)
      react:
        specifier: ^19.3.1
        version: 19.3.1
    devDependencies:
      typescript:
        specifier: ~6.0.3
        version: 6.0.3
      typescript-eslint:
        specifier: ^8.72.1
        version: 8.72.1(typescript@6.0.3)

packages:

  '@excalidraw/excalidraw@0.18.1':
    resolution: {integrity: sha512-fixture}
    peerDependencies:
      react: ^17.0.2 || ^18.2.0 || ^19.0.0

snapshots:

  '@excalidraw/excalidraw@0.18.1(react@19.3.1)':
    dependencies:
      react: 19.3.1
      sass: 1.105.0

  '@parcel/watcher-linux-x64-glibc@2.6.0':
    optional: true

  '@parcel/watcher@2.6.0':
    dependencies:
      picomatch: 4.0.7
    optionalDependencies:
      '@parcel/watcher-linux-x64-glibc': 2.6.0
    optional: true

  '@typescript-eslint/typescript-estree@8.72.1(typescript@6.0.3)':
    dependencies:
      tinyglobby: 0.2.17
      typescript: 6.0.3
    transitivePeerDependencies:
      - supports-color

  fdir@6.5.0(picomatch@4.0.7):
    optionalDependencies:
      picomatch: 4.0.7

  immutable@5.1.9: {}

  picomatch@4.0.7: {}

  react@19.3.1: {}

  sass@1.105.0:
    dependencies:
      immutable: 5.1.9
    optionalDependencies:
      '@parcel/watcher': 2.6.0

  tinyglobby@0.2.17:
    dependencies:
      fdir: 6.5.0(picomatch@4.0.7)
      picomatch: 4.0.7

  typescript-eslint@8.72.1(typescript@6.0.3):
    dependencies:
      '@typescript-eslint/typescript-estree': 8.72.1(typescript@6.0.3)
      typescript: 6.0.3

  typescript@6.0.3: {}
`;
// server/package-lock.json flags for the same advisory: every location is development-only.
const serverLock = () => ({ name: 'threatcaddy-server', lockfileVersion: 3, requires: true, packages: {
  '': { name: 'threatcaddy-server', dependencies: { hono: '4.13.18' }, devDependencies: { vitest: '5.0.5' } },
  'node_modules/fdir': { version: '6.5.0', dev: true },
  'node_modules/hono': { version: '4.13.18' },
  'node_modules/picomatch': { version: '4.0.7', dev: true },
  'node_modules/tinyglobby': { version: '0.2.17', dev: true },
  'node_modules/vite': { version: '8.3.5', dev: true, peer: true },
  'node_modules/vitest': { version: '5.0.5', dev: true },
} });
const lockfiles = { root: pnpmLock, server: JSON.stringify(serverLock()), extension: JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }) };
const audit = (project, report, { status = 1, lockfile = lockfiles[project], exceptions = allowlist() } = {}) =>
  evaluateAudit({ project, report, status, exceptions, lockfile });

function withAdvisory(project, severity, id = 'GHSA-2222-3333-4444', name = 'synthetic-package') {
  const report = fixture(project);
  if (project === 'root') {
    report.advisories['9999999'] = { ...report.advisories['1247710'], id: 9999999, github_advisory_id: id,
      url: `https://github.com/advisories/${id}`, module_name: name, severity, vulnerable_versions: '<1.0.1', patched_versions: '>=1.0.1' };
  } else {
    report.vulnerabilities[name] = { name, severity, isDirect: false, effects: [], range: '<1.0.1', nodes: [`node_modules/${name}`], fixAvailable: true,
      via: [{ source: 9999999, name, dependency: name, title: 'Synthetic advisory', url: `https://github.com/advisories/${id}`, severity, cwe: [], cvss: {}, range: '<1.0.1' }] };
  }
  report.metadata.vulnerabilities[severity] += 1;
  return report;
}

test('the reviewed advisory alone passes the failing root and server audits; the clean extension audit passes', () => {
  const expected = [{ id: GHSA, package: 'picomatch', severity: 'high' }];
  assert.deepEqual(audit('root', fixture('root')), expected);
  assert.deepEqual(audit('server', fixture('server')), expected);
  assert.deepEqual(audit('extension', fixture('extension'), { status: '0' }), []);
});

test('moderate and lower advisories stay non-blocking, as without the exception', () => {
  assert.deepEqual(audit('server', withAdvisory('server', 'moderate')).map(advisory => advisory.id), [GHSA]);
});

for (const severity of ['high', 'critical']) test(`a second ${severity} advisory still fails`, () => {
  for (const project of ['root', 'server']) {
    assert.throws(() => audit(project, withAdvisory(project, severity)),
      new RegExp(`GHSA-2222-3333-4444 \\(synthetic-package, ${severity}\\) is not a reviewed exception for ${project}`));
  }
});

test('the exception covers only its own package and listed projects', () => {
  assert.throws(() => audit('server', withAdvisory('server', 'high', GHSA)), /GHSA-fc5q-39xc-vjpf \(synthetic-package, high\) is not a reviewed exception/);
  // The extension is not listed: the same advisory there fails.
  assert.throws(() => audit('extension', fixture('server')), /GHSA-fc5q-39xc-vjpf \(picomatch, high\) is not a reviewed exception for extension/);
  const unlisted = fixture('server');
  unlisted.vulnerabilities.picomatch.via[0].url = 'https://example.invalid/advisory';
  assert.throws(() => audit('server', unlisted), /advisory without a GHSA id \(picomatch, high\) is not a reviewed exception/);
});

test('audit and registry errors still fail', () => {
  // Captured from pnpm 10.29.1 and npm 11.19.0 against an unreachable registry (exit status 1).
  const pnpmError = { error: { code: 'ECONNREFUSED', message: 'request to http://localhost:1/-/npm/v1/security/audits failed, reason: ' } };
  const npmError = { message: 'request to http://localhost:1/-/npm/v1/security/advisories/bulk failed, reason: ', error: { summary: '', detail: '' } };
  assert.throws(() => audit('root', pnpmError), /the audit reported an error/);
  assert.throws(() => audit('server', npmError), /the audit reported an error/);
  for (const report of [undefined, null, [], 'text']) assert.throws(() => audit('root', report), /did not produce a JSON report/);
  for (const status of [2, '130', '', null]) assert.throws(() => audit('server', fixture('server'), { status }), /unexpected audit exit status/);
  const clean = fixture('extension');
  assert.throws(() => audit('extension', clean, { status: 1 }), /exited 1 but lists 0 high or critical advisories/);
  assert.throws(() => audit('server', fixture('server'), { status: 0 }), /exited 0 but lists 1 high or critical advisories/);
});

test('malformed or partly hidden reports fail instead of passing', () => {
  for (const [project, change] of [
    ['root', report => { delete report.advisories; }],
    ['root', report => { delete report.metadata; }],
    ['root', report => { report.advisories['1247710'].severity = 'High'; }],
    ['root', report => { delete report.advisories['1247710'].patched_versions; }],
    ['root', report => { delete report.advisories['1247710'].findings; }],
    ['root', report => { report.advisories['1247710'].findings = []; }],
    ['root', report => { report.advisories['1247710'].findings[0].paths = []; }],
    ['server', report => { report.auditReportVersion = 1; }],
    ['server', report => { report.vulnerabilities.picomatch.via[0].severity = 'severe'; }],
    ['server', report => { report.vulnerabilities.fdir.via = ['unlisted-package']; }],
    ['server', report => { report.vulnerabilities.picomatch.nodes = 'node_modules/picomatch'; }],
  ]) {
    const report = fixture(project);
    change(report);
    assert.throws(() => audit(project, report), /Dependency audit rejected/);
  }
  // pnpm's own auditConfig ignore keeps the count but drops the advisory: fail rather than trust it.
  const hidden = fixture('root');
  hidden.advisories = {};
  assert.throws(() => audit('root', hidden, { status: 0 }), /summary and its list of high or critical advisories disagree/);
  // Hiding a second advisory while the excepted one stays listed also leaves its count behind.
  for (const severity of ['high', 'critical']) {
    const second = fixture('root');
    second.metadata.vulnerabilities[severity] += 1;
    assert.throws(() => audit('root', second), /summary and its list of high or critical advisories disagree/);
  }
});

test('the root summary counts each finding path, as the registry does', () => {
  // Observed 18 November 2026: two vulnerable picomatch versions are two findings and count 2.
  const twoVersions = fixture('root');
  twoVersions.advisories['1247710'].findings.push({ version: '4.0.6', paths: ['.>tinyglobby>picomatch'] });
  twoVersions.metadata.vulnerabilities.high = 2;
  assert.deepEqual(audit('root', twoVersions).map(advisory => advisory.id), [GHSA]);
  twoVersions.metadata.vulnerabilities.high = 1;
  assert.throws(() => audit('root', twoVersions), /summary and its list of high or critical advisories disagree/);
});

test('a patched version ends the exception', () => {
  const root = fixture('root');
  root.advisories['1247710'].patched_versions = '>=4.0.8';
  assert.throws(() => audit('root', root), /GHSA-fc5q-39xc-vjpf: a fixed picomatch exists or cannot be ruled out; update instead/);
  // npm reports "*" only while every published picomatch is vulnerable.
  const server = fixture('server');
  server.vulnerabilities.picomatch.range = '<=4.0.7';
  assert.throws(() => audit('server', server), /a fixed picomatch exists or cannot be ruled out/);
  // Another advisory on the package also shapes npm's range, so the fix can no longer be ruled out.
  const shared = fixture('server');
  shared.vulnerabilities.picomatch.via.push({ ...shared.vulnerabilities.picomatch.via[0], source: 1, url: 'https://github.com/advisories/GHSA-5555-6666-7777', severity: 'moderate' });
  assert.throws(() => audit('server', shared), /a fixed picomatch exists or cannot be ruled out/);
});

test('a changed advisory needs a new review', () => {
  for (const [field, value] of [['vulnerable_versions', '<=4.0.8'], ['severity', 'critical']]) {
    const root = fixture('root');
    root.advisories['1247710'][field] = value;
    if (field === 'severity') { root.metadata.vulnerabilities.high = 0; root.metadata.vulnerabilities.critical = 1; }
    assert.throws(() => audit('root', root), /GHSA-fc5q-39xc-vjpf changed since its review/);
  }
  const server = fixture('server');
  server.vulnerabilities.picomatch.via[0].range = '<4.1.0';
  assert.throws(() => audit('server', server), /changed since its review \(now high, <4\.1\.0\)/);
});

test('a production path ends the exception', () => {
  const reachable = pnpmLock.replace('  react@19.3.1: {}\n', '  react@19.3.1:\n    dependencies:\n      picomatch: 4.0.7\n');
  assert.throws(() => audit('root', fixture('root'), { lockfile: reachable }),
    error => /reaches production through \.>react>picomatch/.test(error.message)
      && /reaches production through \.>@excalidraw\/excalidraw>react>picomatch/.test(error.message)
      && !error.message.includes(`through ${REVIEWED_PATH}`));
  for (const flags of [{}, { dev: false }, { devOptional: true }, { optional: true }]) {
    const lock = serverLock();
    lock.packages['node_modules/picomatch'] = { version: '4.0.7', ...flags };
    assert.throws(() => audit('server', fixture('server'), { lockfile: JSON.stringify(lock) }),
      /GHSA-fc5q-39xc-vjpf reaches production through server\/node_modules\/picomatch/);
  }
  const unlocated = fixture('server');
  unlocated.vulnerabilities.picomatch.nodes = [];
  assert.throws(() => audit('server', unlocated), /reports no installed location/);
});

test('an exception that is no longer needed fails, so it is removed once a fix ships', () => {
  const clean = fixture('root');
  clean.advisories = {};
  clean.metadata.vulnerabilities.high = 0;
  assert.throws(() => audit('root', clean, { status: 0 }), /GHSA-fc5q-39xc-vjpf is no longer reported for root; remove its exception/);
  const withoutWatcher = pnpmLock.replace("    optionalDependencies:\n      '@parcel/watcher': 2.6.0\n", '');
  assert.throws(() => audit('root', fixture('root'), { lockfile: withoutWatcher }),
    /the reviewed production path \.>@excalidraw\/excalidraw>sass>@parcel\/watcher>picomatch no longer exists; remove it/);
});

test('the committed exception list is valid, and malformed lists are rejected', () => {
  validateExceptions(JSON.parse(read('dependency-audit-exceptions.json')));
  for (const change of [
    list => { list.exceptions[0].id = 'CVE-2026-112366'; },
    list => { list.exceptions.push(structuredClone(list.exceptions[0])); },
    list => { delete list.exceptions[0].reason; },
    list => { list.exceptions[0].endsWhen = ''; },
    list => { list.exceptions[0].severity = 'moderate'; },
    list => { list.exceptions[0].reviewed = '2026-02-30'; },
    list => { list.exceptions[0].projects = []; },
    list => { list.exceptions[0].projects = ['root', 'docs']; },
    list => { list.exceptions[0].projets = ['root']; },
    list => { list.exceptions[0].reviewedProductionPaths = { server: ['node_modules/picomatch'] }; },
    list => { list.exceptions[0].reviewedProductionPaths = { root: ['.>@excalidraw/excalidraw>sass'] }; },
    list => { list.ignore = [GHSA]; },
  ]) {
    const list = allowlist();
    change(list);
    assert.throws(() => validateExceptions(list), /Dependency audit rejected/);
    assert.throws(() => audit('root', fixture('root'), { exceptions: list }), /Dependency audit rejected/);
  }
});

test('the lockfile reader matches a YAML parser on the real root lockfile', () => {
  const text = read('../pnpm-lock.yaml');
  const yaml = load(text);
  const pick = (source, kinds, value) => Object.fromEntries(kinds.filter(kind => source[kind])
    .map(kind => [kind, Object.fromEntries(Object.entries(source[kind]).map(([name, entry]) => [name, value(entry)]))]));
  assert.deepEqual(parsePnpmLock(text), {
    importers: Object.fromEntries(Object.entries(yaml.importers)
      .map(([id, importer]) => [id, pick(importer, ['dependencies', 'devDependencies', 'optionalDependencies'], entry => entry.version)])),
    snapshots: Object.fromEntries(Object.entries(yaml.snapshots)
      .map(([key, snapshot]) => [key, pick(snapshot ?? {}, ['dependencies', 'optionalDependencies'], version => version)])),
  });
});

test('production paths cover every chain and fail closed on lockfiles they cannot read', () => {
  assert.deepEqual(productionPaths(parsePnpmLock(pnpmLock), 'picomatch'), [REVIEWED_PATH]);
  assert.throws(() => parsePnpmLock(pnpmLock.replace("lockfileVersion: '9.0'", "lockfileVersion: '6.0'")), /lockfile version 9\.0/);
  assert.throws(() => parsePnpmLock(pnpmLock.replace('      react: 19.3.1\n      sass', '      react: "19.3.1"\n      sass')), /unsupported YAML/);
  const missing = pnpmLock.replace('  sass@1.105.0:\n', '  sass@1.105.1:\n');
  assert.throws(() => productionPaths(parsePnpmLock(missing), 'picomatch'), /no snapshot for sass@1\.105\.0/);
});

test('the CLI reads the exception list and lockfiles beside it and exits nonzero on rejection', t => {
  const folder = mkdtempSync(join(tmpdir(), 'threatcaddy-dependency-audit-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const directory of ['scripts', 'server', 'extension']) mkdirSync(join(folder, directory));
  copyFileSync(new URL('ci-dependency-audit.mjs', import.meta.url), join(folder, 'scripts/ci-dependency-audit.mjs'));
  writeFileSync(join(folder, 'scripts/dependency-audit-exceptions.json'), JSON.stringify(allowlist()));
  writeFileSync(join(folder, 'pnpm-lock.yaml'), lockfiles.root);
  writeFileSync(join(folder, 'server/package-lock.json'), lockfiles.server);
  writeFileSync(join(folder, 'extension/package-lock.json'), lockfiles.extension);
  const cli = (...args) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, ['scripts/ci-dependency-audit.mjs', ...args], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) { return { status: error.status, stderr: error.stderr }; }
  };
  for (const project of ['root', 'server', 'extension']) writeFileSync(join(folder, `${project}.json`), JSON.stringify(fixture(project)));
  writeFileSync(join(folder, 'empty.json'), '');
  const passed = cli('root', 'root.json', '1');
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /::warning title=Reviewed dependency audit exception::GHSA-fc5q-39xc-vjpf \(picomatch, high\) is excepted for root/);
  assert.equal(cli('server', 'server.json', '1').status, 0);
  assert.equal(cli('extension', 'extension.json', '0').status, 0);
  for (const args of [['extension', 'server.json', '1'], ['root', 'empty.json', '1'], ['root', 'missing.json', '1'], ['../server', 'server.json', '1'], ['root', 'root.json']]) {
    const rejected = cli(...args);
    assert.equal(rejected.status, 1, args.join(' '));
    assert.match(rejected.stderr, /Dependency audit rejected|Usage/);
  }
});
