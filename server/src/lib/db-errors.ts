import { DrizzleQueryError } from 'drizzle-orm';

/**
 * SQLSTATE of a PostgreSQL error. drizzle wraps every driver error in a
 * DrizzleQueryError whose message is the SQL text plus all bound parameters;
 * the driver error, with its code, is the cause.
 */
export function sqlState(err: unknown): string | undefined {
  const driver: unknown = err instanceof DrizzleQueryError ? err.cause : err;
  const code = (driver as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return sqlState(err) === '23505';
}
