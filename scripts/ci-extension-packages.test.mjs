import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { assertReleaseOutput, crc32, EXTENSION_MEMBERS, inspectZip, parsePackageMode, sourcePath, validateIcon, verifyArchive, verifyBuilds, verifyRelease } from './lib/extension-packages.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
function put(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'threatcaddy-package-fixture-'));
  t.after(() => rmSync(root, { recursive: true }));
  return root;
}
function fixture(t) {
  const root = temporary(t);
  for (const member of ['package.json', 'package-lock.json']) put(join(root, 'extension', member), readFileSync(join(repo, 'extension', member)));
  for (const browser of ['chrome', 'firefox']) {
    for (const member of EXTENSION_MEMBERS) {
      // Root CI runs before the separate extension build job, so no generated
      // icon files may be assumed in a clean checkout.
      const icon = /^assets\/icon-(16|48|128)\.png$/.exec(member);
      const bytes = icon ? png(Number(icon[1])) : readFileSync(sourcePath(repo, browser, member));
      put(sourcePath(root, browser, member), bytes);
      put(join(root, 'extension/dist', browser, member), bytes);
    }
  }
  return root;
}
function archive(root, browser = 'chrome', entries = EXTENSION_MEMBERS) {
  const file = join(root, `${browser}-fixture.zip`);
  execFileSync('zip', ['-X', '-q', file, ...entries], { cwd: join(root, 'extension/dist', browser) });
  return file;
}
function png(size, color = 0) {
  const chunk = (type, body) => {
    const data = Buffer.concat([Buffer.from(type), body]);
    const result = Buffer.alloc(body.length + 12);
    result.writeUInt32BE(body.length); data.copy(result, 4); result.writeUInt32BE(crc32(data), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(size * (size * 4 + 1), color);
  for (let row = 0; row < size; row++) rows[row * (size * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('only an explicit write flag can request release changes', () => {
  assert.equal(parsePackageMode([]), 'check'); assert.equal(parsePackageMode(['--check']), 'check');
  assert.equal(parsePackageMode(['--write']), 'write'); assert.equal(parsePackageMode(['--build-only']), 'build-only');
  for (const args of [['write'], ['--check', '--write'], ['--fix'], ['--root', '/']]) assert.throws(() => parsePackageMode(args), /Usage/);
});

test('the portable release allowlist is exact and includes every locale and runtime helper', () => {
  assert.equal(EXTENSION_MEMBERS.length, 34); assert.equal(new Set(EXTENSION_MEMBERS).size, 34);
  assert.equal(EXTENSION_MEMBERS.filter(member => member.startsWith('_locales/')).length, 21);
  assert.ok(EXTENSION_MEMBERS.includes('ui.js'));
});

test('versions, all locale placeholders and source/build bytes agree', t => {
  const root = fixture(t);
  assert.deepEqual(verifyBuilds(root), { version: '1.1.2', members: 34, locales: 21 });
});

test('verification rejects stale or extra build files, even benign hidden metadata', t => {
  const root = fixture(t); const extra = join(root, 'extension/dist/chrome/.DS_Store');
  put(extra, 'Fictional generated metadata'); assert.throws(() => verifyBuilds(root), /unexpected files/);
  rmSync(extra); put(join(root, 'extension/dist/chrome/ui.js'), '// stale ordinary build');
  assert.throws(() => verifyBuilds(root), /differs from source/);
});

test('build symlinks are rejected without following them', t => {
  const root = fixture(t); const file = join(root, 'extension/dist/chrome/ui.js'); rmSync(file);
  symlinkSync(sourcePath(root, 'chrome', 'ui.js'), file);
  assert.throws(() => verifyBuilds(root), /regular file/);
});

test('release output checks refuse even dangling symlinks and symlinked parent directories', t => {
  const root = fixture(t); const alias = join(root, 'chrome.zip');
  symlinkSync(join(root, 'missing-ordinary-target'), alias);
  assert.throws(() => assertReleaseOutput(root, alias), /non-regular/);
  symlinkSync(join(root, 'extension'), join(root, 'linked-directory'));
  assert.throws(() => assertReleaseOutput(root, join(root, 'linked-directory/example.zip')), /parent must not be a symlink/);
});

test('incoherent manifests fail closed', t => {
  const root = fixture(t); const file = sourcePath(root, 'firefox', 'manifest.json');
  const manifest = JSON.parse(readFileSync(file)); manifest.version = '1.0.0';
  put(file, JSON.stringify(manifest)); put(join(root, 'extension/dist/firefox/manifest.json'), JSON.stringify(manifest));
  assert.throws(() => verifyBuilds(root), /version mismatch/);
});

test('obsolete localized version constants fail even when the build matches source', t => {
  const root = fixture(t); const member = '_locales/en/messages.json';
  const catalog = JSON.parse(readFileSync(sourcePath(root, 'chrome', member))); catalog.version.message = 'v1.1.1';
  put(sourcePath(root, 'chrome', member), JSON.stringify(catalog));
  for (const browser of ['chrome', 'firefox']) put(join(root, 'extension/dist', browser, member), JSON.stringify(catalog));
  assert.throws(() => verifyBuilds(root), /runtime version placeholder/);
});

test('ordinary generated archives have exactly the allowed regular members and source bytes', t => {
  const root = fixture(t); const zip = archive(root);
  assert.equal(inspectZip(readFileSync(zip)).length, 34);
  assert.equal(verifyArchive(root, 'chrome', zip).members, 34);
});

test('unexpected ZIP members are rejected before reading their content', t => {
  const root = fixture(t); put(join(root, 'extension/dist/chrome/ordinary-extra.txt'), 'Not release content');
  assert.throws(() => inspectZip(readFileSync(archive(root, 'chrome', [...EXTENSION_MEMBERS, 'ordinary-extra.txt']))), /member count/);
});

test('duplicate or non-regular directory records are rejected without extraction', t => {
  const root = fixture(t); const original = readFileSync(archive(root));
  const central = original.readUInt32LE(original.length - 6);
  const altered = Buffer.from(original);
  altered.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  assert.throws(() => inspectZip(altered), /regular file/);
  const duplicate = Buffer.from(original);
  const names = [];
  for (let offset = central; offset < original.length - 22;) {
    const length = original.readUInt16LE(offset + 28);
    names.push({ offset, name: original.subarray(offset + 46, offset + 46 + length) });
    offset += 46 + length + original.readUInt16LE(offset + 30) + original.readUInt16LE(offset + 32);
  }
  const first = names.find(entry => entry.name.toString() === '_locales/ar/messages.json');
  const second = names.find(entry => entry.name.toString() === '_locales/de/messages.json');
  assert.ok(first && second); first.name.copy(duplicate, second.offset + 46);
  assert.throws(() => inspectZip(duplicate), /Duplicate archive member/);
});

test('truncated ZIPs and local/central inconsistencies cannot pass', t => {
  const root = fixture(t); const original = readFileSync(archive(root));
  assert.throws(() => inspectZip(original.subarray(0, original.length - 1)));
  const altered = Buffer.from(original); altered.writeUInt32LE(0, 18);
  assert.throws(() => inspectZip(altered));
});

test('PNG portability is bounded to valid checksummed icon dimensions and no trailing data', () => {
  validateIcon(png(16), 16); validateIcon(png(48), 48); validateIcon(png(128), 128);
  assert.throws(() => validateIcon(png(48), 16), /width mismatch/);
  assert.throws(() => validateIcon(Buffer.concat([png(16), Buffer.from('extra')]), 16), /after icon/);
  const invalid = png(16); invalid[invalid.length - 1] ^= 1;
  assert.throws(() => validateIcon(invalid, 16), /checksum/);
});

test('only generated PNG bytes may differ; runtime source never receives an exception', t => {
  const root = fixture(t);
  put(join(root, 'extension/dist/chrome/assets/icon-16.png'), png(16, 42));
  const zip = archive(root); verifyArchive(root, 'chrome', zip);
  put(sourcePath(root, 'chrome', 'ui.js'), '// new runtime source');
  assert.throws(() => verifyArchive(root, 'chrome', zip), /differs from source: ui.js/);
});

test('both root download aliases must be byte-identical and checks never rewrite them', t => {
  const root = fixture(t);
  for (const browser of ['chrome', 'firefox']) {
    const zip = archive(root, browser);
    copyFileSync(zip, join(root, `extension/threatcaddy-${browser}.zip`)); copyFileSync(zip, join(root, `${browser}.zip`));
  }
  const before = readFileSync(join(root, 'chrome.zip'));
  assert.equal(verifyRelease(root).archives.length, 2);
  assert.ok(readFileSync(join(root, 'chrome.zip')).equals(before));
  put(join(root, 'chrome.zip'), 'Different ordinary artifact');
  assert.throws(() => verifyRelease(root), /root alias differs/);
  assert.equal(readFileSync(join(root, 'chrome.zip'), 'utf8'), 'Different ordinary artifact');
});
