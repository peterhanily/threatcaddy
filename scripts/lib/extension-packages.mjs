// Release archives are inspected in memory; no archive member is extracted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export const EXTENSION_LOCALES = ['ar', 'de', 'en', 'es', 'fa', 'fr', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt_BR', 'ru', 'th', 'tr', 'uk', 'vi', 'zh_CN'];
export const ICON_SIZES = [16, 48, 128];
export const EXTENSION_MEMBERS = [
  'manifest.json', 'background.js', 'bridge.js', 'content.js', 'popup.html', 'popup.js', 'ui.js',
  'pages/clips.html', 'pages/clips.js', 'assets/icon.svg',
  ...ICON_SIZES.map(size => `assets/icon-${size}.png`),
  ...EXTENSION_LOCALES.map(locale => `_locales/${locale}/messages.json`),
].sort();
const MAX_ARCHIVE = 16 * 1024 * 1024;
const MAX_MEMBER = 2 * 1024 * 1024;
const MAX_CONTENT = 8 * 1024 * 1024;
const fail = message => { throw new Error(message); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateIcon(bytes, size) {
  assert.ok(bytes.length >= 57 && bytes.length <= 256 * 1024, 'Invalid icon PNG length');
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid icon PNG signature');
  let offset = 8; let sawData = false; let sawEnd = false; let colorType; let palette = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated icon PNG chunk');
    const length = bytes.readUInt32BE(offset);
    assert.ok(length <= bytes.length - offset - 12, 'Truncated icon PNG data');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'pHYs', 'sRGB', 'gAMA', 'cHRM'].includes(type), `Unexpected icon PNG chunk ${type}`);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), 'Icon PNG checksum mismatch');
    if (offset === 8) {
      assert.equal(type, 'IHDR'); assert.equal(length, 13);
      assert.equal(bytes.readUInt32BE(offset + 8), size, 'Icon PNG width mismatch');
      assert.equal(bytes.readUInt32BE(offset + 12), size, 'Icon PNG height mismatch');
      assert.equal(bytes[offset + 16], 8, 'Unsupported icon PNG bit depth');
      assert.ok([2, 3, 6].includes(bytes[offset + 17]), 'Unsupported icon PNG color type');
      colorType = bytes[offset + 17];
      assert.equal(bytes[offset + 18], 0); assert.equal(bytes[offset + 19], 0); assert.equal(bytes[offset + 20], 0);
    } else assert.notEqual(type, 'IHDR', 'Duplicate icon PNG header');
    if (type === 'PLTE') { assert.ok(!sawData && !palette); assert.ok(length > 0 && length <= 768 && length % 3 === 0); palette = true; }
    if (type === 'IDAT') { assert.ok(!sawEnd); sawData = true; compressed.push(bytes.subarray(offset + 8, offset + 8 + length)); }
    if (type === 'IEND') {
      assert.equal(length, 0); assert.ok(sawData, 'Icon PNG has no image data');
      assert.equal(offset + 12, bytes.length, 'Unexpected bytes after icon PNG'); sawEnd = true;
    }
    offset += 12 + length;
  }
  assert.ok(sawEnd, 'Icon PNG has no end marker');
  assert.ok(colorType !== 3 || palette, 'Indexed icon PNG requires a palette');
  const rowLength = size * ({ 2: 3, 3: 1, 6: 4 }[colorType]) + 1;
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: size * rowLength });
  assert.equal(pixels.length, size * rowLength, 'Icon PNG has invalid raster length');
  for (let row = 0; row < size; row++) assert.ok(pixels[row * rowLength] <= 4, 'Icon PNG has invalid row filter');
}

// Reject unusual archive features rather than attempting general ZIP extraction.
// Our writer produces ordinary, bounded, single-disk ZIPs with no descriptors,
// comments, directories, links, or paths outside this exact portable allowlist.
export function inspectZip(bytes, expected = EXTENSION_MEMBERS) {
  assert.ok(bytes.length >= 22 && bytes.length <= MAX_ARCHIVE, 'Invalid archive size');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'Expected plain ZIP end record without a comment');
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count); assert.equal(count, expected.length, 'Unexpected archive member count');
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const centralSize = bytes.readUInt32LE(end + 12); const centralStart = bytes.readUInt32LE(end + 16);
  assert.equal(centralStart + centralSize, end, 'Invalid archive central directory bounds');
  let offset = centralStart; let total = 0;
  const members = []; const names = new Set(); const ranges = [];
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= end, 'Truncated archive directory');
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'Invalid archive directory member');
    const flags = bytes.readUInt16LE(offset + 8); const method = bytes.readUInt16LE(offset + 10);
    assert.ok(flags === 0 || flags === 0x800, 'Unsupported archive flags');
    assert.ok(method === 0 || method === 8, 'Unsupported archive compression');
    const crc = bytes.readUInt32LE(offset + 16); const compressed = bytes.readUInt32LE(offset + 20); const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28); const extraLength = bytes.readUInt16LE(offset + 30); const commentLength = bytes.readUInt16LE(offset + 32);
    assert.ok(offset + 46 + nameLength + extraLength + commentLength <= end, 'Truncated archive name');
    assert.equal(commentLength, 0, 'Unexpected archive member comment');
    assert.equal(bytes.readUInt16LE(offset + 34), 0);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    assert.ok(expected.includes(name), `Unexpected archive member: ${name}`);
    assert.ok(!names.has(name), `Duplicate archive member: ${name}`); names.add(name);
    const attributes = bytes.readUInt32LE(offset + 38);
    assert.ok((attributes & 16) === 0, 'Archive directory members are not permitted');
    const unixType = (attributes >>> 16) & 0o170000;
    assert.ok(unixType === 0 || unixType === 0o100000, 'Archive member must be a regular file');
    assert.ok(size <= MAX_MEMBER && compressed <= MAX_MEMBER, 'Archive member exceeds bound');
    total += size; assert.ok(total <= MAX_CONTENT, 'Archive content exceeds bound');
    const local = bytes.readUInt32LE(offset + 42);
    assert.ok(local + 30 <= centralStart, 'Invalid archive local header');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'Invalid archive local signature');
    assert.equal(bytes.readUInt16LE(local + 6), flags); assert.equal(bytes.readUInt16LE(local + 8), method);
    assert.equal(bytes.readUInt32LE(local + 14), crc); assert.equal(bytes.readUInt32LE(local + 18), compressed); assert.equal(bytes.readUInt32LE(local + 22), size);
    const localName = bytes.readUInt16LE(local + 26); const localExtra = bytes.readUInt16LE(local + 28);
    const localEnd = local + 30 + localName + localExtra + compressed;
    assert.ok(localEnd <= centralStart, 'Archive member extends outside local area');
    assert.equal(bytes.toString('utf8', local + 30, local + 30 + localName), name, 'Archive local name mismatch');
    ranges.push([local, localEnd]); members.push({ name, size, crc });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, end); assert.deepEqual([...names].sort(), [...expected].sort());
  ranges.sort((left, right) => left[0] - right[0]);
  let next = 0;
  for (const [start, finish] of ranges) { assert.equal(start, next, 'Archive has hidden or overlapping local records'); next = finish; }
  assert.equal(next, centralStart, 'Archive contains unlisted local data');
  return members;
}

function directoryChain(root, path) {
  const below = relative(root, path);
  assert.ok(below && !isAbsolute(below) && !below.split(sep).includes('..'), 'Release path must remain within the repository');
  let current = root;
  assert.ok(lstatSync(current).isDirectory(), 'Release root must be a real directory');
  for (const part of below.split(sep).slice(0, -1)) {
    current = join(current, part);
    assert.ok(lstatSync(current).isDirectory(), `Release parent must not be a symlink: ${current}`);
  }
}

export function assertReleaseOutput(root, path) {
  directoryChain(root, path);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  assert.ok(!stat || stat.isFile(), `Refusing non-regular release output: ${path}`);
}

function regularFile(path, root) {
  if (root) directoryChain(root, path);
  const stat = lstatSync(path);
  assert.ok(stat.isFile(), `Expected a regular file: ${path}`);
  assert.ok(stat.size <= MAX_MEMBER, `File exceeds release member bound: ${path}`);
  const bytes = readFileSync(path);
  assert.ok(bytes.length <= MAX_MEMBER, `File exceeds release member bound: ${path}`);
  return bytes;
}

export function sourcePath(root, browser, member) {
  return join(root, 'extension', member.startsWith('assets/') ? member : `src/${member === 'manifest.json' && browser === 'firefox' ? 'manifest.firefox.json' : member}`);
}

function listBuild(directory, prefix = '') {
  assert.ok(lstatSync(directory).isDirectory(), `Build directory must not be a symlink: ${directory}`);
  return readdirSync(directory).flatMap(name => {
    const relative = prefix + name; const path = join(directory, name); const stat = lstatSync(path);
    if (stat.isDirectory()) {
      assert.ok(EXTENSION_MEMBERS.some(member => member.startsWith(relative + '/')), `Unexpected build directory: ${relative}`);
      return listBuild(path, relative + '/');
    }
    assert.ok(stat.isFile(), `Build member must be a regular file: ${relative}`);
    return [relative];
  });
}

export function verifyBuilds(root) {
  const packageData = JSON.parse(regularFile(join(root, 'extension/package.json'), root));
  const lock = JSON.parse(regularFile(join(root, 'extension/package-lock.json'), root));
  const version = packageData.version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Expected a patch release version');
  assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
  for (const browser of ['chrome', 'firefox']) {
    const directory = join(root, 'extension/dist', browser);
    assert.deepEqual(listBuild(directory).sort(), EXTENSION_MEMBERS, `${browser} build has missing or unexpected files`);
    for (const member of EXTENSION_MEMBERS) {
      const source = regularFile(sourcePath(root, browser, member), root);
      assert.ok(source.equals(regularFile(join(directory, member), root)), `${browser} build differs from source: ${member}`);
      const icon = /^assets\/icon-(16|48|128)\.png$/.exec(member);
      if (icon) validateIcon(source, Number(icon[1]));
      if (member === 'manifest.json') assert.equal(JSON.parse(source).version, version, `${browser} version mismatch`);
      if (member.startsWith('_locales/')) {
        const entry = JSON.parse(source).version;
        assert.match(entry.message, /\$VERSION\$/i, 'Locale must use the runtime version placeholder');
        assert.equal(entry.placeholders?.version?.content, '$1');
        assert.doesNotMatch(entry.message, /\d+\.\d+\.\d+/, 'Locale must not embed a release version');
      }
    }
  }
  return { version, members: EXTENSION_MEMBERS.length, locales: EXTENSION_LOCALES.length };
}

export function verifyArchive(root, browser, archive) {
  const stat = lstatSync(archive);
  assert.ok(stat.isFile(), 'Archive must be a regular file');
  assert.ok(stat.size <= MAX_ARCHIVE, 'Archive exceeds release bound');
  const bytes = readFileSync(archive);
  const members = inspectZip(bytes);
  for (const member of members) {
    // Only known literal paths reach unzip, after full directory validation.
    const actual = execFileSync('unzip', ['-p', archive, member.name], { maxBuffer: MAX_MEMBER, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(actual.length, member.size); assert.equal(crc32(actual), member.crc, 'Archive checksum mismatch');
    const expected = regularFile(sourcePath(root, browser, member.name), root);
    const icon = /^assets\/icon-(16|48|128)\.png$/.exec(member.name);
    if (icon) {
      // libvips/sharp encodings can vary across OS/CPU; this is the sole byte exception.
      validateIcon(actual, Number(icon[1])); validateIcon(expected, Number(icon[1]));
    } else assert.ok(actual.equals(expected), `${browser} archive differs from source: ${member.name}`);
  }
  return { browser, sha256: sha256(bytes), members: members.length };
}

export function verifyRelease(root) {
  const result = verifyBuilds(root);
  result.archives = ['chrome', 'firefox'].map(browser => {
    const archive = join(root, `extension/threatcaddy-${browser}.zip`);
    directoryChain(root, archive);
    const receipt = verifyArchive(root, browser, archive);
    const alias = join(root, `${browser}.zip`);
    assert.ok(lstatSync(alias).isFile(), 'Download alias must be a regular file');
    assert.equal(lstatSync(alias).size, lstatSync(archive).size, `${browser} root alias differs from extension archive`);
    assert.ok(readFileSync(alias).equals(readFileSync(archive)), `${browser} root alias differs from extension archive`);
    return receipt;
  });
  return result;
}

export function parsePackageMode(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--check')) return 'check';
  if (args.length === 1 && args[0] === '--build-only') return 'build-only';
  if (args.length === 1 && args[0] === '--write') return 'write';
  return fail('Usage: node scripts/verify-extension-packages.mjs [--check|--build-only|--write]');
}
