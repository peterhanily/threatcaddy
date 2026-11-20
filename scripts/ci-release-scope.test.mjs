import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, isServerReleasePath, parseChangedPaths, publishedRevision, releaseScope, writeReleaseScope } from './ci-release-scope.mjs';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const mainPush = { eventName: 'push', ref: 'refs/heads/main', before, after };

test('matches exactly the former server publication path classes', () => {
  for (const path of ['server/Dockerfile', 'server/src/a.ts', '.github/workflows/ci.yml',
    '.github/workflows/nested/a.yml', 'scripts/ci-verify-server-image.mjs', 'scripts/ci-.mjs', '.node-version',
    'server/spaces and\nnewlines.ts']) assert.equal(isServerReleasePath(path), true, path);
  for (const path of ['src/App.tsx', 'README.md', 'package.json', 'pnpm-lock.yaml', 'serverish/a',
    '.github/workflows-backup/a.yml', 'scripts/nested/ci-test.mjs', 'scripts/ci-test.js',
    'scripts/not-ci-test.mjs', 'scripts/ci-test.mjs.bak', 'scripts/ci-test.mjs\n',
    'other/.node-version', '.node-version.bak', '']) {
    assert.equal(isServerReleasePath(path), false, path);
  }
});

test('parses NUL-delimited paths without splitting or trimming filenames', () => {
  assert.deepEqual(parseChangedPaths(''), []);
  assert.deepEqual(parseChangedPaths('server/a\nb\0src/ space.ts \0'), ['server/a\nb', 'src/ space.ts ']);
  assert.throws(() => parseChangedPaths('server/a'), /Incomplete/);
});

test('all non-main-push events remain verification-only without invoking git', () => {
  const diff = () => { throw new Error('must not be called'); };
  for (const eventName of ['pull_request', 'workflow_dispatch', 'schedule', 'workflow_run', undefined]) {
    assert.equal(releaseScope({ ...mainPush, eventName, after: undefined, diff }).required, false);
  }
  for (const ref of ['refs/heads/feature', 'refs/tags/main', 'refs/pull/1/merge', undefined]) {
    assert.equal(releaseScope({ ...mainPush, ref, after: undefined, diff }).required, false);
  }
});

test('only matching paths request automatic publication after a complete diff', () => {
  for (const paths of [[], ['src/App.tsx', 'docs/deployment.md']]) {
    assert.deepEqual(releaseScope({ ...mainPush, diff: () => paths }), {
      required: false, fallback: false, reason: 'Only non-server release paths changed',
    });
  }
  const result = releaseScope({ ...mainPush, cwd: '/test', diff: (base, head, cwd) => {
    assert.deepEqual([base, head, cwd], [before, after, '/test']);
    return ['src/App.tsx', 'server/Dockerfile'];
  } });
  assert.equal(result.required, true);
  assert.equal(result.fallback, false);
});

test('missing, zero or invalid bases conservatively publish without unsafe git arguments', () => {
  for (const before of [undefined, null, '', '0'.repeat(40), '--ext-diff', 'HEAD~1', 'z'.repeat(40), 'A'.repeat(40),
    'a'.repeat(40) + '\n', ['a'.repeat(40)]]) {
    const result = releaseScope({ ...mainPush, before, diff: () => assert.fail('invalid base reached git') });
    assert.equal(result.required, true);
    assert.equal(result.fallback, true);
  }
});

test('missing, zero or malformed source SHAs block the main release', () => {
  for (const after of [undefined, '', '0'.repeat(40), '--output=x', 'HEAD', 'f'.repeat(41),
    'b'.repeat(40) + '\n', ['b'.repeat(40)]]) {
    assert.throws(() => releaseScope({ ...mainPush, after }), /exact nonzero source SHA/);
  }
  assert.throws(() => changedPaths('--ext-diff', after, '/'), /exact commit SHAs/);
});

test('unavailable, oversized or malformed comparisons never silently skip server publication', () => {
  for (const diff of [() => { throw new Error('missing object'); }, () => { throw new Error('maxBuffer'); },
    () => null, () => [null], () => [''], () => ['a\0b']]) {
    const result = releaseScope({ ...mainPush, diff });
    assert.equal(result.required, true);
    assert.equal(result.fallback, true);
  }
});

function temporaryDirectory(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'threatcaddy-ci-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function repository(t) {
  const cwd = temporaryDirectory(t);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release scope fixture');
  git('config', 'user.email', 'release-scope@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  // Do not execute a developer's globally configured commit/checkout hooks.
  git('config', 'core.hooksPath', '/dev/null');
  const write = (path, content = path) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => { git('add', '-A'); git('commit', '-m', 'Synthetic fixture'); return git('rev-parse', 'HEAD'); };
  return { cwd, git, write, commit };
}

test('real git comparison includes the whole multi-commit push and literal filenames', t => {
  const { cwd, write, commit } = repository(t);
  write('README.md');
  const before = commit();
  write('server/ spaces\nand-newlines.ts ');
  commit();
  write('src/client-only.ts');
  const after = commit();
  assert.deepEqual(changedPaths(before, after, cwd), ['server/ spaces\nand-newlines.ts ', 'src/client-only.ts']);
  assert.equal(releaseScope({ ...mainPush, before, after, cwd }).required, true);
});

test('real git comparison detects deletion and renames both into and out of server', t => {
  const { cwd, write, commit } = repository(t);
  write('server/old.ts');
  let before = commit();
  mkdirSync(join(cwd, 'src'));
  renameSync(join(cwd, 'server/old.ts'), join(cwd, 'src/moved.ts'));
  let after = commit();
  assert.deepEqual(changedPaths(before, after, cwd), ['server/old.ts', 'src/moved.ts']);
  assert.equal(releaseScope({ ...mainPush, before, after, cwd }).required, true);
  before = after;
  renameSync(join(cwd, 'src/moved.ts'), join(cwd, 'server/new.ts'));
  after = commit();
  assert.equal(releaseScope({ ...mainPush, before, after, cwd }).required, true);
  before = after;
  rmSync(join(cwd, 'server/new.ts'));
  after = commit();
  assert.equal(releaseScope({ ...mainPush, before, after, cwd }).required, true);
});

test('real git comparison handles unrelated history and unavailable previous tips', t => {
  const { cwd, git, write, commit } = repository(t);
  write('server/original.ts');
  const before = commit();
  git('checkout', '--orphan', 'replacement');
  git('rm', '-rf', '.');
  write('src/replacement.ts');
  const after = commit();
  assert.equal(releaseScope({ ...mainPush, before, after, cwd }).required, true);
  const fallback = releaseScope({ ...mainPush, before: '1'.repeat(40), after, cwd });
  assert.equal(fallback.required, true);
  assert.equal(fallback.fallback, true);
});

test('serializes only explicit booleans to the Actions output file', t => {
  const output = join(temporaryDirectory(t), 'output');
  writeReleaseScope({ required: false }, output);
  writeReleaseScope({ required: true }, output);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=false\nserver-publish-required=true\n');
  assert.throws(() => writeReleaseScope({ required: 'false' }, output), /Invalid/);
  assert.throws(() => writeReleaseScope({ required: false }), /Invalid/);
});

const published = 'c'.repeat(40);

test('compares with the revision GHCR serves, so an unpublished earlier push is not skipped', () => {
  // 19 November 2026: two server-changing pushes never published, and the next
  // push changed only a test and the CHANGELOG.
  const result = releaseScope({ ...mainPush, published: { revision: published }, diff: (base, head) => {
    assert.deepEqual([base, head], [published, after]);
    return ['e2e/whiteboard-embeds.spec.ts', 'server/package.json'];
  } });
  assert.deepEqual(result, { required: true, fallback: false, reason: 'Server release paths changed since the published server image' });
  assert.equal(releaseScope({ ...mainPush, published: { revision: published }, diff: () => ['CHANGELOG.md'] }).required, false);
});

test('an unknown published revision publishes conservatively, and a current one skips', () => {
  for (const value of [{ error: 'registry unreachable' }, null, {}, { revision: 'HEAD~1' }, { revision: 'A'.repeat(40) }]) {
    // Any comparison here would answer 'not required' and fail the test.
    const result = releaseScope({ ...mainPush, published: value, diff: () => ['CHANGELOG.md'] });
    assert.equal(result.required, true, JSON.stringify(value));
    assert.equal(result.fallback, true, JSON.stringify(value));
  }
  assert.deepEqual(releaseScope({ ...mainPush, published: { revision: after }, diff: () => assert.fail('must not compare') }),
    { required: false, fallback: false, reason: 'The published server image is already this revision' });
  const unavailable = releaseScope({ ...mainPush, published: { revision: published }, diff: () => { throw new Error('missing object'); } });
  assert.equal(unavailable.required, true);
  assert.equal(unavailable.fallback, true);
});

/** A local stand-in for GHCR's token, manifest and blob endpoints. */
async function fakeRegistry(t, { revision, index = false, status = 200, token = 'fixture-token', amd64Platform = 'amd64', configDigest } = {}) {
  const config = `sha256:${'1'.repeat(64)}`;
  const amd64 = `sha256:${'2'.repeat(64)}`;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    const send = body => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url.startsWith('/token?scope=repository:owner/threatcaddy/server:pull')) return send(token === null ? {} : { token });
    if (request.url === '/v2/owner/threatcaddy/server/manifests/latest') {
      return send(index ? { manifests: [{ digest: `sha256:${'3'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64' } },
        { digest: amd64, platform: { os: 'linux', architecture: amd64Platform } }] } : { config: { digest: configDigest ?? config } });
    }
    if (request.url === `/v2/owner/threatcaddy/server/manifests/${amd64}`) return send({ config: { digest: config } });
    if (request.url === `/v2/owner/threatcaddy/server/blobs/${config}`) {
      return send({ config: { Labels: revision ? { 'org.opencontainers.image.revision': revision } : {} } });
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { registry: `http://127.0.0.1:${server.address().port}`, requests };
}

test('reads the published revision label through the registry token, manifest and config', async t => {
  const single = await fakeRegistry(t, { revision: published });
  assert.deepEqual(await publishedRevision('Owner/ThreatCaddy', { registry: single.registry }), { revision: published });
  assert.ok(single.requests.slice(1).every(request => request.authorization === 'Bearer fixture-token'));
  const index = await fakeRegistry(t, { revision: published, index: true });
  assert.deepEqual(await publishedRevision('Owner/ThreatCaddy', { registry: index.registry }), { revision: published });
  for (const options of [{ revision: undefined }, { revision: 'not-a-sha' }, { revision: published, status: 500 },
    { revision: published, token: null }, { revision: published, token: '' },
    { revision: published, index: true, amd64Platform: 'arm64' }, { revision: published, configDigest: 'sha256:short' }]) {
    const broken = await fakeRegistry(t, options);
    assert.match((await publishedRevision('Owner/ThreatCaddy', { registry: broken.registry })).error, /./, JSON.stringify(options));
  }
  for (const repository of [undefined, '', 'owner', 'owner/repo/extra', '../x']) {
    assert.ok((await publishedRevision(repository, { registry: single.registry })).error, String(repository));
  }
});

test('CLI compares with the published revision, writes output, and warns when it is unavailable', async t => {
  const { cwd, write, commit } = repository(t);
  write('README.md');
  const base = commit();
  write('server/src/changed.ts');
  const unpublished = commit();
  write('src/client.ts');
  const head = commit();
  const eventPath = join(cwd, 'event.json');
  const output = join(cwd, 'actions-output');
  writeFileSync(eventPath, JSON.stringify({ before: unpublished }));
  const script = fileURLToPath(new URL('./ci-release-scope.mjs', import.meta.url));
  const run = async registry => (await promisify(execFile)(process.execPath, [script], { cwd, encoding: 'utf8', env: { ...process.env,
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head, GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'Owner/ThreatCaddy', RELEASE_SCOPE_REGISTRY: registry } })).stdout;
  // The previous push only changed client code, but the published image predates the server change.
  assert.match(await run((await fakeRegistry(t, { revision: base })).registry), /Server release paths changed since the published server image/);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=true\n');
  assert.match(await run((await fakeRegistry(t, { revision: unpublished })).registry), /Only non-server release paths changed since/);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=true\nserver-publish-required=false\n');
  assert.match(await run((await fakeRegistry(t, { revision: published, status: 503 })).registry),
    /::warning::Could not read the published server image revision[\s\S]*::warning::Published server image revision unavailable/);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=true\nserver-publish-required=false\nserver-publish-required=true\n');
});
