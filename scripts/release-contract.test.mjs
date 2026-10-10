import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CRITICAL_FILES, OFFLINE_PROBE_PATH, ReleaseContractError, artifactMember,
  expectedOfflineFailure, fetchArtifact, loadVerifiedArtifact, requestPolicy,
  sha256, validateArchiveListing, validateSiteURL, validateSourceSHA, waitForRelease,
} from './release-contract.mjs';

const sourceSHA = 'a'.repeat(40);
const site = validateSiteURL('https://release.example/');
const files = new Map(CRITICAL_FILES.map(path => [path, { hash: sha256(path), size: path.length }]));
const run = promisify(execFile);

test('requires an explicit plain HTTPS origin and exact source SHA', () => {
  assert.equal(validateSiteURL('https://release.example').href, site.href);
  for (const invalid of [undefined, '', 'not a URL', 'http://release.example/', 'file:///a', 'https://a:b@release.example/',
    'https://release.example/path/', 'https://release.example/?x=1', 'https://release.example/#x']) {
    assert.throws(() => validateSiteURL(invalid), ReleaseContractError);
  }
  assert.equal(validateSourceSHA(sourceSHA), sourceSHA);
  for (const invalid of [undefined, '', 'a'.repeat(39), 'a'.repeat(41), 'z'.repeat(40), 'A'.repeat(40), sourceSHA + '\n', [sourceSHA]]) {
    assert.throws(() => validateSourceSHA(invalid), ReleaseContractError);
  }
});

test('rejects artifact traversal, ambiguous names and special characters', () => {
  assert.equal(artifactMember('./assets/chunk.js'), 'assets/chunk.js');
  assert.equal(artifactMember('./'), '');
  for (const path of ['/etc/passwd', '../escape', './a/../escape', 'a//b', 'a/./b', 'a\\b', 'a\nb', 'a\0b']) {
    assert.throws(() => artifactMember(path), ReleaseContractError);
  }
});

test('bounds declared archive expansion before extraction on GNU and BSD tar', () => {
  validateArchiveListing(['./', './index.html'], ['drwxr-xr-x 1001/1001 0 2026-10-06 12:00 ./', '-rw-r--r-- 1001/1001 20 2026-10-06 12:00 ./index.html']);
  validateArchiveListing(['./index.html'], ['-rw-r--r--  0 501 20 20 Oct 6 12:00 ./index.html']);
  assert.throws(() => validateArchiveListing(['./huge'], ['-rw-r--r-- 1001/1001 999999999999 2026-10-06 12:00 ./huge']), /expansion/);
  assert.throws(() => validateArchiveListing(['../escape'], ['-rw-r--r-- 1001/1001 20 2026-10-06 12:00 ../escape']), /Unsafe/);
  assert.throws(() => validateArchiveListing(['./a', './a'], Array(2).fill('-rw-r--r-- 1001/1001 20 2026-10-06 12:00 ./a')), /Duplicate/);
  assert.throws(() => validateArchiveListing(['./a'], ['lrwxrwxrwx 1001/1001 0 2026-10-06 12:00 ./a -> /tmp']), /regular-file/);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'threatcaddy-release-contract-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'site'));
  for (const path of [...CRITICAL_FILES, '.nojekyll']) await writeFile(join(root, 'site', path), path);
  await writeFile(join(root, 'source-sha.txt'), sourceSHA + '\n');
  await packageFixture(root);
  return root;
}

async function packageFixture(root) {
  await run('tar', ['-cf', join(root, 'client.tar'), '-C', join(root, 'site'), '.']);
  await writeFile(join(root, 'client.tar.sha256'), `${sha256(await readFile(join(root, 'client.tar')))}  client.tar\n`);
}

test('validates the complete extracted manifest against the checksummed archive', async t => {
  const root = await fixture(t);
  const artifact = await loadVerifiedArtifact(root, sourceSHA);
  assert.equal(artifact.sourceSHA, sourceSHA);
  assert.equal(artifact.files.size, 4);
  assert.deepEqual(artifact.files.get('index.html'), files.get('index.html'));
  await writeFile(join(root, 'site', 'index.html'), 'changed extracted site');
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /does not exactly match/);
});

test('uses the archive as authority without any pre-extracted site directory', async t => {
  const root = await fixture(t);
  await rm(join(root, 'site'), { recursive: true });
  const artifact = await loadVerifiedArtifact(root, sourceSHA);
  assert.equal(artifact.files.size, 4);
  assert.deepEqual(artifact.files.get('index.html'), files.get('index.html'));
});

test('rejects missing metadata, wrong source and corrupt checksums', async t => {
  const root = await fixture(t);
  await assert.rejects(loadVerifiedArtifact(root, 'b'.repeat(40)), /source SHA/);
  await writeFile(join(root, 'client.tar.sha256'), `${'0'.repeat(64)}  client.tar\n`);
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /checksum mismatch/);
  await writeFile(join(root, 'client.tar.sha256'), `${'0'.repeat(64)}  ../client.tar\n`);
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /Invalid.*manifest/);
  await rm(join(root, 'source-sha.txt'));
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /ENOENT/);
});

test('rejects missing required files and additional extracted files', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'site', 'unpackaged.js'), 'extra');
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /does not exactly match/);
  await rm(join(root, 'site', 'sw.js'));
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /Missing release artifact/);
});

test('rejects symlinked files and archive link members without following them', async t => {
  const root = await fixture(t);
  await symlink('index.html', join(root, 'site', 'alias.html'));
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /regular artifact file/);
  await packageFixture(root);
  await assert.rejects(loadVerifiedArtifact(root, sourceSHA), /regular-file and directory entries/);
});

test('permits only same-origin verified static reads and Workbox revision queries', () => {
  assert.deepEqual(requestPolicy(site.href, 'GET', site, files), { allowed: true, path: 'index.html' });
  assert.equal(requestPolicy(`${site}sw.js`, 'HEAD', site, files).allowed, true);
  assert.equal(requestPolicy(`${site}sw.js?__WB_REVISION__=${'a'.repeat(32)}`, 'GET', site, files).allowed, true);
  for (const [url, method] of [
    [site.href, 'POST'], [site.href, 'PUT'], [site.href, 'DELETE'], ['https://other.example/index.html', 'GET'],
    ['http://release.example/', 'GET'], ['wss://release.example/', 'GET'], [`${site}api/state`, 'GET'],
    [`${site}sw.js?tracking=1`, 'GET'], [`${site}sw.js?__WB_REVISION__=invalid`, 'GET'], [`${site}%2fsw.js`, 'GET'],
  ]) assert.equal(requestPolicy(url, method, site, files).allowed, false, `${method} ${url}`);
  assert.equal(requestPolicy(site.href, 'GET', site, files, { standalone: true }).allowed, false);
});

test('the uncached probe is only allowed offline; expected failures are exact', () => {
  const probe = new URL(OFFLINE_PROBE_PATH, site).href;
  assert.equal(requestPolicy(probe, 'GET', site, files).allowed, false);
  assert.deepEqual(requestPolicy(probe, 'GET', site, files, { offline: true }), { allowed: true, probe: true });
  assert.equal(requestPolicy(probe, 'POST', site, files, { offline: true }).allowed, false);
  assert.equal(expectedOfflineFailure(probe, 'net::ERR_FAILED', { offline: true, site }), true);
  assert.equal(expectedOfflineFailure(probe, 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED', { offline: true, site }), true);
  for (const [url, error, offline] of [[probe, 'net::ERR_FAILED', false], [site.href, 'net::ERR_FAILED', true],
    [probe + '?x=1', 'net::ERR_FAILED', true], [probe, 'Application failed', true], [probe, 'net::ERR_ABORTED', true]]) {
    assert.equal(expectedOfflineFailure(url, error, { offline, site }), false);
  }
});

test('fetches do not follow redirects and enforce response identity and bounds', async () => {
  await assert.rejects(fetchArtifact(site.href, files.get('index.html'), {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      return new Response('', { status: 302, headers: { location: 'https://other.example/' } });
    },
  }), /must not redirect/);
  await assert.rejects(fetchArtifact(site.href, files.get('index.html'), {
    fetchImpl: async () => {
      const response = new Response('index.html');
      Object.defineProperty(response, 'url', { value: 'https://other.example/' });
      return response;
    },
  }), /URL changed/);
  const oversized = await fetchArtifact(site.href, files.get('index.html'), {
    fetchImpl: async () => new Response('x'.repeat(131_073)),
  });
  assert.equal(oversized.matches, false);
  assert.equal(oversized.bytes, null);
  assert.match(oversized.error, /size bound/);
  const result = await fetchArtifact(site.href, files.get('index.html'), { fetchImpl: async () => new Response('index.html') });
  assert.equal(result.matches, true);
});

function clockOptions(overrides = {}) {
  let time = 0;
  return { timeoutMs: 30, intervalMs: 10, now: () => time, sleep: async ms => { time += ms; }, ...overrides };
}

test('bounded propagation retries stale bytes then requires one complete matching attempt', async () => {
  const observations = [];
  let calls = 0;
  const responses = await waitForRelease(site, files, clockOptions({
    fetchImpl: async url => {
      const path = new URL(url).pathname.slice(1) || 'index.html';
      return new Response(++calls <= 3 ? 'old release' : path);
    }, onAttempt: result => observations.push(result),
  }));
  assert.equal(calls, 6);
  assert.equal(observations.length, 2);
  assert.equal(responses.get('sw.js').hash, files.get('sw.js').hash);
});

test('does not combine partial matches, retry redirects, or run without a deadline', async () => {
  let calls = 0;
  await assert.rejects(waitForRelease(site, files, clockOptions({
    fetchImpl: async url => {
      const path = new URL(url).pathname.slice(1) || 'index.html';
      return new Response(++calls % 3 === 0 ? 'stale' : path);
    },
  })), /did not converge/);
  assert.equal(calls, 9);
  calls = 0;
  await assert.rejects(waitForRelease(site, files, clockOptions({ fetchImpl: async () => {
    calls++; return new Response('', { status: 301 });
  } })), /must not redirect/);
  assert.equal(calls, 1);
  await assert.rejects(waitForRelease(site, files, { timeoutMs: Infinity }), /Invalid propagation/);
});

test('network errors and unsuccessful status retry only until the deadline', async () => {
  let calls = 0;
  await assert.rejects(waitForRelease(site, files, clockOptions({ fetchImpl: async () => {
    if (++calls % 2) throw new Error('network unavailable');
    return new Response('not found', { status: 404 });
  } })), /did not converge/);
  assert.equal(calls, 9);
});
