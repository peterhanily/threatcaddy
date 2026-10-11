import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('required client checks validate every locale without report-only or narrowed coverage', () => {
  const localeSteps = stepsOf(verify.jobs['client-checks']).filter(step => step.run === 'pnpm locales:check');
  assert.equal(localeSteps.length, 1);
  assert.equal(localeSteps[0].if, undefined);
  assert.equal(localeSteps[0]['continue-on-error'], undefined);
  assert.equal(verify.jobs['client-checks']['continue-on-error'], undefined);
  assert.equal(JSON.parse(read('package.json')).scripts['locales:check'], 'node scripts/check-locales.mjs');
  assert.ok(verify.jobs.gate.needs.includes('client-checks'));
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
});

test('Pages smoke preserves exact source, same artifact, production URL and synthetic evidence', () => {
  const smoke = pages.jobs.smoke;
  assert.equal(smoke.steps[0].with.ref, expression('inputs.source-sha'));
  assert.equal(smoke.steps[0].with['persist-credentials'], false);
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
    'audit', 'client-checks', 'client-artifact', 'server-checks', 'database', 'server-artifact', 'extension', 'gate',
  ].sort());
  assert.deepEqual(verify.jobs.gate.needs, [
    'audit', 'client-checks', 'client-artifact', 'server-checks', 'database', 'server-artifact', 'extension',
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
