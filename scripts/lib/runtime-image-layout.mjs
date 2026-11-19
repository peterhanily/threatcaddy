// File-layout checks for the packaged server. Image acceptance runs this source
// inside the image as its runtime user; unit tests run it against fixtures.
import { accessSync, constants, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A PEM header followed by an encoded body. Parsers that only name the header
// in their source text do not match.
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]/;

function* tree(path) {
  yield path;
  if (lstatSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) yield* tree(join(path, name));
  }
}

function missing(error, codes) {
  if (!codes.includes(error.code)) throw error;
  return true;
}

/**
 * Lists every way the layout differs from the expected one: readOnly trees
 * must not be writable and must not ship private-key blocks, writable
 * directories must accept a new file, and absent paths must not exist.
 */
export function runtimeLayoutProblems({ readOnly = [], writable = [], absent = [] }) {
  const problems = [];
  for (const root of readOnly) {
    for (const path of tree(root)) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      let canWrite = true;
      try { accessSync(path, constants.W_OK); } catch (error) { canWrite = !missing(error, ['EACCES', 'EPERM', 'EROFS']); }
      if (canWrite) problems.push(`writable by the runtime user: ${path}`);
      if (stat.isFile() && PRIVATE_KEY_BLOCK.test(readFileSync(path, 'latin1'))) problems.push(`private key material: ${path}`);
    }
  }
  for (const directory of writable) {
    const probe = join(directory, `.runtime-layout-probe-${process.pid}`);
    try {
      writeFileSync(probe, '', { flag: 'wx' });
      rmSync(probe);
    } catch (error) {
      problems.push(`not writable by the runtime user: ${directory} (${error.code})`);
    }
  }
  for (const path of absent) {
    let present = true;
    try { lstatSync(path); } catch (error) { present = !missing(error, ['ENOENT']); }
    if (present) problems.push(`should have been pruned: ${path}`);
  }
  return problems;
}
