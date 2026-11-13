import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditServerImage, TRIVY_VERSION } from './ci-audit-server-image.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const revision = 'b'.repeat(40);
const options = { imageId, revision, dependencies: ['hono', 'postgres'] };
const vulnerability = Severity => ({ VulnerabilityID: 'CVE-fixture', PkgName: 'synthetic-package', InstalledVersion: '1.0.0', Severity });
function report() {
  return { SchemaVersion: 2, Trivy: { Version: TRIVY_VERSION }, ArtifactType: 'container_image',
    Metadata: { ImageID: imageId, OS: { Family: 'alpine', Name: '3.24.3' },
      ImageConfig: { os: 'linux', config: { Labels: { 'org.opencontainers.image.revision': revision } } } },
    Results: [
      { Target: 'image.tar (alpine 3.24.3)', Class: 'os-pkgs', Type: 'alpine', Packages: [{ Name: 'musl', Version: '1.2.6-r3' }] },
      { Target: 'Node.js', Class: 'lang-pkgs', Type: 'node-pkg', Packages: options.dependencies.map(Name => ({ Name, Version: '1.0.0', FilePath: `app/node_modules/${Name}/package.json` })) },
    ] };
}

test('accepts a complete image report while retaining lower-severity counts', () => {
  const input = report();
  input.Results[0].Vulnerabilities = [vulnerability('LOW'), vulnerability('MEDIUM')];
  const result = auditServerImage(input, options);
  assert.equal(result.imageId, imageId);
  assert.equal(result.revision, revision);
  assert.equal(result.osPackages, 1);
  assert.equal(result.applicationPackages, 2);
  assert.deepEqual(result.vulnerabilities, { UNKNOWN: 0, LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 0 });
});

for (const severity of ['HIGH', 'CRITICAL']) test(`blocks ${severity} findings in any image package, including global tooling`, () => {
  const input = report();
  input.Results[1].Vulnerabilities = [{ ...vulnerability(severity), PkgPath: 'usr/local/lib/node_modules/npm/node_modules/fixture/package.json' }];
  assert.throws(() => auditServerImage(input, options), /vulnerabilities remain/);
});

for (const [name, change] of [
  ['wrong schema', r => { r.SchemaVersion = 1; }],
  ['wrong scanner', r => { r.Trivy.Version = '0.0.0'; }],
  ['filesystem instead of image', r => { r.ArtifactType = 'filesystem'; }],
  ['different image', r => { r.Metadata.ImageID = `sha256:${'c'.repeat(64)}`; }],
  ['different revision', r => { r.Metadata.ImageConfig.config.Labels['org.opencontainers.image.revision'] = 'c'.repeat(40); }],
  ['missing OS identification', r => { delete r.Metadata.OS; }],
  ['unsupported OS lifetime', r => { r.Metadata.OS.EOSL = true; }],
  ['non-Linux image', r => { r.Metadata.ImageConfig.os = 'windows'; }],
  ['missing results', r => { delete r.Results; }],
  ['no OS package analysis', r => { r.Results.shift(); }],
  ['empty OS inventory', r => { r.Results[0].Packages = []; }],
  ['no application analysis', r => { r.Results.pop(); }],
  ['missing production dependency', r => { r.Results[1].Packages.pop(); }],
  ['same package outside application', r => { r.Results[1].Packages[0].FilePath = 'usr/local/lib/node_modules/hono/package.json'; }],
  ['malformed package inventory', r => { r.Results[0].Packages = {}; }],
  ['malformed vulnerability list', r => { r.Results[0].Vulnerabilities = {}; }],
  ['unknown severity spelling', r => { r.Results[0].Vulnerabilities = [vulnerability('high')]; }],
  ['missing vulnerability identity', r => { r.Results[0].Vulnerabilities = [{ Severity: 'LOW' }]; }],
  ['suppressed findings', r => { r.Results[0].ExperimentalModifiedFindings = [{ Status: 'ignored' }]; }],
  ['partial scan error', r => { r.Errors = ['Could not analyze layer']; }],
]) test(`fails closed on ${name}`, () => {
  const input = report(); change(input);
  assert.throws(() => auditServerImage(input, options), /Image audit rejected/);
});

test('rejects scanner errors and unreviewed warnings even if JSON looks complete', () => {
  for (const diagnostics of ['2026-11-13T00:00:00Z\tERROR\tLayer analysis failed', 'WARN Unable to analyze packages']) {
    assert.throws(() => auditServerImage(report(), { ...options, diagnostics }), /scanner diagnostics/);
  }
  assert.doesNotThrow(() => auditServerImage(report(), { ...options,
    diagnostics: '2026-11-13T00:00:00Z\tWARN\tUsing severities from other vendors for some vulnerabilities. Read https://trivy.dev/docs/v0.76/guide/scanner/vulnerability#severity-selection for details.',
  }));
});

test('the CLI exits nonzero and records rejection for malformed JSON', t => {
  const folder = mkdtempSync(join(tmpdir(), 'threatcaddy-image-audit-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'report.json'), '{');
  writeFileSync(join(folder, 'image.id'), imageId);
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ dependencies: { hono: '1' } }));
  writeFileSync(join(folder, 'scanner.log'), '');
  assert.throws(() => execFileSync(process.execPath, [new URL('./ci-audit-server-image.mjs', import.meta.url).pathname,
    join(folder, 'report.json'), join(folder, 'image.id'), revision, join(folder, 'scanner.log'), join(folder, 'manifest.json')],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), error => error.status === 1 && JSON.parse(error.stdout).passed === false);
  assert.equal(readFileSync(join(folder, 'report.json'), 'utf8'), '{');
});
