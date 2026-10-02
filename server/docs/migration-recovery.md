# Database migration recovery

The server runs `migrateDatabase` before opening HTTP listeners. `npm run build`
packages all journaled SQL alongside the compiled server; the container uses
that same build. To migrate separately, build first, supply `DATABASE_URL`
explicitly, then run `npm run db:migrate`. No example database URL is substituted
by the migration command.

Take and verify an operator-managed PostgreSQL backup before upgrading a live
installation. The integration suite uses disposable local databases; it does
not demonstrate restoration of an operator's production backup.

Supported installation states:

- An empty database: apply the complete journal in order.
- An original migrated database, including releases through `0002`, `0017`,
  and `0019`: verify every applied hash/timestamp as an exact journal prefix,
  then execute its missing suffix. Original backwards timestamps and hashes
  remain unchanged; timestamp ordering cannot skip the suffix.
- An unjournaled schema-push database matching the reviewed runtime baseline:
  validate table/column types, nullability, defaults, keys, required indexes,
  declared foreign keys and sync check constraints, then record adoption through
  `0020_runtime_schema_completion`. The pre-cursor baseline without either sync
  table is also supported. Adoption is recorded separately in
  `drizzle.threatcaddy_adoptions`. The historical reserved-system-user email
  normalization is applied explicitly. Later migrations execute normally,
  including sync backfill and triggers.

Migration recovery and schema adoption, SQL execution, and history writes share
one PostgreSQL transaction. A transaction-held advisory lock serializes parallel
application starts. A failure rolls everything back; after correcting the
underlying problem, retrying applies each pending migration once.

Unknown hashes, changed timestamps, missing history entries, partial unjournaled
schemas, incompatible defaults, orphaned membership foreign keys, and unsupported
column changes fail startup. Preserve the database and obtain the schema and
matching release history for operator review. Do not delete migration records,
rewrite old SQL/timestamps, force schema push, or drop investigation data to make
startup proceed. The application does not infer repairs for these states.

New migrations must append to the journal with a timestamp greater than all
existing entries. Do not extend the adoption baseline automatically: data
migrations after `0020` must execute even when their tables already exist in a
schema-push installation. Such migrations must deliberately handle that state.

Validation includes real PostgreSQL fresh/upgrade/adoption cases, rollback and
retry, concurrent starts, and boot/restart from a temporary directory containing
only ordinary build output, package metadata, and installed dependencies.
