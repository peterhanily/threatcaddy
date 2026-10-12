import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupImageFixtures } from './lib/docker-fixture-cleanup.mjs';
import { throwIfFailed } from './lib/cleanup-outcome.mjs';

test('image cleanup attempts only created fixture IDs in dependency order', () => {
  const calls = [];
  assert.deepEqual(cleanupImageFixtures(command => calls.push(command), { container: 'app-fixture', postgres: 'pg-fixture', network: 'network-fixture' }), []);
  assert.deepEqual(calls, [['rm', '--force', 'app-fixture'], ['rm', '--force', 'pg-fixture'], ['network', 'rm', 'network-fixture']]);
  assert.deepEqual(cleanupImageFixtures(() => assert.fail('no fixture exists'), {}), []);
});

test('cleanup failures cannot hide a lifecycle failure or skip later fixture cleanup', () => {
  const primary = new Error('Synthetic lifecycle failure');
  const cleanup = new Error('Synthetic removal failure');
  const calls = [];
  const errors = cleanupImageFixtures(command => {
    calls.push(command);
    if (command[2] === 'app-fixture') throw cleanup;
  }, { container: 'app-fixture', postgres: 'pg-fixture', network: 'network-fixture' });
  assert.equal(calls.length, 3);
  assert.deepEqual(errors, [cleanup]);
  assert.throws(() => throwIfFailed(undefined, errors), error => error === cleanup);
  assert.throws(() => throwIfFailed({ error: primary }, errors), error => error instanceof AggregateError
    && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup);
});
