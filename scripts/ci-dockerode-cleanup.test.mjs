import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupDockerodeFixture } from './lib/dockerode-fixture-cleanup.mjs';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';

const id = 'a'.repeat(64);
const label = 'threatcaddy-dockerode-synthetic-fixture';
const owned = () => ({ Id: id, Config: { Labels: { 'com.threatcaddy.acceptance': label } } });
const missing = () => Object.assign(new Error('No such container'), { statusCode: 404 });
const removing = () => Object.assign(new Error('Removal in progress'), {
  statusCode: 409,
  json: { message: `removal of container ${id} is already in progress` },
});

function clock() {
  let elapsed = 0;
  const waits = [];
  return {
    waits,
    options: {
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => elapsed,
      sleep: async milliseconds => { waits.push(milliseconds); elapsed += milliseconds; },
    },
  };
}

test('an already removed captured fixture needs no mutation', async () => {
  await cleanupDockerodeFixture({ id, inspect: async () => { throw missing(); }, remove: () => assert.fail('already absent') }, label);
});

test('successful removal still requires a terminal inspect 404', async () => {
  const time = clock();
  let inspections = 0;
  let removals = 0;
  await cleanupDockerodeFixture({
    id,
    inspect: async () => { if (++inspections === 3) throw missing(); return owned(); },
    remove: async options => { assert.deepEqual(options, { force: true }); removals++; },
  }, label, time.options);
  assert.equal(inspections, 3);
  assert.equal(removals, 1);
  assert.deepEqual(time.waits, [10]);
});

test('the exact AutoRemove 409 waits for a terminal 404 without retrying removal', async () => {
  const time = clock();
  let inspections = 0;
  let removals = 0;
  await cleanupDockerodeFixture({
    id,
    inspect: async () => { if (++inspections === 4) throw missing(); return owned(); },
    remove: async () => { removals++; throw removing(); },
  }, label, time.options);
  assert.equal(inspections, 4);
  assert.equal(removals, 1);
  assert.deepEqual(time.waits, [10, 10]);
});

test('persistent AutoRemove conflict times out and retains the original cleanup error', async () => {
  const time = clock();
  const conflict = removing();
  const primary = new Error('Synthetic verification failure');
  let cleanupError;
  try {
    await cleanupDockerodeFixture({ id, inspect: async () => owned(), remove: async () => { throw conflict; } }, label, time.options);
  } catch (error) { cleanupError = error; }
  assert.match(cleanupError?.message ?? '', /still exists after cleanup timeout/);
  assert.equal(cleanupError.cause, conflict);
  assert.deepEqual(time.waits, [10, 10]);
  assert.throws(() => throwIfFailed({ error: primary }, [cleanupError]), error => error instanceof AggregateError
    && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanupError);
});

test('a foreign label or container identity never authorizes removal', async () => {
  for (const details of [
    { ...owned(), Config: { Labels: { 'com.threatcaddy.acceptance': 'some-other-run' } } },
    { ...owned(), Id: 'b'.repeat(64) },
  ]) {
    await assert.rejects(cleanupDockerodeFixture({
      id, inspect: async () => details, remove: () => assert.fail('foreign fixture cannot be removed'),
    }, label), /unowned Docker fixture|identity changed/);
  }
});

test('unrelated 409 errors and another container removal message are not retried', async () => {
  for (const message of ['container is running', `removal of container ${'b'.repeat(64)} is already in progress`]) {
    const time = clock();
    const conflict = Object.assign(new Error(message), { statusCode: 409, json: { message } });
    await assert.rejects(cleanupDockerodeFixture({
      id, inspect: async () => owned(), remove: async () => { throw conflict; },
    }, label, time.options), error => error === conflict);
    assert.deepEqual(time.waits, []);
  }
});

test('inspection failures during removal polling remain failures', async () => {
  const denied = Object.assign(new Error('Access denied'), { statusCode: 403 });
  let inspections = 0;
  await assert.rejects(cleanupDockerodeFixture({
    id,
    inspect: async () => { if (++inspections > 1) throw denied; return owned(); },
    remove: async () => { throw removing(); },
  }, label), error => error === denied);
});
