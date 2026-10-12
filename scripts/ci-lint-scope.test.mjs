import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { checkLintBaseline } from './lib/lint-baseline.mjs';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });
for (const file of ['scripts/check-lint.mjs', 'agents/claude-code/scripts/tc.mjs', 'extension/src/background.js',
  'extension/src/pages/clips.js', 'public/chunk-reload-guard.js', 'extension/src/__tests__/boundaries.test.js',
  'server/scripts/verify-dockerode.mjs', 'server/src/__tests__/auth.test.ts', 'server/integration/database.ts',
  'e2e/app.spec.ts', 'standalone-tests/standalone.spec.ts', 'vite.config.ts', 'build/startup-budget.ts']) {
  test(`recommended rules cover ${file}`, async () => {
    const config = await eslint.calculateConfigForFile(file);
    assert.ok(config);
    assert.equal(config.rules['no-unsafe-finally'][0], 2);
    const [result] = await eslint.lintText('throw new Error("fixture");\nconst unusedFixture = 1;\n', { filePath: file });
    assert.ok(result.messages.some(message => message.ruleId?.endsWith('no-unused-vars') && message.severity === 2));
  });
}
test('extension and mixed harness globals are explicit, while misspelled identifiers remain errors', async () => {
  for (const file of ['extension/src/background.js', 'scripts/verify-extension-ui.mjs', 'scripts/measure-startup.mjs']) {
    const [result] = await eslint.lintText('chrome.runtime.sendMessage({});\ndocument.title;\nunknownFixture();', { filePath: file });
    assert.deepEqual(result.messages.filter(message => message.ruleId === 'no-undef').map(message => message.message), ["'unknownFixture' is not defined."]);
  }
});
test('production build tooling retains its Node-only global environment', async () => {
  for (const file of ['build/startup-budget.ts', 'build/fixture.tsx']) {
    const config = await eslint.calculateConfigForFile(file);
    assert.ok(Object.hasOwn(config.languageOptions.globals, 'process'));
    assert.equal(Object.hasOwn(config.languageOptions.globals, 'window'), false);
    assert.equal(config.rules['no-unsafe-finally'][0], 2);
  }
});
test('Playwright no-fixture parameters are allowed without allowing empty assignment patterns', async () => {
  const [result] = await eslint.lintText('export function afterEach({}, info: object) { return info; }\nconst {} = {};', { filePath: 'standalone-tests/fixture.ts' });
  assert.equal(result.messages.filter(message => message.ruleId === 'no-empty-pattern').length, 1);
});
test('generated and private evidence are ignored, but browser suites are covered', async () => {
  assert.equal(await eslint.isPathIgnored('dist/main.js'), true);
  assert.equal(await eslint.isPathIgnored('docs/reviews/private-check.js'), true);
  assert.equal(await eslint.isPathIgnored('e2e/app.spec.ts'), false);
  assert.equal(await eslint.isPathIgnored('standalone-tests/standalone.spec.ts'), false);
});

const warning = ruleId => ({ severity: 1, ruleId, message: 'Synthetic warning' });
test('warning counts cannot move across files/rules or use reductions elsewhere to hide a new warning', () => {
  const baseline = { version: 1, warnings: { 'src/one.ts': { 'fixture-rule': 2 } } };
  const unchanged = [{ filePath: root + 'src/one.ts', messages: [warning('fixture-rule')] }];
  assert.equal(checkLintBaseline(unchanged, baseline, root).ok, true);
  assert.equal(checkLintBaseline([...unchanged, { filePath: root + 'src/two.ts', messages: [warning('fixture-rule')] }], baseline, root).ok, false);
  assert.equal(checkLintBaseline([{ filePath: root + 'src/one.ts', messages: [warning('other-rule')] }], baseline, root).ok, false);
  assert.equal(checkLintBaseline([{ filePath: root + 'src/one.ts', messages: Array.from({ length: 3 }, () => warning('fixture-rule')) }], baseline, root).ok, false);
});
test('errors and malformed/nonportable baselines fail regardless of warning allowances', () => {
  assert.equal(checkLintBaseline([{ filePath: root + 'src/one.ts', messages: [{ severity: 2, ruleId: 'fixture-rule' }] }],
    { version: 1, warnings: { 'src/one.ts': { 'fixture-rule': 99 } } }, root).ok, false);
  assert.throws(() => checkLintBaseline([], { version: 1, warnings: { '/local/private/file.ts': {} } }, root), /portable/);
});
test('cleanup outcome keeps primary and cleanup failures, and never reports false success', () => {
  const primary = new Error('Synthetic primary failure');
  const cleanup = new Error('Synthetic cleanup failure');
  assert.doesNotThrow(() => throwIfFailed(undefined, []));
  assert.throws(() => throwIfFailed({ error: primary }, []), error => error === primary);
  assert.throws(() => throwIfFailed(undefined, [cleanup]), error => error === cleanup);
  assert.throws(() => throwIfFailed({ error: primary }, [cleanup]), error => error instanceof AggregateError
    && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup);
});
