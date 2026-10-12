// Attempt every cleanup even when an earlier one fails. Targets are only the
// exact IDs returned when this acceptance run created its disposable fixtures.
export function cleanupImageFixtures(docker, { container, postgres, network }) {
  const failures = [];
  const commands = [
    ...(container ? [['rm', '--force', container]] : []),
    ...(postgres ? [['rm', '--force', postgres]] : []),
    ...(network ? [['network', 'rm', network]] : []),
  ];
  for (const command of commands) {
    try { docker(command); } catch (error) { failures.push(error); }
  }
  return failures;
}
