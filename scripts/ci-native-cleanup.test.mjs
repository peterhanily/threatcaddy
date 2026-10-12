import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanupNativeFixtures } from './lib/native-fixture-cleanup.mjs';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';

test('native cleanup closes only acquired handles when setup is incomplete', async () => {
  const calls = [];
  const result = await cleanupNativeFixtures({
    app: { close: async () => calls.push('app') },
    proxy: { close: async () => calls.push('proxy') },
  });
  assert.deepEqual(calls, ['app', 'proxy']);
  assert.deepEqual(result, { errors: [], failures: [] });
  assert.deepEqual(await cleanupNativeFixtures({}), { errors: [], failures: [] });
});

test('native cleanup attempts every handle after a browser close failure', async () => {
  const calls = [];
  const failure = new Error('Synthetic browser close failure');
  const handles = Object.fromEntries(['runtime', 'app', 'unavailable', 'proxy'].map(resource => [resource, {
    close: async () => { calls.push(resource); if (resource === 'runtime') throw failure; },
  }]));
  const result = await cleanupNativeFixtures(handles);
  assert.deepEqual(calls, ['runtime', 'app', 'unavailable', 'proxy']);
  assert.deepEqual(result.errors, [failure]);
  assert.deepEqual(result.failures, [{ resource: 'runtime', error: failure.stack }]);
  assert.throws(() => throwIfFailed(undefined, result.errors), error => error === failure);
});

test('native cleanup retains primary and all secondary failures in order', async () => {
  const primary = new Error('Synthetic suite failure');
  const browser = new Error('Synthetic browser failure');
  const proxy = new Error('Synthetic proxy failure');
  const result = await cleanupNativeFixtures({
    runtime: { close: async () => { throw browser; } },
    proxy: { close: async () => { throw proxy; } },
  });
  assert.deepEqual(result.errors, [browser, proxy]);
  assert.deepEqual(result.failures.map(failure => failure.resource), ['runtime', 'proxy']);
  assert.throws(() => throwIfFailed({ error: primary }, result.errors), error => error instanceof AggregateError
    && error.cause === primary && error.errors[0] === primary
    && error.errors[1] === browser && error.errors[2] === proxy);
});

test('native runtime guards setup and reports cleanup failure before persisting status', () => {
  const source = readFileSync(new URL('./verify-clip-delivery-runtime.mjs', import.meta.url), 'utf8');
  const runtime = source.slice(source.indexOf('export async function withClipRuntime'));
  assert.match(runtime, /try \{\s+proxy = await deniedEgress\(\);\s+app = await appOrigin\(\)/);
  assert.match(runtime, /cleanupNativeFixtures\(\{ runtime, app, unavailable, proxy \}\)/);
  assert.match(runtime, /result\.status = operationFailure \|\| cleanupErrors\.length > 0 \? 'failed' : 'passed'/);
  assert.ok(runtime.indexOf('result.status = operationFailure') < runtime.indexOf('await writeFile('));
  assert.match(runtime, /throwIfFailed\(operationFailure, cleanupErrors/);
});
