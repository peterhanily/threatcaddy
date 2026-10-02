# Sync history and asset contract

This release requires coordinated client/server upgrade. Writes require the
UUID history generation returned by a durable cursor pull. Older clients that
omit it receive a validation error instead of writing against unknown history.
The client captures local changes transactionally and keeps rejected, conflicting,
oversized and unsupported work in its encrypted outbox.

## Restore procedure

1. Stop the application instance. Preserve and verify an independent database
   and managed-file backup before changing production data.
2. Restore the matching database and file backup, then run the packaged migration
   command using that installation's `DATABASE_URL`.
3. Before starting the server, run
   `npm run sync:rotate-history -- --confirm-restore` in the built server.
   This refuses a live application lease and changes only the history generation.
4. Restart and verify readiness. Clients with the previous generation pause;
   they must not clear IndexedDB, sync metadata or queued work to bypass this.
5. In the original account's workspace, use **Settings → General → Sync history
   recovery**. Pause agents and close other tabs. Download the verified encrypted
   recovery archive, save its password separately, then explicitly reconcile.
   All local records and pending deletions are retained. Revision zero forces
   conflicts for existing server entities; review each before choosing a side.

Restore tools must rotate the generation. A database copy includes its old UUID;
without this explicit step, a divergent restore with the same/higher cursor
cannot be detected reliably. Rotation is not an automatic restore detector.
Legacy clients without a verified history generation also require this recovery
flow. A workspace bound to another account cannot be rebound through recovery.

The recovery archive includes every current IndexedDB store, including queued
deletions and revision metadata. It excludes localStorage credentials. Restore
requires an empty workspace of the same schema version and leaves synchronization
and restored agent deployments paused. Keep the original archive unchanged.

## Evidence and whiteboard assets

Evidence records and serialized whiteboard files participate in revisions,
tombstones, snapshots and durable change capture. The current asset contract is
bounded inline data: evidence raster base64 up to 4,250,000 bytes, whiteboard
files JSON up to 8 MiB. The sync POST route alone allows 16 MiB; ordinary API
requests remain limited to 1 MiB. The client sends a large asset alone below
15 MiB; PostgreSQL bounds each cursor page to 16 MiB of stored JSON (or its first
record, to guarantee progress). Generic fields retain existing limits.

This is not a new original-file repository: evidence records preserve the source
metadata, extracted text and supported raster preview already stored locally.
Files not represented in those records still need the managed upload/backup path.
Large rejected records remain local with a visible error; they are not truncated
to acknowledge success. Assets remain duplicated in retained sync history;
monitor database storage. History is not pruned in this release.

The application is single-instance. Migration locks, commit-ordered cursors and
the process lease protect correctness; they are not a distributed queue or HA
deployment contract.
