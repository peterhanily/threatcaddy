import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const workflowNames = readdirSync(new URL('.github/workflows/', root)).filter(name => /\.ya?ml$/.test(name));
const workflows = Object.fromEntries(workflowNames.map(name => [name, load(read(`.github/workflows/${name}`))]));
const ci = workflows['ci.yml'];
const verify = workflows['verify.yml'];
const pages = workflows['publish-pages.yml'];
const server = workflows['publish-server.yml'];
const manualPages = workflows['deploy.yml'];
const manualServer = workflows['deploy-server.yml'];
const mainPush = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const mainRelease = "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
const expression = text => '${{ ' + text + ' }}';
const stepsOf = job => job.steps ?? [];
const downloads = job => stepsOf(job).filter(step => step.uses?.startsWith('actions/download-artifact@'));
const commands = job => stepsOf(job).map(step => step.run ?? '').join('\n');
const minimumRead = { contents: 'read' };
const pagesPermission = { contents: 'read', pages: 'write', 'id-token': 'write' };
const pagesCallerPermission = { contents: 'read', actions: 'read', pages: 'write', 'id-token': 'write' };
const serverPermission = { contents: 'read', packages: 'write' };

const playwrightConfig = ci => {
  const env = { ...process.env };
  delete env.CI;
  if (ci) env.CI = 'true';
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import c from './playwright.config.ts'; import s from './playwright.standalone.config.ts'; console.log(JSON.stringify({ flaky: c.failOnFlakyTests, retries: c.retries, workers: c.workers ?? null, maxFailures: c.maxFailures, globalTimeout: c.globalTimeout, timeout: c.timeout, projects: c.projects.map(project => project.name), trace: c.use.trace, standaloneTrace: s.use.trace, standaloneRetries: s.retries, standaloneBrowsers: s.projects.map(project => ({ ...s.use, ...project.use })).map(use => use.channel ?? use.browserName ?? use.defaultBrowserType ?? 'chromium') }));"],
  { cwd: new URL('../', import.meta.url), env, encoding: 'utf8' }));
};

test('CI browser failures retain the original trace and cannot pass only through a retry', () => {
  const config = playwrightConfig(true);
  assert.equal(config.flaky, true);
  assert.equal(config.retries, 1);
  assert.equal(config.workers, 1);
  assert.equal(config.trace, 'retain-on-failure');
  assert.equal(config.standaloneTrace, 'retain-on-failure');
  assert.equal(config.standaloneRetries, 0);
});

test('a broad CI browser regression stops early with its report; local runs fail on the first attempt', () => {
  const ci = playwrightConfig(true);
  assert.equal(ci.maxFailures, 10);
  assert.equal(ci.globalTimeout, 20 * 60_000);
  assert.equal(ci.timeout, 30_000);
  const local = playwrightConfig(false);
  assert.equal(local.retries, 0);
  assert.equal(local.flaky, false);
  assert.equal(local.maxFailures, 0);
  assert.equal(local.globalTimeout, 0);
  assert.equal(local.workers, null);
});

test('hosted browser acceptance runs each Playwright project in its own job against the packaged client', () => {
  const build = verify.jobs['client-artifact'];
  const job = verify.jobs.browser;
  const config = playwrightConfig(true);
  assert.deepEqual(config.projects, ['chromium', 'firefox', 'webkit']);
  assert.equal(job.needs, 'client-artifact');
  assert.equal(job.if, undefined);
  assert.deepEqual(job.strategy, { 'fail-fast': false, matrix: { project: config.projects } });
  // Observed before the split (Nov 2026): 3-5 minutes of build and standalone
  // work, and at most 10 minutes of tests for the slowest single project.
  // On 18 November 2026 the runners' Ubuntu mirror served WebKit's system
  // packages at about 84 kB/s, so installing them took up to 30 minutes. The
  // install step has its own limit, and the job leaves Playwright its full
  // global timeout after it: Playwright must stop and write its report before
  // GitHub cancels the job.
  assert.equal(build['timeout-minutes'], 55);
  assert.equal(job['timeout-minutes'], 60);
  const browserInstall = stepsOf(job).find(step => step.run === 'pnpm exec playwright install --with-deps "$PROJECT"');
  assert.equal(browserInstall['timeout-minutes'], 35);
  assert.ok(browserInstall['timeout-minutes'] * 60_000 + config.globalTimeout <= (job['timeout-minutes'] - 5) * 60_000);

  const steps = stepsOf(job);
  const find = predicate => steps.findIndex(predicate);
  const install = find(step => step.run === 'pnpm install --frozen-lockfile');
  const browser = find(step => step.run === 'pnpm exec playwright install --with-deps "$PROJECT"');
  const client = find(step => step.uses?.startsWith('actions/download-artifact@') && step.with.path === 'verified-client');
  const reports = find(step => step.uses?.startsWith('actions/download-artifact@') && step.with.path === 'node_modules/.cache/threatcaddy');
  const serve = find(step => step.name === 'Serve exactly the packaged client bytes');
  const hosted = find(step => step.run === 'pnpm test:e2e --project="$PROJECT"');
  const evidence = find(step => step.name === 'Preserve browser evidence');
  assert.ok(install >= 0 && browser > install && client > install && reports > install);
  assert.ok(serve > client && hosted > serve && hosted > browser && hosted > reports && evidence > hosted);
  assert.equal(downloads(job).length, 2);
  assert.deepEqual(steps[browser].env, { PROJECT: expression('matrix.project') });
  assert.deepEqual(steps[client].with, {
    'artifact-ids': expression('needs.client-artifact.outputs.artifact-id'),
    path: 'verified-client', 'merge-multiple': true, 'digest-mismatch': 'error',
  });
  assert.deepEqual(steps[reports].with, {
    'artifact-ids': expression('needs.client-artifact.outputs.reports-artifact-id'),
    path: 'node_modules/.cache/threatcaddy', 'merge-multiple': true, 'digest-mismatch': 'error',
  });
  assert.deepEqual(steps[hosted].env, { PLAYWRIGHT_SKIP_BUILD: '1', PROJECT: expression('matrix.project') });
  for (const index of [install, browser, client, reports, serve, hosted]) {
    assert.equal(steps[index].if, undefined);
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.equal(steps[evidence].if, 'always()');
  assert.equal(steps[evidence].with.name, `browser-results-${expression('matrix.project')}-${expression('github.sha')}`);
  assert.equal(steps[evidence].with['retention-days'], 14);
  assert.doesNotMatch(commands(job), /pnpm build|vite build/);

  // The browser jobs test the same immutable artifact that the gate promotes.
  assert.equal(build.outputs['artifact-id'], expression('steps.upload.outputs.artifact-id'));
  assert.equal(verify.jobs.gate.steps[0].env.CLIENT_ARTIFACT_ID, expression('needs.client-artifact.outputs.artifact-id'));
  assert.ok(verify.jobs.gate.needs.includes('client-artifact') && verify.jobs.gate.needs.includes('browser'));
  assert.doesNotMatch(commands(build), /pnpm test:e2e/);
  // Every hosted build report that a browser spec reads travels with the job.
  const buildSteps = stepsOf(build);
  const copied = buildSteps.findIndex(step => step.name === 'Keep the hosted build reports for browser acceptance');
  const kept = buildSteps.findIndex(step => step.id === 'reports');
  assert.ok(copied > buildSteps.findIndex(step => step.run === 'pnpm build') && kept > copied);
  const specs = readdirSync(new URL('e2e/', root)).filter(name => name.endsWith('.ts')).map(name => read(`e2e/${name}`)).join('\n');
  const reportNames = new Set([...specs.matchAll(/node_modules\/\.cache\/threatcaddy\/([\w.-]+\.json)/g)].map(match => match[1]));
  assert.deepEqual([...reportNames].sort(), ['dependency-provenance-hosted.json', 'startup-budget.json']);
  for (const name of reportNames) assert.match(buildSteps[copied].run, new RegExp(`node_modules/\\.cache/threatcaddy/${name.replaceAll('.', '\\.')}\\b`));
  assert.match(buildSteps[copied].run, /client-build-reports\/$/m);
  assert.equal(build.outputs['reports-artifact-id'], expression('steps.reports.outputs.artifact-id'));
  assert.deepEqual(buildSteps[kept].with, {
    name: `client-build-reports-${expression('github.sha')}`, path: 'client-build-reports/', 'if-no-files-found': 'error', 'retention-days': 90,
  });
});

test('the client job installs, with system libraries, the browser of every standalone project it runs', () => {
  const steps = stepsOf(verify.jobs['client-artifact']);
  const installs = steps.map((step, index) => [step, index]).filter(([step]) => step.run?.startsWith('pnpm exec playwright install'));
  const standalone = steps.findIndex(step => step.run === 'pnpm exec playwright test --config playwright.standalone.config.ts');
  assert.equal(installs.length, 1);
  assert.ok(installs[0][1] < standalone, 'every standalone project runs, after the install');
  const args = installs[0][0].run.trim().split(/\s+/).slice(4);
  assert.deepEqual(args.filter(arg => arg.startsWith('-')), ['--with-deps']);
  // A bare install would also fetch Firefox, which the standalone suite never runs.
  const installed = args.filter(arg => !arg.startsWith('-'));
  const browsers = playwrightConfig(true).standaloneBrowsers;
  assert.ok(installed.length > 0 && browsers.length > 0);
  for (const browser of browsers) assert.ok(installed.includes(browser), `client-artifact must install ${browser}`);
});

test('promoted client and server artifacts outlive release preparation and later re-verification', () => {
  for (const [job, name] of [['client-artifact', 'verified-client-'], ['server-artifact', 'verified-server-']]) {
    const upload = stepsOf(verify.jobs[job]).find(step => step.id === 'upload');
    assert.equal(upload.with.name, name + expression('github.sha'));
    assert.equal(upload.with['if-no-files-found'], 'error');
    // GitHub's maximum retention for this public repository.
    assert.equal(upload.with['retention-days'], 90);
  }
});

test('required client checks validate every locale without report-only or narrowed coverage', () => {
  const localeSteps = stepsOf(verify.jobs['client-checks']).filter(step => step.run === 'pnpm locales:check');
  assert.equal(localeSteps.length, 1);
  assert.equal(localeSteps[0].if, undefined);
  assert.equal(localeSteps[0]['continue-on-error'], undefined);
  assert.equal(verify.jobs['client-checks']['continue-on-error'], undefined);
  assert.equal(JSON.parse(read('package.json')).scripts['locales:check'], 'node scripts/check-locales.mjs');
  assert.ok(verify.jobs.gate.needs.includes('client-checks'));
});

test('every browser system-package install has its own limit and leaves its job its working time', () => {
  // The runners' Ubuntu mirror served Playwright's system packages at about
  // 84 kB/s on 18 November 2026 (up to 30 minutes for WebKit). Each install step
  // stops itself at 35 minutes, and its job keeps at least the 20 minutes the
  // rest of its work had before.
  const installs = Object.entries(verify.jobs).flatMap(([name, job]) => stepsOf(job)
    .filter(step => /playwright install --with-deps/.test(step.run ?? ''))
    .map(step => ({ name, job, step })));
  assert.deepEqual(installs.map(item => item.name).sort(), ['browser', 'client-artifact', 'database']);
  for (const { name, job, step } of installs) {
    assert.equal(step['timeout-minutes'], 35, name);
    assert.ok(job['timeout-minutes'] - step['timeout-minutes'] >= 20, name);
  }
});

test('database verification installs locked root browser types before checking every integration fixture', () => {
  const job = verify.jobs.database;
  const steps = stepsOf(job);
  const setup = steps.findIndex(step => step.uses?.startsWith('pnpm/action-setup@'));
  const rootInstall = steps.findIndex(step => step.run === 'pnpm install --frozen-lockfile');
  const serverInstall = steps.findIndex(step => step.run === 'npm --prefix server ci');
  const build = steps.findIndex(step => step.run === 'npm --prefix server run build');
  const typecheck = steps.findIndex(step => step.run === 'npm --prefix server run test:integration:types');
  const runtime = steps.findIndex(step => step.run === 'npm --prefix server run test:integration');
  assert.ok(setup >= 0 && rootInstall > setup && typecheck > rootInstall);
  assert.ok(serverInstall >= 0 && build > serverInstall && typecheck > build && runtime > typecheck);
  for (const index of [setup, rootInstall, serverInstall, build, typecheck, runtime]) {
    assert.equal(steps[index].if, undefined);
    assert.equal(steps[index]['continue-on-error'], undefined);
    assert.equal(steps[index]['working-directory'], undefined);
  }
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.ok(verify.jobs.gate.needs.includes('database'));
  const config = JSON.parse(read('server/tsconfig.integration.json'));
  assert.ok(config.include.includes('integration/**/*.ts'));
  assert.deepEqual(config.exclude, ['node_modules', 'dist']);
  assert.ok(JSON.parse(read('package.json')).devDependencies['@playwright/test']);
});

test('resource failures block the server gate while preserving measurement evidence', t => {
  const job = verify.jobs['server-checks'];
  const step = stepsOf(job).find(candidate => candidate.run?.includes('test:resource'));
  assert.ok(step, 'server verification must run the isolated resource regressions');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.shell, 'bash');
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.ok(verify.jobs.gate.needs.includes('server-checks'));
  const evidence = stepsOf(job).find(candidate => candidate.uses?.startsWith('actions/upload-artifact@')
    && candidate.with.path === 'validation-resource-results.jsonl');
  assert.ok(evidence, 'resource measurements must be retained after a failure');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with['retention-days'], 14);

  // Execute the actual CI command with a failing synthetic npm process. This
  // proves tee cannot turn a failed resource check into successful publication.
  const folder = temporaryDirectory(t);
  writeFileSync(join(folder, 'npm'), '#!/bin/sh\nprintf \'%s\\n\' \'{"fixture":"resource-failure"}\'\nexit 42\n', { mode: 0o700 });
  assert.throws(() => execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd: folder, env: { PATH: `${folder}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 42);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, evidence.with.path), 'utf8')), { fixture: 'resource-failure' });
});

test('npm audit and install jobs select the manifest-pinned npm first', () => {
  const npmPin = JSON.parse(read('server/package.json')).packageManager;
  assert.equal(npmPin, JSON.parse(read('extension/package.json')).packageManager);
  assert.match(npmPin, /^npm@\d+\.\d+\.\d+$/);
  for (const name of ['audit', 'server-checks', 'database', 'extension']) {
    const steps = stepsOf(verify.jobs[name]);
    const selection = steps.findIndex(step => step.run === `npm install --global ${npmPin}`);
    const usage = steps.findIndex(step => /npm --prefix .* (?:ci|audit)\b/.test(step.run ?? ''));
    assert.ok(selection >= 0 && usage > selection, `${name} must select npm before using a project lockfile`);
    assert.equal(steps[selection]['continue-on-error'], undefined);
    assert.equal(steps[selection].if, name === 'audit' ? "matrix.project != 'root'" : undefined);
  }
});

test('dependency audits keep full high-severity coverage; only the reviewed-exception check can pass a failing audit', t => {
  const steps = stepsOf(verify.jobs.audit);
  const step = steps.find(candidate => candidate.name === 'Audit the complete lockfile (high and critical block publication)');
  assert.ok(step);
  assert.equal(step.shell, 'bash');
  assert.deepEqual(step.env, { PROJECT: expression('matrix.project') });
  assert.equal(step.if, undefined);
  assert.match(step.run, /^set -euo pipefail$/m);
  assert.match(step.run, /^ *pnpm audit --audit-level=high --json > dependency-audit\.json \|\| status=\$\?$/m);
  assert.match(step.run, /^ *npm --prefix "\$PROJECT" audit --audit-level=high --json > dependency-audit\.json \|\| status=\$\?$/m);
  assert.match(step.run, /^node scripts\/ci-dependency-audit\.mjs "\$PROJECT" dependency-audit\.json "\$status"$/m);
  assert.doesNotMatch(step.run, /--omit|--prod\b|\s-P\b|--ignore|--only|--audit-level=(?!high\b)|\|\| true|continue-on-error|npmrc/);
  const evidence = steps.find(candidate => candidate.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'dependency-audit.json');
  // pnpm's own ignore settings drop an advisory before the check can test its conditions;
  // a pnpmfile's updateConfig hook can set them, and environment settings (npm or pnpm
  // settings, or NODE_ENV=production for npm) can narrow the audit.
  const workspace = load(read('pnpm-workspace.yaml'));
  for (const key of ['auditConfig', 'pnpmfile', 'globalPnpmfile', 'configDependencies']) assert.equal(workspace[key], undefined, key);
  assert.equal(existsSync(new URL('.pnpmfile.cjs', root)), false);
  assert.equal(JSON.parse(read('package.json')).pnpm, undefined);
  for (const env of [verify.env, verify.jobs.audit.env]) {
    assert.deepEqual(Object.keys(env ?? {}).filter(name => /^(?:p?npm_config_|NODE_ENV$)/i.test(name)), []);
  }
  for (const path of ['.npmrc', 'server/.npmrc', 'extension/.npmrc']) {
    if (existsSync(new URL(path, root))) assert.doesNotMatch(read(path), /audit|omit|production|only|pnpmfile/i);
  }

  // Run the actual step: one package-manager call, without npm or pnpm settings or NODE_ENV in its
  // environment; the unfiltered output and exit status reach the check, whose result is the step's.
  for (const project of verify.jobs.audit.strategy.matrix.project) {
    for (const [auditStatus, checkStatus] of [[1, 0], [0, 0], [1, 1], [0, 1], [7, 1]]) {
      const folder = temporaryDirectory(t);
      for (const tool of ['pnpm', 'npm']) {
        writeFileSync(join(folder, tool), `#!/bin/sh\nprintf '%s\\n' "${tool} $*" >> audit-command.txt\nenv >> audit-environment.txt\nprintf '{"fixture":"audit"}\\n'\nexit ${auditStatus}\n`, { mode: 0o700 });
      }
      mkdirSync(join(folder, 'scripts'));
      writeFileSync(join(folder, 'scripts/ci-dependency-audit.mjs'), `import { readFileSync, writeFileSync } from 'node:fs';
writeFileSync('check.json', JSON.stringify({ args: process.argv.slice(2), report: readFileSync(process.argv[3], 'utf8') }));
process.exit(${checkStatus});
`);
      let status = 0;
      try {
        execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
          cwd: folder, env: { PATH: `${folder}:${dirname(process.execPath)}:${process.env.PATH}`, PROJECT: project }, stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) { status = error.status; }
      assert.equal(status, checkStatus, `${project}: audit ${auditStatus}, check ${checkStatus}`);
      assert.equal(readFileSync(join(folder, 'audit-command.txt'), 'utf8').trim(),
        project === 'root' ? 'pnpm audit --audit-level=high --json' : `npm --prefix ${project} audit --audit-level=high --json`);
      assert.doesNotMatch(readFileSync(join(folder, 'audit-environment.txt'), 'utf8'), /^(?:p?npm_config_|NODE_ENV=)/im, project);
      assert.deepEqual(JSON.parse(readFileSync(join(folder, 'check.json'), 'utf8')),
        { args: [project, 'dependency-audit.json', String(auditStatus)], report: '{"fixture":"audit"}\n' });
    }
  }
});

test('the full runtime-image audit gates promotion after packaged-image acceptance and preserves failures', () => {
  const job = verify.jobs['server-artifact'];
  const steps = stepsOf(job);
  const acceptance = steps.findIndex(step => step.run === 'node scripts/ci-verify-server-image.mjs');
  const packaged = steps.findIndex(step => step.name === 'Package tested image with source identity and digest');
  const audit = steps.findIndex(step => step.name === 'Audit the exact packaged runtime image');
  const evidence = steps.findIndex(step => step.name === 'Preserve runtime image audit evidence');
  const promoted = steps.findIndex(step => step.id === 'upload');
  assert.ok(acceptance >= 0 && packaged > acceptance && audit > packaged && evidence > audit && promoted > evidence);
  for (const index of [acceptance, packaged, audit, promoted]) {
    assert.equal(steps[index].if, undefined);
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.equal(job['continue-on-error'], undefined);
  assert.ok(verify.jobs.gate.needs.includes('server-artifact'));
  assert.equal(steps[evidence].if, 'always()');
  assert.equal(steps[evidence].with.path, 'server-image-audit/');
  const command = steps[audit].run;
  assert.match(command, /trivy_0\.76\.2_Linux-64bit\.tar\.gz/);
  assert.match(command, /bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf/);
  assert.ok(command.indexOf('sha256sum --check') < command.indexOf('tar -xzf'));
  assert.match(command, /mktemp -d "\$RUNNER_TEMP\/threatcaddy-trivy\./);
  assert.match(command, /--disable-telemetry/);
  // Trivy tries the repositories in order and moves on after a temporary
  // registry error (rate limit, 5xx), so one registry outage cannot block publication.
  assert.match(command, /--db-repository ghcr\.io\/aquasecurity\/trivy-db:2 --db-repository mirror\.gcr\.io\/aquasec\/trivy-db:2 \\\n\s+--offline-scan --skip-check-update --skip-version-check/);
  assert.match(command, /--pkg-types os,library --list-all-pkgs/);
  assert.match(command, /--severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --ignorefile '' --ignore-unfixed=false/);
  assert.match(command, /--input verified-server\/server-image\.tar/);
  assert.match(command, /node scripts\/ci-audit-server-image\.mjs/);
  assert.ok(command.indexOf('cp "$trivy_root/cache/db/metadata.json" server-image-audit/database-metadata.json')
    < command.indexOf('node scripts/ci-audit-server-image.mjs'));
  assert.match(command, /server\/package\.json \\\n\s+server-image-audit\/database-metadata\.json > server-image-audit\/policy\.json/);
  assert.ok(command.indexOf('passed === true') > command.indexOf('> server-image-audit/policy.json'));
  assert.doesNotMatch(command, /continue-on-error|\|\| true|--skip-db-update|--ignore-unfixed(?:\s|$)/);
});

test('the image audit step fails unless the written policy records passed:true', t => {
  const step = stepsOf(verify.jobs['server-artifact']).find(step => step.name === 'Audit the exact packaged runtime image');
  for (const [policy, expected] of [['', 1], ['{"passed": false}', 1], ['{"passed": true}', 0]]) {
    const folder = temporaryDirectory(t);
    writeFileSync(join(folder, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(folder, 'sha256sum'), '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(folder, 'tar'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-C' ]; then shift; destination="$1"; break; fi
  shift
done
cat > "$destination/trivy" <<'SCANNER'
#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--cache-dir' ]; then shift; mkdir -p "$1/db"; printf '{"UpdatedAt":"2026-11-15T12:50:00Z"}' > "$1/db/metadata.json"; fi
  shift
done
printf '{"SchemaVersion":2}' > server-image-audit/report.json
SCANNER
chmod 700 "$destination/trivy"
`, { mode: 0o700 });
    // A stand-in for the audit CLI that silently writes this policy and exits 0.
    mkdirSync(join(folder, 'scripts'));
    writeFileSync(join(folder, 'scripts/ci-audit-server-image.mjs'), `process.stdout.write(${JSON.stringify(policy)});\n`);
    let status = 0;
    try {
      execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
        cwd: folder, env: { PATH: `${folder}:${process.env.PATH}`, RUNNER_TEMP: folder, GITHUB_SHA: 'b'.repeat(40) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { status = error.status; }
    assert.equal(status, expected, `policy ${JSON.stringify(policy)}`);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, 'server-image-audit/database-metadata.json'), 'utf8')), { UpdatedAt: '2026-11-15T12:50:00Z' });
  }
});

test('scanner checksum failure stops before extraction and execution', t => {
  const folder = temporaryDirectory(t);
  const step = stepsOf(verify.jobs['server-artifact']).find(step => step.name === 'Audit the exact packaged runtime image');
  writeFileSync(join(folder, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(join(folder, 'sha256sum'), '#!/bin/sh\ncat >/dev/null\nexit 42\n', { mode: 0o700 });
  writeFileSync(join(folder, 'tar'), '#!/bin/sh\necho unsafe-extraction >&2\nexit 99\n', { mode: 0o700 });
  assert.throws(() => execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd: folder, env: { PATH: `${folder}:${process.env.PATH}`, RUNNER_TEMP: folder }, stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 42 && !String(error.stderr).includes('unsafe-extraction'));
  assert.match(readFileSync(join(folder, 'server-image-audit/scanner-sha256.txt'), 'utf8'), /^bc0fc726/);
});

test('a scanner runtime failure blocks policy success while retaining its partial report and diagnostics', t => {
  const folder = temporaryDirectory(t);
  const step = stepsOf(verify.jobs['server-artifact']).find(step => step.name === 'Audit the exact packaged runtime image');
  writeFileSync(join(folder, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(join(folder, 'sha256sum'), '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o700 });
  writeFileSync(join(folder, 'tar'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-C' ]; then shift; destination="$1"; break; fi
  shift
done
cat > "$destination/trivy" <<'SCANNER'
#!/bin/sh
printf '{"SchemaVersion":2}' > server-image-audit/report.json
printf 'ERROR synthetic scan failure\\n' >&2
exit 17
SCANNER
chmod 700 "$destination/trivy"
`, { mode: 0o700 });
  assert.throws(() => execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd: folder, env: { PATH: `${folder}:${process.env.PATH}`, RUNNER_TEMP: folder }, stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 17);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, 'server-image-audit/report.json'), 'utf8')), { SchemaVersion: 2 });
  assert.match(readFileSync(join(folder, 'server-image-audit/scanner.log'), 'utf8'), /ERROR synthetic scan failure/);
});

test('extension verification checks committed downloads without rewriting or extracting them', () => {
  const step = stepsOf(verify.jobs.extension).find(candidate => candidate.name === 'Build extension and verify committed packages');
  assert.ok(step);
  assert.equal(step['working-directory'], 'extension');
  assert.match(step.run, /npm run build/);
  assert.match(step.run, /node \.\.\/scripts\/verify-extension-packages\.mjs --check/);
  assert.doesNotMatch(step.run, /--write|package:(?:chrome|firefox)|unzip\s+-[a-z]*[ox]/);
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.ok(verify.jobs.gate.needs.includes('extension'));
});

test('only CI automatically verifies main pushes; PR, schedule and manual CI stay available', () => {
  const automatic = Object.entries(workflows).filter(([, workflow]) => Object.hasOwn(workflow.on, 'push'));
  assert.deepEqual(automatic.map(([name]) => name), ['ci.yml']);
  assert.deepEqual(ci.on.push, { branches: ['main'] });
  assert.deepEqual(ci.on.pull_request, { branches: ['main'] });
  assert.ok(Object.hasOwn(ci.on, 'workflow_dispatch'));
  assert.ok(ci.on.schedule.length > 0);
  assert.equal(ci.name, 'CI');
  assert.deepEqual(ci.jobs.verify, { uses: './.github/workflows/verify.yml' });
  for (const workflow of Object.values(workflows)) {
    assert.equal(Object.hasOwn(workflow.on, 'workflow_run'), false);
    assert.equal(Object.hasOwn(workflow.on, 'pull_request_target'), false);
  }
});

test('automatic publishers require main push; server additionally requires the literal true output', () => {
  assert.equal(ci.jobs['publish-pages'].if, mainPush);
  assert.equal(ci.jobs['publish-server'].if, `${mainPush} && needs.verify.outputs.server-publish-required == 'true'`);
  assert.deepEqual(Object.keys(ci.jobs).sort(), ['publish-pages', 'publish-server', 'verify']);
  for (const publisher of [pages, server]) {
    assert.deepEqual(Object.keys(publisher.on), ['workflow_call']);
    assert.equal(publisher.jobs.publish.if, mainRelease);
  }
});

test('manual deployment entry points still verify once before using the same guarded publishers', () => {
  for (const [manual, publisher, artifact] of [
    [manualPages, 'publish-pages', 'client-artifact-id'],
    [manualServer, 'publish-server', 'server-artifact-id'],
  ]) {
    assert.deepEqual(Object.keys(manual.on), ['workflow_dispatch']);
    assert.deepEqual(Object.keys(manual.jobs), ['verify', 'publish']);
    assert.equal(manual.jobs.verify.uses, './.github/workflows/verify.yml');
    assert.equal(manual.jobs.verify.if, "github.ref == 'refs/heads/main'");
    assert.equal(manual.jobs.publish.if, "github.ref == 'refs/heads/main'");
    assert.equal(manual.jobs.publish.needs, 'verify');
    assert.equal(manual.jobs.publish.uses, `./.github/workflows/${publisher}.yml`);
    assert.equal(manual.jobs.publish.with[artifact], expression(`needs.verify.outputs.${artifact}`));
  }
  assert.equal(JSON.parse(read('package.json')).scripts.deploy, 'gh workflow run deploy.yml --ref main');
});

test('publisher inputs are required typed strings fed solely by this run verification outputs', () => {
  for (const [publisher, workflow, artifact, callers] of [
    ['publish-pages', pages, 'client-artifact-id', [ci.jobs['publish-pages'], manualPages.jobs.publish]],
    ['publish-server', server, 'server-artifact-id', [ci.jobs['publish-server'], manualServer.jobs.publish]],
  ]) {
    assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs).sort(), [artifact, 'source-sha'].sort());
    for (const input of Object.values(workflow.on.workflow_call.inputs)) {
      assert.equal(input.required, true);
      assert.equal(input.type, 'string');
      assert.equal(input.default, undefined);
    }
    for (const caller of callers) {
      assert.equal(caller.needs, 'verify');
      assert.equal(caller.uses, `./.github/workflows/${publisher}.yml`);
      assert.deepEqual(caller.with, {
        'source-sha': expression('needs.verify.outputs.source-sha'),
        [artifact]: expression(`needs.verify.outputs.${artifact}`),
      });
    }
  }
});

test('write permissions are confined to guarded publisher jobs; verification and smoke are read-only', () => {
  for (const workflow of Object.values(workflows)) assert.deepEqual(workflow.permissions, minimumRead);
  for (const job of Object.values(verify.jobs)) assert.equal(job.permissions, undefined);
  for (const caller of [ci.jobs['publish-pages'], manualPages.jobs.publish]) assert.deepEqual(caller.permissions, pagesCallerPermission);
  for (const caller of [ci.jobs['publish-server'], manualServer.jobs.publish]) assert.deepEqual(caller.permissions, serverPermission);
  assert.deepEqual(pages.jobs.publish.permissions, pagesPermission);
  assert.deepEqual(server.jobs.publish.permissions, serverPermission);
  assert.deepEqual(pages.jobs.smoke.permissions, { contents: 'read', actions: 'read' });
  for (const workflow of Object.values(workflows)) {
    assert.equal(workflow.on.workflow_call?.secrets, undefined);
    for (const job of Object.values(workflow.jobs)) assert.equal(job.secrets, undefined);
  }
});

test('CI cancellation is PR-only and event-isolated; publisher locks cover entire release workflows', () => {
  assert.deepEqual(ci.concurrency, {
    group: 'ci-${{ github.event_name }}-${{ github.ref }}',
    'cancel-in-progress': expression("github.event_name == 'pull_request'"),
  });
  assert.deepEqual(pages.concurrency, { group: 'deploy-github-pages', 'cancel-in-progress': false });
  assert.deepEqual(server.concurrency, { group: 'deploy-server', 'cancel-in-progress': false });
  // Caller locks must never deadlock the reusable workflow, or let the smoke
  // run outside the Pages publication lock while another release replaces bytes.
  for (const caller of [manualPages, manualServer]) assert.equal(caller.concurrency, undefined);
  for (const workflow of [ci, manualPages, manualServer, pages, server]) {
    for (const job of Object.values(workflow.jobs)) assert.equal(job.concurrency, undefined);
  }
  assert.equal(pages.jobs.smoke.needs, 'publish');
});

test('every artifact consumer uses immutable same-run IDs and rejects mismatched download digests', () => {
  for (const [job, artifact, path] of [
    [pages.jobs.publish, 'client-artifact-id', 'verified-client'],
    [pages.jobs.smoke, 'client-artifact-id', 'verified-client'],
    [server.jobs.publish, 'server-artifact-id', 'verified-server'],
  ]) {
    assert.equal(downloads(job).length, 1);
    assert.deepEqual(downloads(job)[0].with, {
      'artifact-ids': expression(`inputs.${artifact}`), path, 'merge-multiple': true, 'digest-mismatch': 'error',
    });
  }
  assert.equal(downloads(pages.jobs.publish)[0].with['artifact-ids'], downloads(pages.jobs.smoke)[0].with['artifact-ids']);
});

test('privileged jobs preserve source, checksum, latest-main and platform gates without running application code', () => {
  for (const [workflow, artifact] of [[pages, 'client-artifact-id'], [server, 'server-artifact-id']]) {
    const job = workflow.jobs.publish;
    const run = commands(job);
    assert.deepEqual(job.steps[0].env, {
      VERIFIED_SHA: expression('inputs.source-sha'), ARTIFACT_ID: expression(`inputs.${artifact}`),
    });
    assert.match(run, /test "\$VERIFIED_SHA" = "\$GITHUB_SHA"/);
    assert.match(run, /cat (?:verified-client\/)?source-sha\.txt/);
    assert.match(run, /sha256sum --check (?:client|server-image)\.tar\.sha256/);
    assert.match(run, /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
    assert.match(run, /test "\$main_sha" = "\$GITHUB_SHA" \|\| .*exit 1;/);
    assert.equal(job.steps.some(step => step.uses?.startsWith('actions/checkout@')), false);
    assert.doesNotMatch(run, /(?:pnpm|npm|yarn|bun) (?:install|ci|run|build)|docker build/);
    assert.equal(job['continue-on-error'], undefined);
  }
  assert.match(commands(pages.jobs.publish), /test "\$pages_source" = workflow/);
  assert.equal(pages.jobs.publish.environment.name, 'github-pages');
  const stage = pages.jobs.publish.steps.find(step => step.uses?.startsWith('actions/upload-pages-artifact@'));
  const deploy = pages.jobs.publish.steps.find(step => step.uses?.startsWith('actions/deploy-pages@'));
  assert.equal(stage.with.name, deploy.with.artifact_name);
  assert.equal(stage.with.path, 'verified-client/site');
  assert.equal(stage.with['include-hidden-files'], true);
  const serverRun = commands(server.jobs.publish);
  assert.match(serverRun, /docker load --input server-image\.tar/);
  assert.match(serverRun, /test .*docker image inspect threatcaddy-server:verify.* = "\$image_id"/);
  assert.match(serverRun, /org\.opencontainers\.image\.revision.* = "\$GITHUB_SHA"/);
  assert.match(serverRun, /trap 'docker logout ghcr\.io' EXIT/);
  assert.match(serverRun, /docker push "\$image:sha-\$GITHUB_SHA"/);
  assert.match(serverRun, /docker push "\$image:latest"/);
  assert.match(serverRun, /docker push "\$image:\$version"/);
  // The version is read from the verified image's files; nothing in the image runs.
  assert.doesNotMatch(serverRun, /docker (?:run|start|exec)\b/);
});

// Runs the real publish step with stand-in docker and gh commands, against a
// registry where the version tag is absent, already present or unreadable.
function runServerPublish(t, { version = '2.0.4', registry = 'absent' } = {}) {
  const folder = temporaryDirectory(t);
  const sha = 'c'.repeat(40);
  const imageId = `sha256:${'d'.repeat(64)}`;
  const verified = join(folder, 'verified-server');
  const packaged = join(folder, 'image-files');
  mkdirSync(verified);
  mkdirSync(packaged);
  writeFileSync(join(verified, 'source-sha.txt'), `${sha}\n`);
  writeFileSync(join(verified, 'server-image.id'), imageId);
  writeFileSync(join(verified, 'server-image.tar'), '');
  writeFileSync(join(verified, 'server-image.tar.sha256'), '');
  writeFileSync(join(packaged, 'package.json'), JSON.stringify(version === null ? { name: 'threatcaddy-server' } : { name: 'threatcaddy-server', version }));
  const tools = join(folder, 'bin');
  mkdirSync(tools);
  writeFileSync(join(tools, 'sha256sum'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(join(tools, 'gh'), `#!/bin/sh\nprintf '%s\\n' '${sha}'\n`, { mode: 0o700 });
  writeFileSync(join(tools, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "${join(folder, 'docker-calls.txt')}"
case "$1 $2" in
  'image inspect') case "$*" in *'.Id'*) printf '%s\\n' '${imageId}' ;; *revision*) printf '%s\\n' '${sha}' ;; esac ;;
  'create ${imageId}') printf '%s\\n' fixture-container ;;
  'cp fixture-container:/app/package.json') tar -cf - -C '${packaged}' package.json ;;
  'manifest inspect')
    case "$3" in
      *:sha-*|*:latest) printf '{"fixture":"pushed"}\\n' ;;
      *) case '${registry}' in
           present) printf '{"fixture":"first build"}\\n' ;;
           absent) printf 'no such manifest: %s\\n' "$3" >&2; exit 1 ;;
           *) printf 'unauthorized: synthetic registry failure\\n' >&2; exit 1 ;;
         esac ;;
    esac ;;
  'login '*) cat > /dev/null ;;
esac
exit 0
`, { mode: 0o700 });
  const step = server.jobs.publish.steps.find(candidate => candidate.name === 'Verify and push the already tested image');
  let status = 0;
  let output = '';
  try {
    output = execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
      cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: `${tools}:${process.env.PATH}`, GITHUB_SHA: sha, VERIFIED_SHA: sha, GITHUB_REPOSITORY: 'Owner/ThreatCaddy', GITHUB_ACTOR: 'fixture-actor', GH_TOKEN: 'fixture-token' },
    });
  } catch (error) { status = error.status; output = `${error.stdout}${error.stderr}`; }
  const calls = readFileSync(join(folder, 'docker-calls.txt'), 'utf8').trim().split('\n');
  return { status, output, calls, sha, image: 'ghcr.io/owner/threatcaddy/server' };
}

test('server publication adds a version tag for the first verified build of each release version', t => {
  const { status, calls, sha, image } = runServerPublish(t);
  assert.equal(status, 0);
  const pushes = calls.filter(call => call.startsWith('push '));
  assert.deepEqual(pushes, [`push ${image}:sha-${sha}`, `push ${image}:latest`, `push ${image}:2.0.4`]);
  // The same verified image ID receives every tag, after the version tag was checked.
  assert.deepEqual(calls.filter(call => call.startsWith('tag ')).map(call => call.split(' ')[1]), Array(3).fill(`sha256:${'d'.repeat(64)}`));
  assert.ok(calls.indexOf(`manifest inspect ${image}:2.0.4`) < calls.indexOf(pushes[0]));
  assert.ok(calls.includes('rm fixture-container'));
});

test('server publication never moves an existing version tag to a later build', t => {
  const { status, output, calls, sha, image } = runServerPublish(t, { registry: 'present' });
  assert.equal(status, 0);
  assert.deepEqual(calls.filter(call => call.startsWith('push ')), [`push ${image}:sha-${sha}`, `push ${image}:latest`]);
  assert.match(output, /::notice::.*2\.0\.4 already exists/);
});

test('server publication pushes nothing when the version tag cannot be checked or the version is not a release', t => {
  for (const [options, before] of [[{ registry: 'error' }, 'logout ghcr.io'], [{ version: '2.0.4-rc.1' }, 'rm fixture-container'], [{ version: null }, 'rm fixture-container']]) {
    const { status, calls } = runServerPublish(t, options);
    assert.notEqual(status, 0, JSON.stringify(options));
    assert.deepEqual(calls.filter(call => /^(?:tag|push) /.test(call)), [], JSON.stringify(options));
    assert.ok(calls.includes(before), JSON.stringify(options));
    // An unusable version stops before signing in to the registry.
    if ('version' in options) assert.ok(!calls.some(call => call.startsWith('login ')), JSON.stringify(options));
  }
});

test('Pages smoke preserves exact source, same artifact, production URL and synthetic evidence', () => {
  const smoke = pages.jobs.smoke;
  assert.equal(smoke.if, pages.jobs.publish.if);
  assert.equal(smoke.steps[0].run, 'test "$VERIFIED_SHA" = "$GITHUB_SHA"');
  assert.equal(smoke.steps[0].env.VERIFIED_SHA, expression('inputs.source-sha'));
  const checkout = smoke.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, expression('github.sha'));
  assert.equal(checkout.with['persist-credentials'], false);
  const check = smoke.steps.find(step => step.run?.startsWith('pnpm test:release '));
  assert.deepEqual(check.env, {
    RELEASE_URL: expression('needs.publish.outputs.page-url'), VERIFIED_SHA: expression('inputs.source-sha'),
  });
  assert.equal(check.run, 'pnpm test:release --url "$RELEASE_URL" --source-sha "$VERIFIED_SHA" --artifact-dir verified-client');
  assert.equal(pages.jobs.publish.outputs['page-url'], expression('steps.deployment.outputs.page_url'));
  assert.doesNotMatch(commands(smoke), /pnpm build|tar -xf/);
  const evidence = smoke.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'test-results/release-smoke/');
  assert.equal(evidence.with['retention-days'], 7);
  assert.match(commands(smoke), /post-deployment verification failed.*publication was not rolled back/);
});

test('verification keeps every required check and tests both Node-owned contracts in the gated client job', () => {
  assert.deepEqual(Object.keys(verify.jobs).sort(), [
    'audit', 'client-checks', 'client-artifact', 'browser', 'server-checks', 'database', 'server-artifact', 'extension', 'gate',
  ].sort());
  assert.deepEqual(verify.jobs.gate.needs, [
    'audit', 'client-checks', 'client-artifact', 'browser', 'server-checks', 'database', 'server-artifact', 'extension',
  ]);
  assert.equal(verify.jobs.gate.name, 'Publication gate');
  assert.equal(verify.jobs.gate.if, 'always()');
  assert.equal(verify.jobs['client-checks'].name, 'Client lint and unit tests');
  assert.deepEqual(verify.jobs.audit.strategy.matrix.project, ['root', 'server', 'extension']);
  for (const job of Object.values(verify.jobs)) {
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  }
  const client = verify.jobs['client-checks'];
  assert.equal(client.steps[0].with['fetch-depth'], 0);
  assert.equal(client.steps[0].with['persist-credentials'], false);
  assert.match(commands(client), /pnpm test:ci/);
  assert.match(commands(client), /pnpm test:release:unit/);
  assert.match(commands(client), /pnpm test:run/);
  assert.equal(client.steps.find(step => step.id === 'release-scope').run, 'node scripts/ci-release-scope.mjs');
  assert.equal(client.outputs['server-publish-required'], expression('steps.release-scope.outputs.server-publish-required'));
  const outputs = ['source-sha', 'client-artifact-id', 'server-artifact-id', 'server-publish-required'];
  assert.deepEqual(Object.keys(verify.on.workflow_call.outputs), outputs);
  for (const output of outputs) {
    assert.equal(verify.on.workflow_call.outputs[output].value, expression(`jobs.gate.outputs.${output}`));
    assert.equal(verify.jobs.gate.outputs[output], expression(`steps.verified.outputs.${output}`));
  }
  assert.equal(verify.jobs.gate.steps[0].env.SERVER_PUBLISH_REQUIRED, expression('needs.client-checks.outputs.server-publish-required'));
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['test:ci'], 'node --test scripts/ci-*.test.mjs');
  assert.equal(scripts['test:release:unit'], 'node --test scripts/release-contract.test.mjs');
});

test('every external action is pinned; reusable workflows use the caller revision and verification pins checkout SHA', () => {
  for (const workflow of Object.values(workflows)) {
    for (const job of Object.values(workflow.jobs)) {
      if (job.uses) assert.match(job.uses, /^\.\/\.github\/workflows\/[\w-]+\.yml$/);
      for (const step of stepsOf(job)) {
        if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      }
    }
  }
  for (const [name, job] of Object.entries(verify.jobs)) {
    if (name === 'gate') continue;
    assert.equal(job.steps[0].with.ref, expression('github.sha'));
    assert.equal(job.steps[0].with['persist-credentials'], false);
  }
});

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'threatcaddy-workflow-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('actual browser jobs serve only a packaged client whose source and checksum match', t => {
  const step = stepsOf(verify.jobs.browser).find(candidate => candidate.name === 'Serve exactly the packaged client bytes');
  assert.ok(step);
  const source = 'a'.repeat(40);
  const prepare = ({ sha = source, tamper = false } = {}) => {
    const folder = temporaryDirectory(t);
    mkdirSync(join(folder, 'packaged'));
    writeFileSync(join(folder, 'packaged/index.html'), '<!doctype html><title>tested bytes</title>');
    mkdirSync(join(folder, 'verified-client'));
    execFileSync('tar', ['-cf', 'verified-client/client.tar', '-C', 'packaged', '.'], { cwd: folder });
    writeFileSync(join(folder, 'verified-client/client.tar.sha256'),
      execFileSync('sha256sum', ['client.tar'], { cwd: join(folder, 'verified-client'), encoding: 'utf8' }));
    writeFileSync(join(folder, 'verified-client/source-sha.txt'), `${sha}\n`);
    if (tamper) appendFileSync(join(folder, 'verified-client/client.tar'), 'substituted');
    return folder;
  };
  const run = folder => execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd: folder, env: { PATH: process.env.PATH, GITHUB_SHA: source }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const verified = prepare();
  run(verified);
  assert.equal(readFileSync(join(verified, 'dist/index.html'), 'utf8'), '<!doctype html><title>tested bytes</title>');
  for (const options of [{ tamper: true }, { sha: 'b'.repeat(40) }]) {
    const folder = prepare(options);
    assert.throws(() => run(folder));
    assert.equal(existsSync(join(folder, 'dist')), false);
  }
});

test('actual publisher input guards reject missing, malformed and mismatched identities before downloading', () => {
  const source = 'a'.repeat(40);
  for (const publisher of [pages, server]) {
    const run = (sourceSHA, artifactID) => execFileSync('bash', ['-c', publisher.jobs.publish.steps[0].run], {
      env: { PATH: process.env.PATH, GITHUB_SHA: source, VERIFIED_SHA: sourceSHA, ARTIFACT_ID: artifactID },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    run(source, '1234');
    for (const [sha, id] of [[source, ''], [source, '0'], [source, '1,2'], [source, 'latest'],
      ['', '1234'], ['b'.repeat(40), '1234'], ['A'.repeat(40), '1234'], [source + '\n', '1234']]) {
      assert.throws(() => run(sha, id));
    }
  }
});

test('actual publication gate requires all successes, both artifact IDs and an explicit scope output', t => {
  const output = join(temporaryDirectory(t), 'output');
  const heredoc = verify.jobs.gate.steps[0].run.match(/node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/);
  assert.ok(heredoc, 'publication gate remains directly executable for contract tests');
  const results = Object.fromEntries(verify.jobs.gate.needs.map(name => [name, { result: 'success' }]));
  const env = { PATH: process.env.PATH, RESULTS: JSON.stringify(results), GITHUB_OUTPUT: output,
    GITHUB_SHA: 'a'.repeat(40), CLIENT_ARTIFACT_ID: '1234', SERVER_ARTIFACT_ID: '5678', SERVER_PUBLISH_REQUIRED: 'true' };
  const run = overrides => execFileSync(process.execPath, ['--input-type=module', '--eval', heredoc[1]], {
    env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  run();
  assert.equal(readFileSync(output, 'utf8'), `source-sha=${env.GITHUB_SHA}\nclient-artifact-id=1234\nserver-artifact-id=5678\nserver-publish-required=true\n`);
  run({ SERVER_PUBLISH_REQUIRED: 'false' });
  for (const job of verify.jobs.gate.needs) {
    for (const result of ['failure', 'cancelled', 'skipped', 'abandoned']) {
      assert.throws(() => run({ RESULTS: JSON.stringify({ ...results, [job]: { result } }) }), /Publication blocked/);
    }
  }
  for (const override of [{ CLIENT_ARTIFACT_ID: '' }, { SERVER_ARTIFACT_ID: '' }, { SERVER_PUBLISH_REQUIRED: '' },
    { SERVER_PUBLISH_REQUIRED: 'TRUE' }, { SERVER_PUBLISH_REQUIRED: 'false\nsource-sha=other' }]) {
    assert.throws(() => run(override), /Publication blocked/);
  }
});
