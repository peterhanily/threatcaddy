# Upgrading ThreatCaddy Server

The upgrade, rollback and restore procedure is maintained in one place:
[deployment guide, section 6 (Upgrading)](../docs/deployment.md#6-upgrading).
Read it before changing a running server. It covers the standard upgrade,
registry and repository Compose installations, the administration binding
change in images published after 2.0.0, and [rollback and restore](../docs/deployment.md#rollback-and-restore).

Pulling images is not enough for the supplied Compose installation: its server
service builds `./server`, so pulling and restarting keeps running the
previously built image. Update the source, then run
`docker compose build server` and
`docker compose up -d --no-deps --force-recreate server`.

2.0.3 adds no database migrations and changes no server code apart from the
version that `/health` reports. Its changes are client-side AI hardening; see
the [2.0.3 notes](../docs/releases/v2.0.3.md). Upgrade team clients too:
members still on 2.0.2 do not have the client protections.

Reverting code or an image does not roll back database migrations. Restoring
data requires the matching database and file snapshot plus an explicit
sync-history rotation; see [migration recovery](docs/migration-recovery.md) and
[sync history recovery](docs/sync-recovery.md).
