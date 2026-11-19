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

2.0.4 adds no database migrations, but changes server defaults that can need
action before you recreate the server: the supplied Compose file publishes the
API on host loopback only, `TRUSTED_PROXY_IPS` should name the Compose
network's gateway when a proxy on the host forwards to it, `/health` returns
only `status` and `version`, the application code in the image is read-only to
the runtime user, the generated `.admin-secret` file is deleted once an
administrator exists, and the sandbox images are pinned by digest. See the
[2.0.4 upgrade notes](../docs/releases/v2.0.4.md#upgrade). Upgrade team clients
too.

Reverting code or an image does not roll back database migrations. Restoring
data requires the matching database and file snapshot plus an explicit
sync-history rotation; see [migration recovery](docs/migration-recovery.md) and
[sync history recovery](docs/sync-recovery.md).
