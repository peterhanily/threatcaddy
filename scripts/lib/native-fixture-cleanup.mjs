// Only the handles created by the caller are eligible for cleanup. Attempt every
// owned handle even after a close failure, including partially completed setup.
export async function cleanupNativeFixtures(fixtures) {
  const errors = [];
  const failures = [];
  for (const resource of ['runtime', 'app', 'unavailable', 'proxy']) {
    const fixture = fixtures[resource];
    if (!fixture) continue;
    try { await fixture.close(); }
    catch (error) {
      errors.push(error);
      failures.push({ resource, error: error?.stack ?? String(error) });
    }
  }
  return { errors, failures };
}
