import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = '0'.repeat(40);

function isCommitSHA(value) {
  return typeof value === 'string' && value.length === 40 && COMMIT_SHA.test(value);
}

// Preserve the former deploy-server.yml push.paths contract. Do not replace
// this with a push-payload commit list or a truncated remote comparison API.
export function isServerReleasePath(path) {
  return path.startsWith('server/')
    || path.startsWith('.github/workflows/')
    || (path.startsWith('scripts/ci-') && path.endsWith('.mjs') && !path.slice('scripts/'.length).includes('/'))
    || path === '.node-version';
}

export function parseChangedPaths(output) {
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('Incomplete changed-path listing');
  return output.slice(0, -1).split('\0');
}

export function changedPaths(before, after, cwd) {
  if (!isCommitSHA(before) || !isCommitSHA(after)) throw new Error('Comparison requires exact commit SHAs');
  // SHA validation in releaseScope prevents options/ref expressions. Disable
  // external diff drivers; NUL delimiters retain literal unusual filenames.
  const output = execFileSync('git', [
    'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--no-renames',
    '--end-of-options', before, after, '--',
  ], { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return parseChangedPaths(output);
}

/** The commit behind the server image that GHCR currently serves as `latest`,
 * read from its `org.opencontainers.image.revision` label. Any failure is
 * reported, never guessed: the caller then publishes conservatively. */
export async function publishedRevision(repository, { registry = 'https://ghcr.io', fetchImpl = fetch } = {}) {
  try {
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Repository name unavailable');
    const name = `${repository.toLowerCase()}/server`;
    const get = async (url, headers = {}) => {
      const response = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.json();
    };
    const { token } = await get(`${registry}/token?scope=repository:${name}:pull`);
    if (typeof token !== 'string' || !token) throw new Error('Registry token unavailable');
    const auth = { Authorization: `Bearer ${token}` };
    const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
    let manifest = await get(`${registry}/v2/${name}/manifests/latest`, { ...auth, Accept: accept });
    if (Array.isArray(manifest?.manifests)) {
      const image = manifest.manifests.find(entry => entry?.platform?.os === 'linux' && entry?.platform?.architecture === 'amd64');
      if (!/^sha256:[a-f0-9]{64}$/.test(image?.digest ?? '')) throw new Error('No linux/amd64 image in the published index');
      manifest = await get(`${registry}/v2/${name}/manifests/${image.digest}`, { ...auth, Accept: accept });
    }
    const config = manifest?.config?.digest;
    if (!/^sha256:[a-f0-9]{64}$/.test(config ?? '')) throw new Error('Published manifest has no image config');
    const revision = (await get(`${registry}/v2/${name}/blobs/${config}`, auth))?.config?.Labels?.['org.opencontainers.image.revision'];
    if (!isCommitSHA(revision)) throw new Error('Published image has no source revision label');
    return { revision };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function releaseScope({ eventName, ref, before, after, published, cwd = process.cwd(), diff = changedPaths }) {
  // Manual server publication is an explicit separate workflow; CI dispatch,
  // pull requests and scheduled audits must never gain publication as a side effect.
  if (eventName !== 'push' || ref !== 'refs/heads/main') {
    return { required: false, fallback: false, reason: 'Not an automatic main push' };
  }
  if (!isCommitSHA(after) || after === ZERO_SHA) {
    throw new Error('A main push requires an exact nonzero source SHA');
  }
  // Compare with what GHCR actually serves, not only with the previous push: an
  // earlier push whose publication failed must not be skipped by a later one.
  if (published !== undefined) {
    if (!published || !isCommitSHA(published.revision)) {
      return { required: true, fallback: true, reason: 'Published server image revision unavailable; conservatively include server publication' };
    }
    if (published.revision === after) {
      return { required: false, fallback: false, reason: 'The published server image is already this revision' };
    }
    before = published.revision;
  }
  if (!isCommitSHA(before) || before === ZERO_SHA) {
    return { required: true, fallback: true, reason: 'Comparison base unavailable; conservatively include server publication' };
  }
  try {
    const paths = diff(before, after, cwd);
    if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || path === '' || path.includes('\0'))) {
      throw new Error('Invalid changed-path listing');
    }
    const required = paths.some(isServerReleasePath);
    const since = published === undefined ? '' : ' since the published server image';
    return { required, fallback: false, reason: required ? `Server release paths changed${since}` : `Only non-server release paths changed${since}` };
  } catch {
    // Force pushes can orphan the previous tip even after a full checkout.
    // A missing object, timeout or oversized diff must not silently skip release.
    // The conservative fallback still requires every verification/publication gate.
    return { required: true, fallback: true, reason: 'Complete comparison unavailable; conservatively include server publication' };
  }
}

export function writeReleaseScope(result, outputPath) {
  if (typeof result.required !== 'boolean' || !outputPath) throw new Error('Invalid release-scope output');
  appendFileSync(outputPath, `server-publish-required=${result.required}\n`);
}

if (import.meta.main) {
  let before;
  if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main') {
    try {
      before = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).before;
    } catch {
      // Missing/malformed event metadata uses the same conservative fallback.
    }
  }
  const mainPush = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main';
  // RELEASE_SCOPE_REGISTRY exists for the offline contract test only, so it may
  // name nothing but a loopback stand-in.
  const override = process.env.RELEASE_SCOPE_REGISTRY;
  const registry = override && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override) ? override : 'https://ghcr.io';
  const published = mainPush ? await publishedRevision(process.env.GITHUB_REPOSITORY, { registry }) : undefined;
  if (published?.error) console.log(`::warning::Could not read the published server image revision: ${published.error}`);
  const result = releaseScope({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    before,
    after: process.env.GITHUB_SHA,
    published,
  });
  writeReleaseScope(result, process.env.GITHUB_OUTPUT);
  console.log(`${result.fallback ? '::warning::' : ''}${result.reason}`);
}
