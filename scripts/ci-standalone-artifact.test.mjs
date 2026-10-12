import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const verify = load(read('.github/workflows/verify.yml'));
const job = verify.jobs['client-artifact'];

test('publication packages the assembled standalone only after both browser acceptance steps', () => {
  const steps = job.steps;
  const find = text => steps.findIndex(step => step.run?.includes(text));
  const hostedBuild = find('pnpm build');
  const standaloneBuild = find('pnpm build:single');
  const assembly = find('cp dist-single/index.html dist/threatcaddy-standalone.html');
  const hosted = find('pnpm test:e2e');
  const standalone = find('pnpm exec playwright test --config playwright.standalone.config.ts');
  const packaging = find('tar -cf verified-client/client.tar -C dist .');
  assert.ok(hostedBuild >= 0 && hostedBuild < standaloneBuild);
  assert.ok(standaloneBuild < assembly && assembly < hosted);
  assert.ok(hosted < standalone && standalone < packaging);
  assert.equal(steps[hosted].env.PLAYWRIGHT_SKIP_BUILD, '1');
  for (const index of [assembly, hosted, standalone, packaging]) {
    assert.equal(steps[index].if, undefined);
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.equal(job['continue-on-error'], undefined);
  assert.doesNotMatch(JSON.stringify([verify.env, job.env, ...steps]), /MATH_TEST_STANDALONE/);
});

test('both standalone suites default to the published copy, preserving only the explicit math comparison override', () => {
  const ordinary = read('standalone-tests/standalone.spec.ts');
  assert.match(ordinary, /await copyFile\('dist\/threatcaddy-standalone\.html', path\)/);
  assert.doesNotMatch(ordinary, /dist-single|MATH_TEST_STANDALONE/);
  const math = read('standalone-tests/math-rendering.spec.ts');
  assert.match(math, /await copyFile\(process\.env\.MATH_TEST_STANDALONE === undefined\s*\? 'dist\/threatcaddy-standalone\.html'\s*: join\(process\.env\.MATH_TEST_STANDALONE, 'index\.html'\), path\)/);
  assert.doesNotMatch(math, /dist-single/);
});

test('local verification assembles the published download before standalone acceptance', () => {
  const docs = read('docs/development-verification.md');
  const blocks = [...docs.matchAll(/```sh\n([\s\S]*?)```/g)].map(match => match[1]);
  const block = blocks.find(text => text.includes('pnpm exec playwright test --config playwright.standalone.config.ts'));
  assert.ok(block);
  assert.match(block, /pnpm build:single\ncp dist-single\/index\.html dist\/threatcaddy-standalone\.html\ntouch dist\/\.nojekyll/);
  assert.ok(block.indexOf('cp dist-single/index.html') < block.indexOf('pnpm exec playwright test --config playwright.standalone.config.ts'));
});
