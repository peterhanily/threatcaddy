#!/usr/bin/env node
// Explicit --write refreshes release files; the default CI path never mutates them.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseOutput, EXTENSION_MEMBERS, parsePackageMode, verifyArchive, verifyBuilds, verifyRelease } from './lib/extension-packages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = parsePackageMode(process.argv.slice(2));
try {
  if (mode === 'write') {
    verifyBuilds(root); // Refuse stale or extra files before writing anything.
    const temporary = mkdtempSync(join(tmpdir(), 'threatcaddy-extension-release-'));
    try {
      for (const browser of ['chrome', 'firefox']) {
        const archive = join(temporary, `${browser}.zip`);
        execFileSync('zip', ['-X', '-q', archive, ...EXTENSION_MEMBERS], { cwd: join(root, 'extension/dist', browser), stdio: ['ignore', 'pipe', 'pipe'] });
        verifyArchive(root, browser, archive);
      }
      // Both variants must pass before replacing any release archive.
      const outputs = ['chrome', 'firefox'].flatMap(browser => [
        [join(temporary, `${browser}.zip`), join(root, `extension/threatcaddy-${browser}.zip`)],
        [join(temporary, `${browser}.zip`), join(root, `${browser}.zip`)],
        [join(temporary, `${browser}.zip`), join(root, `extension/dist/threatcaddy-${browser}.zip`)],
      ]);
      for (const [, output] of outputs) {
        assertReleaseOutput(root, output);
      }
      for (const [archive, output] of outputs) copyFileSync(archive, output);
    } finally {
      // The only removal is the exact fresh task-owned temporary directory.
      rmSync(temporary, { recursive: true });
    }
  }
  console.log(JSON.stringify(mode === 'build-only' ? verifyBuilds(root) : verifyRelease(root), null, 2));
} catch (error) {
  console.error(`Extension package verification failed: ${error.message}`);
  process.exitCode = 1;
}
