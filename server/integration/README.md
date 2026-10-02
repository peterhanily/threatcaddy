# PostgreSQL migration and packaged-startup verification

This suite deliberately uses **real PostgreSQL** and committed migration SQL. Historical fixtures use the installed Drizzle migrator; current upgrades use the production recovery runner, with Drizzle's SQL parser and hash format. It does not use schema push to replace migrations, ORM mocks, a production database, or application `.env` files. Failing migrations and startup checks fail the command; there are no expected-failure or skip allowances.

Requirements: Node and the server dependencies, PostgreSQL 17, and a local disposable database named `threatcaddy_test` (or `threatcaddy_test_<suffix>`). Its role must have `CREATEDB`. Supply its URL explicitly:

```sh
npm --prefix server run build
TEST_DATABASE_URL=postgres://test_role:test_password@127.0.0.1:55432/threatcaddy_test npm --prefix server run test:integration
```

The URL must use a loopback host and contain no query options or fragments. The supplied database only coordinates allocation: each test creates a random `tc_it_<pid>_<random>` database from `template0`, verifies its identity, and drops only that database in cleanup. Separate databases are necessary because the original migrations explicitly reference `public`. No schema or table is dropped in the coordinator database. Do not give this role access to application databases. If the test process is forcibly killed, a disposable test PostgreSQL instance may retain a `tc_it_*` database; discard that test instance instead of running broad database cleanup against another server.

The original SQL and journal under `fixtures/historical-migrations` were frozen from the reviewed baseline. **Do not update them when repairing production migrations.** The suite recreates a fresh installation and databases originally migrated through `0002`, `0017`, and `0019`. Historical fixtures run through the actual migrator in one first-install transaction, retaining the original backwards timestamps. Fixture users, investigation ownership and note content/revisions/timestamps must survive upgrade. Each history is also checked through compiled startup and restart.

The production runner verifies applied hashes and timestamps as an exact journal prefix, then runs missing SQL in journal order under a transaction-held advisory lock. This recovers the backwards timestamps without changing historical SQL, renumbering journal entries, or silently skipping migrations. Concurrent startups, unknown history, partial schema adoption and changed defaults have explicit integration cases. A schema-push installation may adopt only the reviewed `0020_runtime_schema_completion` baseline; subsequent migrations always run, including the durable sync log's data backfill. See [migration recovery](../docs/migration-recovery.md).

A separate schema-push fixture uses the installed Drizzle Kit's schema serializer and SQL generator to materialize the exported runtime tables without a migration journal. This is an existing-installation fixture, never a replacement for the migration tests. It first proves that the catalog comparator accepts the intended schema, then requires migration adoption and compiled startup to preserve the fixture's data. No CLI configuration, remote package download, or interactive `db:push` command is involved.

Rollback tests append a temporary forward migration that creates a marker table and then raises an ordinary SQL division-by-zero error. They require complete transaction rollback, unchanged history and investigation data, and a successful single application after repairing the temporary fault. The compiled-startup retry test injects this fault only into already packaged migration assets; missing assets fail that test instead of being filled in from source. Production migration files and historical fixtures are never modified by these tests.

The schema comparison reads PostgreSQL catalogs and the runtime Drizzle table definitions. It checks table/column presence in both directions, column types/nullability/default presence, primary and unique keys, declared foreign-key targets/actions, and declared index columns/method/uniqueness/validity. Additional operational indexes are allowed. It does not yet compare default expression values, extra foreign keys, check constraints, or index operator classes; add explicit checks when those contracts are introduced. Expression/partial indexes require an explicit comparator and fail instead of silently passing.

The production adoption validator additionally checks default expressions,
foreign-key target schemas and unexpected foreign keys, and the explicit sync
clock/operation check constraints. Rejection fixtures exercise changed defaults,
an undeclared cascading foreign key and an incompatible singleton check; the
integration catalog comparator above remains an independent implementation.

The startup check stages only `dist`, `package.json` and a link to installed dependencies in a temporary directory. It does not copy SQL from `src`; the build must package its own migration assets. A child process receives generated test keys (kept stable across restarts) and an allowlisted environment, and its Docker socket points to a nonexistent temporary path. The test requires current HTTP/database/storage health, completed runtime initialization, a second healthy response after a stability period, a unique fixture identity from server information, an accurate package version, and successful restart. Missing build output or migrations is a failure. CI must additionally verify the container artifact it publishes, because its dependency installation and packaging differ.

For diagnostics:

```sh
npm --prefix server run test:integration:types
TEST_DATABASE_URL=postgres://test_role:test_password@127.0.0.1:55432/threatcaddy_test npm --prefix server run test:integration -- --reporter=verbose
```

The historical fixtures retain the reviewed missing-schema and backwards-timestamp defects. Passing requires the current runner and ordinary build output to repair those cases while preserving data. Do not weaken the assertions, regenerate historical fixtures, or mark a failing migration/startup case as passing.
