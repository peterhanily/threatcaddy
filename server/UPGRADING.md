# Upgrading ThreatCaddy Server

ThreatCaddy server is designed for seamless upgrades. Database migrations run automatically on startup — no manual steps required.

## How Upgrades Work

1. **Pull the latest code** or Docker image
2. **Restart the server** — migrations apply automatically before routes are served
3. **Verify** via the health endpoint

That's it. No manual migration commands needed.

## Upgrade Steps

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

The server container will restart, run pending migrations, and resume serving.

### Manual / Source

```bash
git pull
cd server
npm install
npm run build
npm start    # Migrations run automatically on startup
```

### Verify

```bash
curl http://localhost:3001/health
```

Response includes the current version:

```json
{
  "status": "ok",
  "db": "connected",
  "storage": "accessible",
  "version": "1.1.0",
  "uptime": 42
}
```

## Migration Safety

- All migrations use `IF NOT EXISTS` / `IF EXISTS` guards — safe to re-run
- Migrations are tracked in a journal — already-applied migrations are skipped
- Migrations run inside a transaction — if one fails, the server exits cleanly without partial state
- The server will not serve traffic until all migrations have completed

## Rollback

If an upgrade introduces issues:

1. **Stop the server** — `docker compose down` or kill the process
2. **Check logs** — migration failures are logged with full details
3. **Restore from backup** — if data was affected, restore PostgreSQL from backup
4. **Downgrade** — check out the previous git tag or Docker image and restart

Index-only migrations (like 0019) are backward-compatible — the previous server version will work fine with the new indexes present.

## Environment Variables

New in v1.1.0:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_MAX` | `50` | Maximum PostgreSQL connection pool size |

## Version History

| Version | Migration | Changes |
|---------|-----------|---------|
| 1.1.0 | 0018-0019 | Refresh token reuse detection, composite filter indexes, security hardening |
| 1.0.0 | 0000-0017 | Initial release |
