# Historical database fixtures

`historical-migrations/` is a verbatim copy of `server/src/db/migrations/*.sql` and `meta/_journal.json` at ThreatCaddy commit `e91d4175143cd3f9a83417ead46cd5744277745e`, captured on 7 September 2026.

These original SQL files and timestamps are intentional historical evidence. They recreate installations predating a migration repair. Update current production migrations separately; do not rewrite these fixtures to make upgrade tests pass. `applyHistoricalMigrations` selects a prefix of this journal and uses the installed Drizzle migrator to apply that prefix to an empty scratch database.

Cases through `0002`, `0017`, and `0019` cover the high timestamp already recorded before later migrations, a later partial installation, and a fully applied old installation. The companion fixture rows represent an owned investigation and a versioned note with content, tags, relationships, and timestamps that must survive an upgrade.
