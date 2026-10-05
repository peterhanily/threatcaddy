# ThreatCaddy Deployment Guide

## Explicit browser connections and analytics

Default builds include no analytics beacon. To opt in, set the public site token
`VITE_CF_ANALYTICS_TOKEN` to your own 32-character Cloudflare Web Analytics token
when building. An upstream CDN may independently inject analytics; disable that
in its dashboard for private deployments. No dashboard setting is changed by
this repository. See [Cloudflare setup](https://developers.cloudflare.com/web-analytics/get-started/).

The browser content policy permits same-origin and local development endpoints
by default. For a separately hosted team server or agent host, set exact public
origins at build time, for example:

```sh
VITE_CONNECT_ORIGINS='https://team.example.test https://agent.example.test:8443' pnpm build
```

Corresponding WebSocket origins are included automatically. Wildcards,
credentials, paths, query strings, and fragments are rejected. The configured
server must still allow the app's origin through CORS; this setting grants no
server authorization. Browser login provides an actionable error when an origin
has not been included. Prefer same-origin deployment for the narrowest policy.

Regional S3 and OCI backup endpoints also require their exact origins in
`VITE_CONNECT_ORIGINS`. For example, configure
`https://backup.s3.eu-west-1.amazonaws.com` for your own bucket or
`https://objectstorage.eu-dublin-1.oraclecloud.com` for your region. Do not include
presigned URL paths or credentials in build configuration. Interior host
wildcards such as `*.s3.*.amazonaws.com` are invalid CSP syntax and are not
replaced with provider-wide permission. The hosted browser suite checks startup
and a lazy-loaded dialog for CSP diagnostics in Chromium, Firefox and WebKit.

## 1. Docker Deployment (Recommended)

### Prerequisites

- Docker Engine 24+ and Docker Compose v2
- A domain name with DNS pointing to your server (for HTTPS)
- An Ed25519 key pair for JWT signing
- A stable `BOT_MASTER_KEY` and a PostgreSQL password stored in protected deployment/recovery material
- Exactly one application server process per database; replicas and transaction-pooling proxies are not supported

Read the [runtime and storage contract](../server/docs/runtime-operations.md),
[credential recovery guide](../server/docs/credential-recovery.md), and
[migration recovery guide](../server/docs/migration-recovery.md) before upgrading
an existing installation. Client and server upgrades must be coordinated; see
[sync history recovery](../server/docs/sync-recovery.md).

### Generate JWT Keys

```bash
# Generate Ed25519 private key
openssl genpkey -algorithm Ed25519 -out private.pem

# Extract public key
openssl pkey -in private.pem -pubout -out public.pem

# Convert to single-line format for environment variables
# (replace newlines with literal \n)
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' public.pem
```

### Configure Environment

Create a `.env` file in the project root (same directory as `docker-compose.yml`):

```env
# Required
# Fill these from your deployment secret store; do not commit this file.
POSTGRES_PASSWORD=
BOT_MASTER_KEY=
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI...\n-----END PRIVATE KEY-----\n
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----\n
ALLOWED_ORIGINS=https://your-domain.com

# Optional
ADMIN_SECRET=your-secret-here
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
```

For a **new installation**, generate the master key with `openssl rand -hex 32`
and retain it securely. For an **upgrade**, preserve the exact existing key;
generating a replacement would make existing encrypted credentials unreadable.
Startup requires a valid explicit key even when no bots are enabled. Compose
supplies `DATABASE_URL` from `POSTGRES_PASSWORD`; non-Compose installations must
set `DATABASE_URL` explicitly as well.

### Start Services

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 17** on internal network (not exposed to host)
- **ThreatCaddy Server** on ports 3001 (API) and 3002 (admin panel)

### Verify

```bash
# Health check
curl http://localhost:3001/health

# Expected response:
# {"status":"ok","db":"connected","storage":"accessible","timestamp":"..."}
```

### Retrieve Admin Bootstrap Secret

If you did not set `ADMIN_SECRET` in `.env`, a random secret is generated on first launch:

```bash
# Read the auto-generated secret
docker compose exec server cat /data/files/.admin-secret

# Use this secret to create the first admin user at:
# http://localhost:3002/admin
```

**Important:** Delete the `.admin-secret` file after reading it, or set `ADMIN_SECRET` explicitly.

### Docker Compose Reference

```yaml
services:
  server:
    build: ./server
    ports:
      - "3001:3001"    # API + WebSocket
      - "3002:3002"    # Admin panel
    environment:
      DATABASE_URL: postgres://tc:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432/threatcaddy
      PORT: "3001"
      ADMIN_PORT: "3002"
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      FILE_STORAGE_PATH: /data/files
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:?Set ALLOWED_ORIGINS in .env (e.g. https://your-domain.com)}
      TRUST_PROXY: ${TRUST_PROXY:-0}
      TRUSTED_PROXY_IPS: ${TRUSTED_PROXY_IPS:-127.0.0.1,::1}
      STORAGE_QUOTA_PER_USER_BYTES: ${STORAGE_QUOTA_PER_USER_BYTES:-2147483648}
      STORAGE_QUOTA_TOTAL_BYTES: ${STORAGE_QUOTA_TOTAL_BYTES:-21474836480}
      ADMIN_SECRET: ${ADMIN_SECRET:-}
      BOT_MASTER_KEY: ${BOT_MASTER_KEY:?Set a stable BOT_MASTER_KEY and preserve it across restarts}
      WEBHOOK_INGEST_SECRET: ${WEBHOOK_INGEST_SECRET:-}
      WEBHOOK_INGEST_OWNER_ID: ${WEBHOOK_INGEST_OWNER_ID:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}
    volumes:
      - file-data:/data/files
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: tc
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: threatcaddy
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tc -d threatcaddy"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pg-data:
  file-data:
```

### Docker Image Details

The server Dockerfile (`server/Dockerfile`) uses a multi-stage build:

1. **Build stage**: the official `node:24.21.0-alpine` image pinned by digest in the Dockerfile, installs all dependencies and compiles TypeScript
2. **Runtime stage**: the same pinned Node 24.21.0 image, installs production dependencies only and copies compiled JS and migrations
3. Runs as non-root user `app`
4. Exposes ports 3001 and 3002

---

## 2. Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_PRIVATE_KEY` | Ed25519 private key in PEM format (single-line, `\n`-escaped) | `-----BEGIN PRIVATE KEY-----\nMC4C...` |
| `JWT_PUBLIC_KEY` | Corresponding Ed25519 public key in PEM format | `-----BEGIN PUBLIC KEY-----\nMCow...` |
| `BOT_MASTER_KEY` | Stable explicit credential-encryption key, 32–1024 characters with no surrounding whitespace. Required at startup; no JWT or ephemeral fallback. Preserve the exact existing value during upgrades. | New installations: generate 32 random bytes encoded as 64 hexadecimal characters |
| `DATABASE_URL` | Explicit PostgreSQL connection string; Compose supplies it from `POSTGRES_PASSWORD`. No production fallback. | Set through protected deployment configuration |
| `POSTGRES_PASSWORD` | Required by the supplied Compose file for the database and server connection. | Set through protected deployment configuration |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins. **Must be set in production.** | `https://your-domain.com` |

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_POOL_MAX` | Application PostgreSQL pool limit | `50` |
| `PORT` | API server port | `3001` |
| `ADMIN_PORT` | Admin panel port | `3002` |
| `FILE_STORAGE_PATH` | Directory for uploaded files and backups | `/data/files` |
| `STORAGE_QUOTA_PER_USER_BYTES` | Combined retained file/backup quota per user; positive integer bytes | `2147483648` (2 GiB) |
| `STORAGE_QUOTA_TOTAL_BYTES` | Combined retained file/backup quota across users; positive integer bytes | `21474836480` (20 GiB) |
| `TRUST_PROXY` | `true`/`1` enables forwarding from trusted peers only; `false`/`0` disables it | `0` |
| `TRUSTED_PROXY_IPS` | Comma-separated exact socket peer IPs allowed to supply forwarding headers; no hostnames or CIDRs | `127.0.0.1,::1` |
| `SERVER_NAME` | Display name for the server instance | Auto-generated (e.g., "Alpha Hub") |
| `ADMIN_SECRET` | Bootstrap secret for creating the first admin user. If not set, auto-generated on first launch and written to `${FILE_STORAGE_PATH}/.admin-secret`. | Auto-generated |

### LLM API Keys (Optional)

These enable server-side AI features (the extension can also provide LLM access client-side):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `MISTRAL_API_KEY` | Mistral AI API key |

### Optional Bot Runtime Settings

These settings do not make `BOT_MASTER_KEY` optional. Server-side AgentCaddy
handoff is unavailable: registration stores disabled metadata and does not start
execution. Ordinary administrator-configured bots are separate; review their
[outbound-operation requirements](../server/docs/bot-outbound-configuration.md)
and [webhook ownership requirements](../server/docs/credential-recovery.md#webhook-ownership-and-handoff-availability).

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_EXECUTION_TIMEOUT_MS` | Maximum bot execution time in milliseconds | `300000` (5 minutes) |
| `BOT_MAX_CONCURRENT_RUNS` | Maximum number of bots executing simultaneously | `10` |
| `SANDBOX_PYTHON_IMAGE` | Docker image for Python sandbox | `python:3.12-slim` |
| `SANDBOX_NODE_IMAGE` | Docker image for Node.js sandbox | `node:22-alpine` |
| `SANDBOX_BASH_IMAGE` | Docker image for Bash sandbox | `alpine:3.19` |

### Database Connection Pool

The application pool defaults to 50 connections and can be adjusted with
`DB_POOL_MAX`. Allow an additional dedicated connection for the runtime advisory
lease. Do not use a transaction-pooling proxy: the lease requires a stable
PostgreSQL session. Increasing the pool does not enable multiple server replicas.

---

## 3. Reverse Proxy Setup

The server should sit behind a reverse proxy for TLS termination, WebSocket support, and static file serving.

### Nginx

```nginx
# /etc/nginx/sites-available/threatcaddy
upstream threatcaddy_api {
    server 127.0.0.1:3001;
}

upstream threatcaddy_admin {
    server 127.0.0.1:3002;
}

# Main application (API + WebSocket)
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Security headers (server also sets these, but belt-and-suspenders)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Static SPA files (if hosting the frontend on the same domain)
    location / {
        root /var/www/threatcaddy/dist;
        try_files $uri $uri/ /index.html;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://threatcaddy_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # File upload limits
        client_max_body_size 101m; # Includes multipart overhead for 100 MiB backups
    }

    # WebSocket
    location /ws {
        proxy_pass http://threatcaddy_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Keep WebSocket connections alive
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Health check (no auth required)
    location /health {
        proxy_pass http://threatcaddy_api;
    }

    # Server info (no auth required)
    location /api/server/info {
        proxy_pass http://threatcaddy_api;
    }
}

# Admin panel (separate subdomain or port -- restrict access)
server {
    listen 443 ssl http2;
    server_name admin.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/admin.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.your-domain.com/privkey.pem;

    # Restrict to management network
    # allow 10.0.0.0/8;
    # deny all;

    location / {
        proxy_pass http://threatcaddy_admin;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name your-domain.com admin.your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy

```caddyfile
# Caddyfile
your-domain.com {
    # Static SPA files
    root * /var/www/threatcaddy/dist
    file_server

    # SPA fallback
    @notApi {
        not path /api/* /ws /health
    }
    handle @notApi {
        try_files {path} /index.html
    }

    # API
    handle /api/* {
        reverse_proxy localhost:3001
    }

    # WebSocket
    handle /ws {
        reverse_proxy localhost:3001
    }

    # Health check
    handle /health {
        reverse_proxy localhost:3001
    }
}

# Admin panel (restrict access as needed)
admin.your-domain.com {
    reverse_proxy localhost:3002
}
```

### Important Proxy Settings

When running behind a reverse proxy, set in your `.env`:

```env
TRUST_PROXY=1
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

Only connections from `TRUSTED_PROXY_IPS` may supply `X-Forwarded-For` (or `X-Real-IP` when absent). The server uses the nearest untrusted address in a valid IP chain. Other connections use their socket address. Set the actual proxy peer IPs for Docker/remote proxies; loopback defaults do not cover container bridge addresses. Your proxy must overwrite or correctly append forwarded addresses. Both variables are passed through by Compose. Without this configuration, requests share the proxy's rate limit.

---

## 4. Production Hardening

### 4.1 ALLOWED_ORIGINS

**Critical**: Always set `ALLOWED_ORIGINS` to your deployment's browser origins.
Compose requires it explicitly. Direct startup without it uses a built-in list
containing the hosted ThreatCaddy origin and development loopback origins, not
`*`; that list is not a substitute for your production configuration. An explicit
wildcard is accepted by the server but should not be used for a private deployment.

```env
# Single origin
ALLOWED_ORIGINS=https://your-domain.com

# Multiple origins (comma-separated)
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com
```

### 4.2 Database Credentials

The supplied Compose file requires `POSTGRES_PASSWORD`; it no longer supplies a
default password. Store it outside version control and keep the application
connection configuration consistent with the actual database role credentials.
Changing an environment value alone does not rotate the password of an existing
PostgreSQL role. For an existing volume, coordinate rotation with the database
administrator and retain a verified recovery path. Encode reserved URL characters
when supplying a password inside `DATABASE_URL`.

Do not expose the PostgreSQL port to the host; the supplied `db` service has no
`ports` mapping. Protect database and managed-file backups separately from the
deployment secrets needed to recover them.

### 4.3 Admin Panel Access

The admin panel should not be publicly accessible. Options:

1. **Firewall**: Only allow admin port (3002) from management IPs
2. **Separate domain with IP restriction** (see nginx example above)
3. **VPN-only access**: Put the admin panel behind a VPN
4. **Do not expose port 3002** in `docker-compose.yml`:
   ```yaml
   server:
     ports:
       - "3001:3001"
       # Remove: - "3002:3002"
   ```
   Access admin panel through SSH tunnel instead:
   ```bash
   ssh -L 3002:localhost:3002 your-server
   # Then open http://localhost:3002/admin
   ```

### 4.4 Bot Master Key

Every server environment must configure a stable `BOT_MASTER_KEY` before startup.
The accepted format is 32–1024 characters without surrounding whitespace; 64
random hexadecimal characters are recommended for new installations. There is
no fallback to `JWT_PRIVATE_KEY` or a newly generated in-memory key.

Preserve an existing valid key byte-for-byte, including across rebuilds and
restores. Do not replace a working legacy key merely to make it hexadecimal.
Runtime key changes are rejected. A lost key cannot be replaced by generating
another value to decrypt old ciphertext. Master-key rotation is a separate
offline, verified re-encryption operation; no rotation command is supplied.
Follow [credential recovery and exposure review](../server/docs/credential-recovery.md)
without putting keys or decrypted configuration into logs, issues, or support messages.

### 4.5 TLS

Always use HTTPS in production. The reverse proxy examples above handle TLS termination. For Let's Encrypt with Caddy, TLS is automatic.

### 4.6 Docker Socket Security (Bot Sandbox)

If using the bot sandbox (code execution), the server needs access to the Docker socket. In production:

1. Add Docker socket to the compose file:
   ```yaml
   server:
     volumes:
       - file-data:/data/files
       - /var/run/docker.sock:/var/run/docker.sock
   ```

2. Consider using a Docker socket proxy (like [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) to limit the server's Docker API access to only container creation and management.

3. Pre-pull sandbox images to avoid delays:
   ```bash
   docker pull python:3.12-slim
   docker pull node:22-alpine
   docker pull alpine:3.19
   ```

### 4.7 Rate Limiting

The server has built-in rate limiting for sensitive endpoints:

| Endpoint | Limit |
|----------|-------|
| `/api/auth/login` | 10/minute |
| `/api/auth/register` | 5/minute |
| `/api/auth/refresh` | 20/minute |
| `/api/llm/chat` | 20/minute |
| `/api/caddyshack/posts` | 30/minute |
| `/api/backups` | 5/minute |
| `/api/bots/*/webhook` | 30/minute |
| Admin API login | 5/minute |

WebSocket rate limits: 30 messages/second per connection, 50/second per user.

Body size limits:

- File uploads: 50 MiB, plus 1 MiB of multipart request allowance
- Backup uploads: 100 MiB, plus 1 MiB of multipart request allowance
- `POST /api/sync/push`: 16 MiB for the bounded inline evidence/whiteboard asset contract
- Other API requests: 1 MiB

File and backup quotas are shared and transaction-serialized. HTTP 507 reports
exhausted storage; zero does not disable quotas. Keep at least the required
filesystem headroom and monitor the volume independently of logical quotas.
Startup quarantines recognizable old unreferenced managed blobs rather than
deleting them; quarantine is not automatically purged. A database restore must
include its matching file snapshot **before** application startup. See the
[runtime and storage recovery procedures](../server/docs/runtime-operations.md).

### 4.8 Logging

The server outputs structured JSON logs to stdout (info/warn) and stderr (error):

```json
{"timestamp":"2026-03-07T12:00:00.000Z","level":"info","message":"Server running on http://localhost:3001","port":3001}
```

HTTP request logs are output via Hono's logger middleware with token redaction (JWT tokens in query params are replaced with `[REDACTED]`).

WebSocket connection stats are logged every 5 minutes:
```json
{"timestamp":"...","level":"info","message":"WebSocket stats","connections":5,"uniqueUsers":3,"pendingAuth":0}
```

---

## 5. Monitoring

### Health Check Endpoint

```
GET /health
```

Returns HTTP 200 with `{"status":"ok"}` when healthy, or HTTP 503 with `{"status":"degraded"}` when checks fail.

Checks performed:
- **Database connectivity**: `SELECT 1` query
- **File storage**: Filesystem access check on `FILE_STORAGE_PATH`

Example Docker Compose health check for the server:

```yaml
server:
  healthcheck:
    test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### What to Monitor

| Metric | How to Check | Alert Threshold |
|--------|-------------|-----------------|
| API health | `GET /health` | Status not `ok` |
| Database connections | PostgreSQL `pg_stat_activity` | Near the configured pool limit (default 50), plus the dedicated runtime-lease connection |
| Disk usage (files volume) | `du -sh /data/files` | > 80% of volume |
| Disk usage (PG volume) | `SELECT pg_database_size('threatcaddy')` | > 80% of volume |
| WebSocket connections | Server logs (every 5 min) | Unexpected drops |
| Bot errors | `bot_runs` table with `status = 'error'` | Repeated failures |
| Failed logins | `activity_log` where `action = 'login.failed'` | > 10/hour from same IP |
| Response latency | Reverse proxy access logs | p95 > 1s |
| Memory usage | Container stats | > 80% of limit |
| Certificate expiry | Certbot / Caddy auto-renewal | < 7 days |

### Log Aggregation

For production deployments, pipe Docker container logs to a log aggregation system:

```bash
# View server logs
docker compose logs -f server

# With timestamps
docker compose logs -f --timestamps server

# Export to file
docker compose logs server > server-logs-$(date +%Y%m%d).log
```

For ELK/Loki integration, the JSON log format is already structured and ready for parsing.

---

## 6. Upgrading

### Publication Is Not Server Rollout

The [server publication workflow](../.github/workflows/deploy-server.yml) runs the
required verification for the selected `main` commit, then promotes the already
tested image to GHCR as `ghcr.io/<owner>/<repo>/server:sha-<commit>` and `:latest`.
It checks source identity and artifact integrity; it does not SSH into a host,
restart a live container, migrate a deployed database, or change deployment
secrets. Operators must select and roll out the image themselves, preferably by
verified immutable digest rather than a moving `latest` tag.

The [client Pages workflow](../.github/workflows/deploy.yml) separately publishes
the verified client artifact. It does not coordinate a live server upgrade.
Plan the client/server release and maintenance window together: this protocol
requires writes to carry the history-generation UUID returned by a durable
cursor pull. Older clients that omit it cannot upload changes. Do not bypass
this check or clear local work to make an old client appear compatible.

### Standard Upgrade

1. Select a reviewed, compatible client/server release and prepare its artifacts.
   Preserve the exact master key and other required deployment secrets through
   protected recovery channels. Notify users, let them save work, and pause agents.
2. Stop the application server and prevent another instance from starting. Keep
   PostgreSQL available for operator-managed backup and migration commands. Take
   and verify a consistent database backup together with its managed-file snapshot.
3. Build the selected server source, or select the verified published image in
   your Compose configuration. With the application stopped, the packaged
   migration command can be run explicitly before starting listeners:

   ```bash
   # Run only after selecting the release and verifying the paired backups.
   # Skip the build when using an already verified published image.
   docker compose build server
   docker compose run --rm --no-deps server npm run db:migrate
   docker compose up -d server
   ```

4. Verify `/health`, initialization logs, and the matching client release before
   resuming normal use. Keep previous artifacts and recovery material until the
   upgrade is verified. Reload updated clients after their drafts have saved.

Startup also runs the packaged `migrateDatabase` routine before opening either
HTTP listener. It validates applied journal hashes/timestamps, applies the
missing suffix in journal order, and checks the resulting schema and durable
sync objects. Supported unjournaled installations require exact baseline
validation; arbitrary schema adoption is not supported. Migration and history
changes are transactional and advisory-locked. A mismatch or partial schema
fails startup rather than guessing a repair.

For a non-container build, run `npm run build`, supply the installation's
`DATABASE_URL` explicitly, and use `npm run db:migrate` from the server package.
Do not use schema push, delete migration rows, rewrite historical SQL, or drop
data to bypass a failure. Follow [migration recovery](../server/docs/migration-recovery.md).

### Rollback and Restore

Reverting code or an image does not roll back database migrations. Do not run an
older server against a newer schema without an explicitly supported compatibility
path. If rollback requires restoring data:

1. Stop the application and all writers. Preserve and verify an independent copy
   of the current database, managed files, and protected recovery material before
   replacing anything.
2. Restore the **matching database and managed-file snapshot**. Restore the exact
   key needed for that data. Do not start the server between database and file
   restoration; startup storage reconciliation must see a consistent pair.
3. Using the selected recovery-compatible server build and its `DATABASE_URL`,
   run the packaged migration command while the application remains stopped.
   Then explicitly rotate the restored sync history before accepting clients:

   ```bash
   docker compose run --rm --no-deps server npm run db:migrate
   docker compose run --rm --no-deps server npm run sync:rotate-history -- --confirm-restore
   ```

   Outside Compose, use `npm run sync:rotate-history -- --confirm-restore` in the
   built server package. Rotation refuses a live application lease and changes
   only the history generation. It is mandatory after restore: a database copy
   includes the old UUID, so equal or higher restored cursors do not reliably
   reveal divergent history on their own. A release lacking this recovery
   protocol is not a supported shortcut for serving updated clients.
4. Start exactly one compatible server and verify readiness. Clients from the
   old generation pause with their local changes retained. In the original
   account's workspace, use **Settings → General → Sync history recovery**:
   pause agents, close other tabs, download and retain the verified encrypted
   archive and its password separately, then explicitly reconcile and review
   conflicts. Do not clear IndexedDB, sync metadata, or queued work to bypass
   recovery.

The complete [sync history restore procedure](../server/docs/sync-recovery.md)
also describes empty-workspace archive restoration and asset limits. History
rotation is not an automatic restore detector and does not discard entity data
or pending client deletions.

### Single-Instance Maintenance Window

This release does **not** support zero-downtime rolling replacement, horizontal
replicas, or high availability. A dedicated PostgreSQL advisory lease rejects a
second application process for the same database; losing the lease connection
terminates the first. WebSockets, rate limits, and bot scheduling remain
in-process. This guard is not a distributed queue or an HA fencing protocol.

Use a planned stop/start maintenance window, not overlapping old and new server
instances. Ordinary clients can reconnect after restart, but a restored history
requires the explicit recovery flow above and revoked/expired sessions may need
a new sign-in. See [runtime boundaries](../server/docs/runtime-operations.md).
