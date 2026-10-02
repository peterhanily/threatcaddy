import { describe, expect, it } from 'vitest';
import { testDatabaseUrl } from './database.js';

describe('integration database isolation configuration', () => {
  it('accepts only explicit loopback test coordinator URLs', () => {
    for (const value of [
      'postgres://test_role@127.0.0.1:55432/threatcaddy_test',
      'postgresql://test_role@localhost/threatcaddy_test_ci',
      'postgres://test_role@[::1]/threatcaddy_test_17',
    ]) expect(testDatabaseUrl(value).toString()).toBe(value);
  });

  it('refuses missing, remote, application, malformed, and option-overriding database targets before connecting', () => {
    for (const value of [
      undefined,
      '',
      'not a URL',
      'https://localhost/threatcaddy_test',
      'postgres://test_role@database.example.invalid/threatcaddy_test',
      'postgres://test_role@127.0.0.1/threatcaddy',
      'postgres://test_role@127.0.0.1/postgres',
      'postgres://test_role@127.0.0.1/threatcaddy_test?host=database.example.invalid',
      'postgres://test_role@127.0.0.1/threatcaddy_test#options',
      'postgres://test_role@127.0.0.1/threatcaddy_test%2Fapplication',
    ]) expect(() => testDatabaseUrl(value)).toThrow();
  });
});
