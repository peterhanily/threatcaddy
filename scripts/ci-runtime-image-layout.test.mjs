import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runtimeLayoutProblems } from './lib/runtime-image-layout.mjs';

// Image acceptance runs this check as the non-root runtime user; root may write anything.
const asRoot = process.getuid?.() === 0;
// Synthetic, truncated key text: only the PEM shape matters to the check.
const KEY_FIXTURE = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAfixture\n-----END OPENSSH PRIVATE KEY-----\n';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'threatcaddy-layout-'));
  const app = join(root, 'app');
  const data = join(root, 'data');
  mkdirSync(join(app, 'dist'), { recursive: true });
  mkdirSync(join(app, 'node_modules', 'ssh2', 'lib'), { recursive: true });
  mkdirSync(data);
  writeFileSync(join(app, 'package.json'), '{"version":"0.0.0"}');
  writeFileSync(join(app, 'dist', 'index.js'), 'console.log("fixture");\n');
  // Parsers name the PEM header in source text; only an embedded key block counts.
  writeFileSync(join(app, 'node_modules', 'ssh2', 'lib', 'keyParser.js'), "const header = '-----BEGIN OPENSSH PRIVATE KEY-----\\n';\n");
  symlinkSync('../dist/index.js', join(app, 'node_modules', 'entry.js'));
  const files = [join(app, 'package.json'), join(app, 'dist', 'index.js'), join(app, 'node_modules', 'ssh2', 'lib', 'keyParser.js')];
  const directories = [join(app, 'node_modules', 'ssh2', 'lib'), join(app, 'node_modules', 'ssh2'), join(app, 'node_modules'), join(app, 'dist'), app];
  const lock = () => {
    for (const file of files) chmodSync(file, 0o444);
    for (const directory of directories) chmodSync(directory, 0o555);
  };
  t.after(() => {
    for (const directory of [...directories, data]) chmodSync(directory, 0o755);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, app, data, lock, directories };
}

test('a root-owned application tree with a writable data directory passes', { skip: asRoot }, t => {
  const { app, data, lock, root } = fixture(t);
  lock();
  assert.deepEqual(runtimeLayoutProblems({ readOnly: [app], writable: [data], absent: [join(root, 'pruned')] }), []);
});

test('writable application code, a read-only data directory and unpruned paths are reported', { skip: asRoot }, t => {
  const { app, data, lock, root } = fixture(t);
  lock();
  chmodSync(join(app, 'dist'), 0o755);
  chmodSync(join(app, 'dist', 'index.js'), 0o644);
  chmodSync(data, 0o555);
  const problems = runtimeLayoutProblems({ readOnly: [app], writable: [data], absent: [join(app, 'dist'), join(root, 'pruned')] });
  assert.deepEqual(problems, [
    `writable by the runtime user: ${join(app, 'dist')}`,
    `writable by the runtime user: ${join(app, 'dist', 'index.js')}`,
    `not writable by the runtime user: ${data} (EACCES)`,
    `should have been pruned: ${join(app, 'dist')}`,
  ]);
});

test('an embedded private-key block anywhere in the application tree is reported', { skip: asRoot }, t => {
  const { app, data, lock } = fixture(t);
  const key = join(app, 'node_modules', 'ssh2', 'lib', 'id_fixture');
  writeFileSync(key, KEY_FIXTURE);
  lock();
  chmodSync(key, 0o444);
  assert.deepEqual(runtimeLayoutProblems({ readOnly: [app], writable: [data] }), [`private key material: ${key}`]);
});
