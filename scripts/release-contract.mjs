// Release identity and policy helpers. Importing this module never contacts a site.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
export const CRITICAL_FILES = ['index.html', 'sw.js', 'threatcaddy-standalone.html'];
export const OFFLINE_PROBE_PATH = '/api/__release_smoke_offline_only__';

export class ReleaseContractError extends Error {}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateSiteURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new ReleaseContractError('An explicit HTTPS origin is required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ReleaseContractError('Use an HTTPS origin without a path, credentials, query or fragment');
  }
  return url;
}

export function validateSourceSHA(value) {
  if (typeof value !== 'string' || value.length !== 40 || !/^[a-f0-9]{40}$/.test(value)) {
    throw new ReleaseContractError('source-sha must be 40 lowercase hexadecimal characters');
  }
  return value;
}

export function artifactMember(value) {
  if (typeof value !== 'string' || hasUnsafeMemberCharacter(value) || value.startsWith('/')) {
    throw new ReleaseContractError('Unsafe artifact member path');
  }
  const name = value.replace(/^\.\//, '').replace(/\/$/, '');
  if (!name) return ''; // The archive's root directory.
  if (name.length > 1024 || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ReleaseContractError('Unsafe artifact member path');
  }
  return name;
}

function hasUnsafeMemberCharacter(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127 || code === 92) return true;
  }
  return false;
}

export function validateArchiveListing(names, descriptions) {
  if (!names.length || names.length > 10_000 || descriptions.length !== names.length) throw new ReleaseContractError('Invalid archive entry count');
  const unique = new Set();
  let expandedBytes = 0;
  for (let index = 0; index < names.length; index++) {
    // tar --numeric-owner uses uid/gid on GNU tar and separate link-count,
    // uid, gid fields on BSD tar. Reject other formats rather than guess sizes.
    const entry = /^[d-]\S*\s+(?:\d+\s+\S+\s+\S+|\S+\/\S+)\s+(\d+)\s/.exec(descriptions[index]);
    if (!entry) throw new ReleaseContractError('Archive must contain only bounded regular-file and directory entries');
    expandedBytes += Number(entry[1]);
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_ARTIFACT_BYTES) throw new ReleaseContractError('Archive declared expansion exceeds size bound');
    const name = artifactMember(names[index]);
    if (unique.has(name)) throw new ReleaseContractError('Duplicate archive member');
    unique.add(name);
  }
}

async function regularFile(path, limit = MAX_ARTIFACT_BYTES) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new ReleaseContractError('Expected a bounded regular artifact file');
  return readFile(path);
}

async function manifest(directory) {
  const files = new Map();
  let total = 0;
  async function walk(current, prefix = '') {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ReleaseContractError('Artifact directories cannot be symlinks');
    for (const name of (await readdir(current)).sort()) {
      const relative = artifactMember(prefix + name);
      const path = join(current, name);
      const info = await lstat(path);
      if (info.isDirectory() && !info.isSymbolicLink()) await walk(path, relative + '/');
      else {
        const bytes = await regularFile(path);
        total += bytes.length;
        if (files.size >= 10_000 || total > MAX_ARTIFACT_BYTES) throw new ReleaseContractError('Extracted artifact exceeds size or file-count bounds');
        files.set(relative, { hash: sha256(bytes), size: bytes.length });
      }
    }
  }
  await walk(directory);
  return files;
}

/** Input must be the immutable CI artifact, not an arbitrary uploaded archive.
 * tar interprets its own format; only regular files/directories with safe names
 * are accepted. Extraction occurs in a new disposable directory, never in input.
 */
export async function loadVerifiedArtifact(directory, sourceSHA) {
  validateSourceSHA(sourceSHA);
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new ReleaseContractError('artifact-dir must be a real directory');
  const recordedSHA = (await regularFile(join(root, 'source-sha.txt'), 128)).toString().trim();
  if (recordedSHA !== sourceSHA) throw new ReleaseContractError('Artifact source SHA does not match the requested release');
  const checksum = (await regularFile(join(root, 'client.tar.sha256'), 256)).toString();
  const match = /^([a-f0-9]{64}) [ *]client\.tar\r?\n?$/.exec(checksum);
  if (!match) throw new ReleaseContractError('Invalid client.tar checksum manifest');
  const archive = join(root, 'client.tar');
  if (sha256(await regularFile(archive)) !== match[1]) throw new ReleaseContractError('Client archive checksum mismatch');
  const options = { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
  const names = (await run('tar', ['-tf', archive], options)).stdout.trimEnd().split('\n');
  const descriptions = (await run('tar', ['--numeric-owner', '-tvf', archive], options)).stdout.trimEnd().split('\n');
  validateArchiveListing(names, descriptions);
  let supplied;
  try { await lstat(join(root, 'site')); supplied = await manifest(join(root, 'site')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await mkdtemp(join(tmpdir(), 'threatcaddy-release-artifact-'));
  try {
    await run('tar', ['-xf', archive, '-C', temporary, '--no-same-owner'], options);
    const packaged = await manifest(temporary);
    for (const name of [...CRITICAL_FILES, '.nojekyll']) {
      if (!packaged.has(name) || (supplied && !supplied.has(name))) throw new ReleaseContractError(`Missing release artifact file: ${name}`);
    }
    if (supplied && (packaged.size !== supplied.size || [...packaged].some(([name, value]) =>
      value.hash !== supplied.get(name)?.hash || value.size !== supplied.get(name)?.size))) {
      throw new ReleaseContractError('Extracted site does not exactly match the verified archive');
    }
    return { sourceSHA, archiveHash: match[1], files: packaged };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function requestPolicy(rawURL, method, site, files, { offline = false, standalone = false } = {}) {
  let url;
  try { url = new URL(rawURL); } catch { return { allowed: false, reason: 'invalid URL' }; }
  if (!['GET', 'HEAD'].includes(method)) return { allowed: false, reason: 'network mutation' };
  if (standalone || url.protocol !== 'https:' || url.origin !== site.origin || url.username || url.password) {
    return { allowed: false, reason: 'non-release origin or protocol' };
  }
  if (url.pathname === OFFLINE_PROBE_PATH && !url.search && offline && method === 'GET') return { allowed: true, probe: true };
  // Workbox revision queries identify its own precache fetches; all other query
  // strings are rejected. Every returned asset still has to match its bytes.
  if (url.search && !/^\?__WB_REVISION__=[a-f0-9]{32}$/.test(url.search)) return { allowed: false, reason: 'unexpected query' };
  let path;
  try { path = decodeURIComponent(url.pathname.slice(1)) || 'index.html'; } catch { return { allowed: false, reason: 'invalid path encoding' }; }
  if (/%2f|%5c/i.test(url.pathname) || path.includes('\\') || !files.has(path)) return { allowed: false, reason: 'not a verified static asset' };
  return { allowed: true, path };
}

export function expectedOfflineFailure(url, error, { offline, site }) {
  return offline && url === new URL(OFFLINE_PROBE_PATH, site).href
    && /^(?:Failed to load resource: )?net::ERR_(?:INTERNET_DISCONNECTED|FAILED|NETWORK_CHANGED)$/.test(error);
}

class ResponseLimitError extends Error {}

async function boundedBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ResponseLimitError('Response exceeded the expected artifact size bound');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export async function fetchArtifact(url, expected, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const response = await fetchImpl(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status >= 300 && response.status < 400) throw new ReleaseContractError('Release requests must not redirect');
  if (response.url && response.url !== url) throw new ReleaseContractError('Release response URL changed');
  let bytes;
  try { bytes = await boundedBody(response, Math.min(MAX_ARTIFACT_BYTES, Math.max(expected.size + 65_536, 131_072))); }
  catch (error) {
    // A previous standalone release can legitimately be larger. Stop reading it
    // but classify it as a stale observation, eligible only for bounded polling.
    if (error instanceof ResponseLimitError) return { status: response.status, hash: null, bytes: null, matches: false, error: error.message };
    throw error;
  }
  const hash = sha256(bytes);
  return { status: response.status, hash, bytes, matches: response.status === 200 && hash === expected.hash };
}

/** Retry propagation only, not functional browser failures. All files must match
 * in one attempt; successful observations never carry across failed attempts.
 */
export async function waitForRelease(site, files, {
  timeoutMs = 180_000, intervalMs = 5_000, fetchImpl = fetch, now = Date.now, sleep = delay, onAttempt = () => {},
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new ReleaseContractError('Invalid propagation deadline or interval');
  }
  const deadline = now() + timeoutMs;
  let attempt = 0;
  while (now() < deadline) {
    const responses = new Map();
    const observation = { attempt: ++attempt, files: [] };
    for (const path of CRITICAL_FILES) {
      if (now() >= deadline) break;
      try {
        const result = await fetchArtifact(new URL(path === 'index.html' ? './' : path, site).href, files.get(path), {
          fetchImpl, timeoutMs: Math.max(1, Math.min(15_000, deadline - now())),
        });
        observation.files.push({ path, status: result.status, hash: result.hash, matches: result.matches, ...(result.error ? { error: result.error } : {}) });
        responses.set(path, result);
      } catch (error) {
        if (error instanceof ReleaseContractError) throw error;
        observation.files.push({ path, error: error.message });
      }
    }
    onAttempt(observation);
    if (now() <= deadline && responses.size === CRITICAL_FILES.length && [...responses.values()].every(result => result.matches)) return responses;
    if (now() < deadline) await sleep(Math.min(intervalMs, deadline - now()));
  }
  throw new ReleaseContractError(`Publication did not converge to the verified artifact within ${timeoutMs}ms`);
}
