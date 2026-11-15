import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { describeError } from '../lib/db-errors.js';

const SECRET = 'row-content-that-must-not-reach-logs';

function failedQuery(cause?: Error) {
  return new DrizzleQueryError('insert into "notes" ("id", "content") values ($1, $2)', ['note-1', SECRET], cause);
}

describe('describeError', () => {
  it('names a failed query by SQLSTATE and driver message, never its SQL or parameters', () => {
    const error = failedQuery(Object.assign(new Error('value too long for type character varying(255)'), { name: 'PostgresError', code: '22001' }));
    expect(String(error)).toContain(SECRET);
    expect(describeError(error)).toBe('DrizzleQueryError 22001: value too long for type character varying(255)');
    expect(describeError(failedQuery())).toBe('DrizzleQueryError: query failed');
  });

  it('keeps other errors as String(err), capped at 1 KB', () => {
    expect(describeError(new Error('boom'))).toBe('Error: boom');
    expect(describeError('plain reason')).toBe('plain reason');
    const long = describeError(new Error(`start ${'x'.repeat(5_000)} tail`));
    expect(long.startsWith('Error: start x')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(1_025);
    expect(long).not.toContain('tail');
  });
});
