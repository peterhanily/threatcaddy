import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from './release-contract.mjs';
import { DOWNLOAD_ASSETS, verifyReleaseChannel } from './verify-release-channel.mjs';

function fixture() {
  const sourceSHA = 'a'.repeat(40), version = '2.0.1', extensionVersion = '1.1.3';
  const serverImageId = `sha256:${'b'.repeat(64)}`, serverDigest = `sha256:${'c'.repeat(64)}`;
  const serverArchiveHash = 'd'.repeat(64);
  const contents = Object.fromEntries(DOWNLOAD_ASSETS.map(name => [name, Buffer.from(`Qualified ${name}`)]));
  const artifact = { sourceSHA, archiveHash: 'e'.repeat(64), files: new Map(DOWNLOAD_ASSETS.map(name => [name, { hash: sha256(contents[name]) }])) };
  const run = { id: 123, head_sha: sourceSHA, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', repository: { full_name: 'peterhanily/threatcaddy' }, path: '.github/workflows/ci.yml' };
  const manifest = { release: `v${version}`, sourceSha: sourceSHA, versions: { client: version, server: version, extension: extensionVersion },
    verification: { runId: run.id, url: `https://github.com/peterhanily/threatcaddy/actions/runs/${run.id}` },
    artifacts: { client: { id: 111, archiveSha256: artifact.archiveHash }, server: { id: 222, imageId: serverImageId, archiveSha256: serverArchiveHash } },
    serverImage: { reference: `ghcr.io/peterhanily/threatcaddy/server@${serverDigest}` },
    assets: Object.fromEntries(DOWNLOAD_ASSETS.map(name => [name, { bytes: contents[name].length, sha256: sha256(contents[name]) }])) };
  contents['release-manifest.json'] = Buffer.from(JSON.stringify(manifest));
  contents.SHA256SUMS = Buffer.from([...DOWNLOAD_ASSETS, 'release-manifest.json'].sort().map(name => `${sha256(contents[name])}  ${name}\n`).join(''));
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, immutable: true,
    html_url: `https://github.com/peterhanily/threatcaddy/releases/tag/v${version}`,
    assets: Object.entries(contents).map(([name, bytes]) => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${sha256(bytes)}`, browser_download_url: `https://github.com/peterhanily/threatcaddy/releases/download/v${version}/${name}` })) };
  return { release, manifest, sourceSHA, version, extensionVersion, tagSourceSHA: sourceSHA, run, artifact,
    clientArtifactId: 111, serverArtifactId: 222, serverArchiveHash, serverImageId, serverDigest, contents,
    extensionHashes: Object.fromEntries(DOWNLOAD_ASSETS.slice(1).map(name => [name, sha256(contents[name])])) };
}

test('qualifies actual downloads only when all release channels match the tested identities', () => {
  assert.equal(verifyReleaseChannel(fixture()).status, 'passed');
});
for (const [name, mutate] of [
  ['stale tag', f => { f.tagSourceSHA = 'f'.repeat(40); }],
  ['stale manifest', f => { f.manifest.sourceSha = 'f'.repeat(40); }],
  ['old download version', f => { f.release.tag_name = 'v2.0.0'; }],
  ['mutable assets', f => { f.release.immutable = false; }],
  ['draft release', f => { f.release.draft = true; }],
  ['prerelease', f => { f.release.prerelease = true; }],
  ['failed verification', f => { f.run.conclusion = 'failure'; }],
  ['other source CI', f => { f.run.head_sha = 'f'.repeat(40); }],
  ['untrusted CI source', f => { f.run.event = 'pull_request'; }],
  ['other repository', f => { f.run.repository.full_name = 'other/repo'; }],
  ['other workflow', f => { f.run.path = '.github/workflows/other.yml'; }],
  ['wrong client artifact', f => { f.manifest.artifacts.client.id++; }],
  ['wrong image archive', f => { f.manifest.artifacts.server.archiveSha256 = 'f'.repeat(64); }],
  ['stale server image', f => { f.serverDigest = `sha256:${'f'.repeat(64)}`; }],
  ['tampered download', f => { f.contents['threatcaddy-standalone.html'][0] ^= 1; }],
  ['redirected download', f => { f.release.assets[0].browser_download_url = 'https://example.test/file'; }],
  ['missing checksum', f => { f.release.assets.pop(); }],
  ['duplicate asset', f => { f.release.assets[0] = f.release.assets[1]; }],
  ['substituted expected artifact', f => { f.artifact.files.set('threatcaddy-standalone.html', { hash: 'f'.repeat(64) }); }],
  ['substituted extension', f => { f.extensionHashes['threatcaddy-chrome.zip'] = 'f'.repeat(64); }],
]) test(`rejects ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => verifyReleaseChannel(input), /Release channel:/);
});
