import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

// AutoRemove can begin after inspect succeeds but before our explicit removal.
// Only that exact, owned-container conflict permits waiting; success still
// requires Docker to confirm the captured container ID no longer exists.
export async function cleanupDockerodeFixture(container, label, {
  timeoutMs = 5_000,
  pollIntervalMs = 100,
  now = () => performance.now(),
  sleep = setTimeout,
} = {}) {
  assert.match(container.id, /^[a-f0-9]{64}$/);
  assert.equal(typeof label, 'string');
  assert.ok(label.length > 0);
  const deadline = now() + timeoutMs;
  let removalRequested = false;
  let removalConflict;
  while (true) {
    let details;
    try {
      details = await container.inspect();
    } catch (error) {
      if (error.statusCode === 404) return;
      throw error;
    }
    assert.equal(details.Id, container.id, 'Docker fixture identity changed');
    assert.equal(details.Config?.Labels?.['com.threatcaddy.acceptance'], label, 'Refusing to remove an unowned Docker fixture');
    if (!removalRequested) {
      removalRequested = true;
      try {
        await container.remove({ force: true });
      } catch (error) {
        if (error.statusCode === 409
          && error.json?.message === `removal of container ${container.id} is already in progress`) {
          removalConflict = error;
        } else if (error.statusCode !== 404) {
          throw error;
        }
      }
      // Confirm removal even if DELETE returned success or raced to a 404.
      continue;
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(`Owned Docker fixture ${container.id} still exists after cleanup timeout`, { cause: removalConflict });
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}
