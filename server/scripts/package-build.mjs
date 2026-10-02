import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'src/db/migrations');
const target = resolve(root, 'dist/db/migrations');
const journal = JSON.parse(await readFile(resolve(source, 'meta/_journal.json'), 'utf8'));
// Remove only generated migration assets so removed files cannot survive a build.
await rm(target, { recursive: true, force: true });
await mkdir(resolve(target, 'meta'), { recursive: true });
for (const entry of journal.entries) {
  if (!/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error('Invalid migration asset name');
  await cp(resolve(source, `${entry.tag}.sql`), resolve(target, `${entry.tag}.sql`));
}
await cp(resolve(source, 'meta/_journal.json'), resolve(target, 'meta/_journal.json'));
// TypeScript still checks source tests during a local build. None of their
// emitted files, fixture directories, or source maps are production assets.
// Prune only generated dist entries; source tests and fixtures remain intact.
const developmentDirectories = new Set(['__tests__', '__fixtures__', 'fixtures']);
async function removeDevelopmentAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (developmentDirectories.has(entry.name)) await rm(path, { recursive: true, force: true });
      else await removeDevelopmentAssets(path);
    } else if (entry.name.endsWith('.map') || /\.(?:test|spec)\.(?:js|d\.ts)$/.test(entry.name)) await rm(path);
  }
}
await removeDevelopmentAssets(resolve(root, 'dist'));
