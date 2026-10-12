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

export function releaseScope({ eventName, ref, before, after, cwd = process.cwd(), diff = changedPaths }) {
  // Manual server publication is an explicit separate workflow; CI dispatch,
  // pull requests and scheduled audits must never gain publication as a side effect.
  if (eventName !== 'push' || ref !== 'refs/heads/main') {
    return { required: false, fallback: false, reason: 'Not an automatic main push' };
  }
  if (!isCommitSHA(after) || after === ZERO_SHA) {
    throw new Error('A main push requires an exact nonzero source SHA');
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
    return { required, fallback: false, reason: required ? 'Server release paths changed' : 'Only non-server release paths changed' };
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
  const result = releaseScope({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    before,
    after: process.env.GITHUB_SHA,
  });
  writeReleaseScope(result, process.env.GITHUB_OUTPUT);
  console.log(`${result.fallback ? '::warning::' : ''}${result.reason}`);
}
