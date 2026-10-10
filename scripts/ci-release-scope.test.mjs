import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, isServerReleasePath, parseChangedPaths, releaseScope, writeReleaseScope } from './ci-release-scope.mjs';

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

test('CLI uses event before SHA, writes output, and warns on unavailable metadata', t => {
  const { cwd, write, commit } = repository(t);
  write('README.md');
  const before = commit();
  write('src/client.ts');
  const after = commit();
  const eventPath = join(cwd, 'event.json');
  const output = join(cwd, 'actions-output');
  writeFileSync(eventPath, JSON.stringify({ before }));
  const env = { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: after, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output };
  const script = fileURLToPath(new URL('./ci-release-scope.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
  assert.match(run(), /Only non-server/);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=false\n');
  writeFileSync(eventPath, 'invalid JSON');
  assert.match(run(), /::warning::Comparison base unavailable/);
  assert.equal(readFileSync(output, 'utf8'), 'server-publish-required=false\nserver-publish-required=true\n');
});
