import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { checkLintBaseline } from './lib/lint-baseline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['.']);
const formatter = await eslint.loadFormatter('stylish');
const diagnostics = formatter.format(results);
if (diagnostics) console.log(diagnostics);
const baseline = JSON.parse(await readFile(new URL('./lint-warning-baseline.json', import.meta.url), 'utf8'));
const summary = checkLintBaseline(results, baseline, root);
for (const regression of summary.regressions) {
  console.error(`New lint warning: ${regression.file} [${regression.rule}] ${regression.actual} > baseline ${regression.allowed}`);
}
console.log(`Lint: ${summary.errors} errors; ${summary.warnings} existing warnings; ${summary.regressions.length} file/rule regressions.`);
if (!summary.ok) process.exitCode = 1;
