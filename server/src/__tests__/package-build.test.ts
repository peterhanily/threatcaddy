import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

it('packages journaled migrations and runtime code without emitted tests, fixtures or maps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threatcaddy-package-build-'));
  fixtures.push(root);
  const put = async (path: string, content: string) => {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  };
  await mkdir(join(root, 'scripts'));
  await cp(new URL('../../scripts/package-build.mjs', import.meta.url), join(root, 'scripts/package-build.mjs'));
  await put('src/db/migrations/meta/_journal.json', JSON.stringify({ entries: [{ tag: '0000_fixture' }] }));
  await put('src/db/migrations/0000_fixture.sql', '-- ordinary migration fixture');
  await put('src/__tests__/original.test.ts', '// retained source fixture');
  await put('dist/index.js', '// runtime entry');
  await put('dist/index.js.map', '{}');
  await put('dist/__tests__/original.test.js', '// compiled source fixture');
  await put('dist/lib/example.test.js', '// standalone compiled test');
  await put('dist/lib/example.spec.d.ts', '// compiled test declaration');
  await put('dist/lib/__fixtures__/data.json', '{}');
  await put('dist/lib/fixtures/data.json', '{}');
  await put('dist/db/migrations/stale.sql', '-- removed migration output');
  execFileSync(process.execPath, [join(root, 'scripts/package-build.mjs')]);
  expect((await readdir(join(root, 'dist'))).sort()).toEqual(['db', 'index.js', 'lib']);
  expect(await readdir(join(root, 'dist/lib'))).toEqual([]);
  expect((await readdir(join(root, 'dist/db/migrations'))).sort()).toEqual(['0000_fixture.sql', 'meta']);
  expect(await readFile(join(root, 'dist/db/migrations/0000_fixture.sql'), 'utf8')).toBe('-- ordinary migration fixture');
  expect(await readFile(join(root, 'dist/index.js'), 'utf8')).toBe('// runtime entry');
  expect(await readFile(join(root, 'src/__tests__/original.test.ts'), 'utf8')).toBe('// retained source fixture');
});
