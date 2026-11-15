// Verify the advertised GitHub download channel against an independently
// qualified source/artifact. This module never publishes or edits a release.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadVerifiedArtifact, sha256, validateSourceSHA } from './release-contract.mjs';

export const DOWNLOAD_ASSETS = ['threatcaddy-standalone.html', 'threatcaddy-chrome.zip', 'threatcaddy-firefox.zip'];
const RELEASE_ASSETS = [...DOWNLOAD_ASSETS, 'release-manifest.json', 'SHA256SUMS'];
const repo = 'peterhanily/threatcaddy';
const reject = message => { throw new Error(`Release channel: ${message}`); };

export function verifyReleaseChannel({ release, manifest, sourceSHA, version, tagSourceSHA, run,
  artifact, clientArtifactId, serverArtifactId, serverArchiveHash, serverImageId, serverDigest,
  contents, extensionHashes, extensionVersion }) {
  validateSourceSHA(sourceSHA);
  if (!/^\d+\.\d+\.\d+$/.test(version)) reject('expected a stable semantic version');
  if (tagSourceSHA !== sourceSHA || manifest.sourceSha !== sourceSHA || artifact.sourceSHA !== sourceSHA) reject('source/tag/artifact mismatch');
  if (release.tag_name !== `v${version}` || manifest.release !== `v${version}`
    || manifest.versions?.client !== version || manifest.versions?.server !== version
    || !extensionVersion || manifest.versions?.extension !== extensionVersion) reject('version mismatch');
  if (release.draft !== false || release.prerelease !== false || release.immutable !== true) reject('expected a published immutable stable release');
  if (run.head_sha !== sourceSHA || run.head_branch !== 'main' || run.event !== 'push'
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.repository?.full_name !== repo || run.path !== '.github/workflows/ci.yml'
    || manifest.verification?.runId !== run.id || manifest.verification?.url !== `https://github.com/${repo}/actions/runs/${run.id}`) reject('successful exact-source main CI receipt required');
  if (!Number.isSafeInteger(clientArtifactId) || clientArtifactId <= 0 || !Number.isSafeInteger(serverArtifactId) || serverArtifactId <= 0
    || manifest.artifacts?.client?.id !== clientArtifactId || manifest.artifacts?.server?.id !== serverArtifactId
    || manifest.artifacts?.client?.archiveSha256 !== artifact.archiveHash) reject('qualified artifact identity mismatch');
  if (!/^sha256:[a-f0-9]{64}$/.test(serverImageId) || !/^sha256:[a-f0-9]{64}$/.test(serverDigest)
    || manifest.artifacts?.server?.imageId !== serverImageId
    || !/^[a-f0-9]{64}$/.test(serverArchiveHash) || manifest.artifacts?.server?.archiveSha256 !== serverArchiveHash
    || manifest.serverImage?.reference !== `ghcr.io/${repo}/server@${serverDigest}`) reject('server identity mismatch');
  if (!Array.isArray(release.assets) || release.assets.length !== RELEASE_ASSETS.length
    || new Set(release.assets.map(asset => asset.name)).size !== RELEASE_ASSETS.length) reject('unexpected or duplicate release assets');
  for (const name of RELEASE_ASSETS) {
    const asset = release.assets.find(item => item.name === name);
    const bytes = contents[name];
    if (!asset || !Buffer.isBuffer(bytes) || asset.state !== 'uploaded'
      || asset.size !== bytes.length || asset.digest !== `sha256:${sha256(bytes)}`
      || asset.browser_download_url !== `https://github.com/${repo}/releases/download/v${version}/${name}`) reject(`download metadata/bytes mismatch: ${name}`);
  }
  if (JSON.stringify(JSON.parse(contents['release-manifest.json'])) !== JSON.stringify(manifest)) reject('manifest bytes mismatch');
  for (const name of DOWNLOAD_ASSETS) {
    const expected = name === 'threatcaddy-standalone.html' ? artifact.files.get(name)?.hash : extensionHashes[name];
    const actual = sha256(contents[name]);
    if (!expected || actual !== expected || manifest.assets?.[name]?.sha256 !== actual
      || manifest.assets[name].bytes !== contents[name].length) reject(`qualified artifact mismatch: ${name}`);
  }
  const checksumFiles = [...DOWNLOAD_ASSETS, 'release-manifest.json'].sort();
  const expectedChecksums = checksumFiles.map(name => `${sha256(contents[name])}  ${name}\n`).join('');
  if (contents.SHA256SUMS.toString() !== expectedChecksums) reject('checksum manifest mismatch');
  return { sourceSHA, version, release: release.html_url, immutable: true, files: RELEASE_ASSETS.length, status: 'passed' };
}

async function boundedFile(path, maximum) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) reject('expected bounded regular file');
  return readFile(path);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2) reject('usage: node scripts/verify-release-channel.mjs RECEIPT.json DOWNLOAD_DIRECTORY');
    const receipt = JSON.parse(await boundedFile(resolve(args[0]), 1024 * 1024));
    const directory = resolve(args[1]);
    const contents = Object.fromEntries(await Promise.all(RELEASE_ASSETS.map(async name => [name,
      await boundedFile(join(directory, name), name.endsWith('.html') ? 64 * 1024 * 1024 : 2 * 1024 * 1024)])));
    const artifact = await loadVerifiedArtifact(receipt.artifactDirectory, receipt.sourceSHA);
    const manifest = JSON.parse(contents['release-manifest.json']);
    console.log(JSON.stringify(verifyReleaseChannel({ ...receipt, manifest, artifact, contents }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
