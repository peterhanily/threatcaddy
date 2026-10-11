/** Verification cleanup must never turn an earlier failure into success, or
 * hide it behind a second cleanup failure. Does not perform cleanup itself. */
export function throwIfFailed(operationFailure, cleanupFailures, message = 'Verification and cleanup did not complete successfully') {
  const errors = operationFailure ? [operationFailure.error, ...cleanupFailures] : [...cleanupFailures];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message, { cause: errors[0] });
}
