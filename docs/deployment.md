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

```

Copy the complete PEM text into quoted multiline values in the protected `.env`
file, including its BEGIN/END lines. The application expects actual newlines.
Literal `\n` text passed through Docker's `--env-file` or a process environment
is not a PEM newline and can make login fail. Compose can decode escaped
newlines in double-quoted `.env` values, but actual multiline values avoid this
parser difference. Do not regenerate existing keys during an upgrade.

### Configure Environment

Create a `.env` file in the project root (same directory as `docker-compose.yml`):

```env
# Required
# Fill these from your deployment secret store; do not commit this file.
POSTGRES_PASSWORD=
BOT_MASTER_KEY=
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
REPLACE_WITH_YOUR_PRIVATE_KEY_BASE64
-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
REPLACE_WITH_YOUR_PUBLIC_KEY_BASE64
-----END PUBLIC KEY-----"
ALLOWED_ORIGINS=https://your-domain.com

# Optional
# Blank generates a bootstrap secret on first launch (see below). To set one,
# use a long random value such as the output of: openssl rand -base64 32
ADMIN_SECRET=
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
- **ThreatCaddy Server** with the API on host loopback (`127.0.0.1:3001`) for the
  TLS reverse proxy in [3. Reverse Proxy Setup](#3-reverse-proxy-setup), and the
  admin panel on host loopback only (`127.0.0.1:3002`)

The API speaks plain HTTP. To serve clients without a proxy on this host, opt
in explicitly in `.env`, either on every IPv4 interface or on one interface
address (such as a VPN address):

```env
API_PUBLISH_ADDRESS=0.0.0.0
```

Docker-published ports bypass host firewalls such as ufw and firewalld, so a
firewall rule does not hide port 3001. Restrict it with provider security groups
or `DOCKER-USER` rules, and do not send passwords or tokens to it across an
untrusted network.

### Verify

```bash
# Health check
curl http://localhost:3001/health

# Expected response (abridged):
# {"status":"ok","db":"connected","storage":"accessible","version":"...","uptime":42,"memory":{...},"timestamp":"..."}
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
      - "${API_PUBLISH_ADDRESS:-127.0.0.1}:3001:3001" # API + WebSocket: host loopback unless you opt in
      - "127.0.0.1:3002:3002" # Admin panel: host loopback only
    environment:
      DATABASE_URL: postgres://tc:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432/threatcaddy
      PORT: "3001"
      ADMIN_PORT: "3002"
      ADMIN_HOST: "0.0.0.0" # Container binding; host publication stays on loopback
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
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "5"

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
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "5"

volumes:
  pg-data:
  file-data:
```

### Docker Image Details

The server Dockerfile (`server/Dockerfile`) uses a multi-stage build:

1. **Build stage**: the official `node:24.22.3-alpine` image pinned by digest in the Dockerfile, installs all dependencies and compiles TypeScript
2. **Runtime stage**: the same pinned Node 24.22.3 image, upgrades zlib to at least 1.4-r0, installs production dependencies only, drops the `ssh2` test suite (third-party test private keys) and npm's build-time compile cache, and copies compiled JS and migrations
3. Runs as non-root user `app` with `NODE_ENV=production`, so error responses never echo exception messages (server errors were already generic). The application code in `/app` is root-owned and read-only to `app`, which can write only `/data/files`
4. Declares a `HEALTHCHECK` that requests `/health` on `127.0.0.1:${PORT}` inside the container; Docker reports the result but does not restart the container
5. Declares ports 3001 and 3002 for the two listeners; only the ports you publish are reachable from the host (the supplied Compose file publishes both on host loopback by default)

---

## 2. Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_PRIVATE_KEY` | Complete Ed25519 private PEM with actual newlines in the process environment | Quoted multiline value in `.env` |
| `JWT_PUBLIC_KEY` | Matching complete Ed25519 public PEM with actual newlines | Quoted multiline value in `.env` |
| `BOT_MASTER_KEY` | Stable explicit credential-encryption key, 32–1024 characters with no surrounding whitespace. Required at startup; no JWT or ephemeral fallback. Preserve the exact existing value during upgrades. | New installations: generate 32 random bytes encoded as 64 hexadecimal characters |
| `DATABASE_URL` | Explicit PostgreSQL connection string; Compose supplies it from `POSTGRES_PASSWORD`. No production fallback. | Set through protected deployment configuration |
| `POSTGRES_PASSWORD` | Required by the supplied Compose file for the database and server connection. | Set through protected deployment configuration |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins. **Must be set in production.** | `https://your-domain.com` |

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_POOL_MAX` | Application PostgreSQL pool limit | `50` |
| `HOST` | API bind address | Node's wildcard binding |
| `PORT` | API server port | `3001` |
| `ADMIN_HOST` | Admin panel bind address, independent of `HOST`. In a container, loopback is the container itself: the supplied Compose file sets `0.0.0.0` and publishes only `127.0.0.1:3002` on the host | `127.0.0.1` |
| `ADMIN_PORT` | Admin panel port | `3002` |
| `FILE_STORAGE_PATH` | Directory for uploaded files and backups | `/data/files` |
| `STORAGE_QUOTA_PER_USER_BYTES` | Combined retained file/backup quota per user; positive integer bytes | `2147483648` (2 GiB) |
| `STORAGE_QUOTA_TOTAL_BYTES` | Combined retained file/backup quota across users; positive integer bytes | `21474836480` (20 GiB) |
| `TRUST_PROXY` | `true`/`1` enables forwarding from trusted peers only; `false`/`0` disables it | `0` |
| `TRUSTED_PROXY_IPS` | Comma-separated socket peer IPs or CIDR ranges (IPv4 or IPv6) allowed to supply forwarding headers; no hostnames or `/0`. See [Important Proxy Settings](#important-proxy-settings) | `127.0.0.1,::1` |
| `SERVER_NAME` | Display name for the server instance | Auto-generated (e.g., "Alpha Hub") |
| `ADMIN_SECRET` | Bootstrap secret for creating the first admin user. If not set, auto-generated on first launch and written to `${FILE_STORAGE_PATH}/.admin-secret`. Use at least 24 random characters; startup logs a warning for a shorter value. A configured value replaces a secret changed in the admin panel at every restart. | Auto-generated |

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

These examples publish only the API, WebSocket and SPA. They deliberately do
not route the admin listener: reach administration through the SSH tunnel in
[4.3 Admin Panel Access](#43-admin-panel-access). `/health` reports the server
version, uptime and memory figures, so both examples answer it only for the
proxy host itself; add your monitoring addresses explicitly.

### Nginx

```nginx
# /etc/nginx/sites-available/threatcaddy
upstream threatcaddy_api {
    server 127.0.0.1:3001;
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

    # Health check (no auth; reports version, uptime and memory)
    location = /health {
        allow 127.0.0.1;
        allow ::1;
        # allow <monitoring address or CIDR>;
        deny all;
        proxy_pass http://threatcaddy_api;
    }

    # Server info (no auth required)
    location /api/server/info {
        proxy_pass http://threatcaddy_api;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
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
        reverse_proxy 127.0.0.1:3001
    }

    # WebSocket
    handle /ws {
        reverse_proxy 127.0.0.1:3001
    }

    # Health check (no auth; reports version, uptime and memory)
    handle /health {
        # Add monitoring addresses or CIDRs after ::1
        @outside not remote_ip 127.0.0.1 ::1
        respond @outside 403
        reverse_proxy 127.0.0.1:3001
    }
}
```

### Important Proxy Settings

Behind a reverse proxy, the server must know which peers are your proxy.
Otherwise every client shares the proxy's address, and one outsider can trip
the login lockout and the rate limits for everyone. Set `TRUST_PROXY=1` and list
in `TRUSTED_PROXY_IPS` the address your proxy's connections arrive from, as the
server sees it: exact IPv4 or IPv6 addresses, or CIDR ranges such as
`172.18.0.0/16`.

With the supplied Compose file and nginx or Caddy on the host, as in the
examples above, the proxy connects to the port Docker publishes, and the
container sees the Compose network's gateway, not `127.0.0.1`. Look the gateway
up (the network is named after your Compose project; `docker network ls` lists
it):

```bash
docker network inspect threatcaddy_default --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}'
```

Then set it in your `.env` and recreate the server with `docker compose up -d`:

```env
TRUST_PROXY=1
# The gateway printed above, for example:
TRUSTED_PROXY_IPS=172.18.0.1
```

Removing the network (`docker compose down`) can give it another gateway on the
next start, so check the address again afterwards. For a proxy and a Node
server on the same host without containers, keep the default
`TRUSTED_PROXY_IPS=127.0.0.1,::1`. For a proxy elsewhere, list its address, or a
range that only your proxies use. A `/0` range is refused because it would
trust every peer.

When a peer that is not trusted sends `X-Forwarded-For`, the server logs one
warning per process that names the peer (`docker compose logs server`). Trust
that address only after confirming it is your proxy: anyone who can reach the
server directly can send the header.

Only connections from `TRUSTED_PROXY_IPS` may supply `X-Forwarded-For` (or `X-Real-IP` when absent). The server uses the nearest untrusted address in a valid IP chain. Other connections use their socket address. Your proxy must overwrite or correctly append forwarded addresses. Both variables are passed through by Compose.

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

The supplied Compose file publishes administration only on the host's loopback interface. Access it remotely through an SSH tunnel:

```bash
ssh -L 3002:127.0.0.1:3002 your-server
# Then open http://localhost:3002/admin
```

Keep the container network private: `ADMIN_HOST=0.0.0.0` inside the Compose container also permits other containers on that network to connect. A direct Node deployment defaults administration to `127.0.0.1` independently of the API binding. If you deliberately override these defaults for a management proxy or VPN, require private network access and explicit firewall/proxy restrictions. CORS is not a substitute for network isolation.

Since the images published after 2.0.0 (GHCR `latest` from 13 November 2026,
and every 2.0.1 or later image), the image no longer listens for administration
on every interface by default. A custom Compose file or `docker run` command
that does not set `ADMIN_HOST` binds administration to the container's own
loopback interface, where a published port 3002 cannot reach it (`/health`
stays green). To keep host administration, set `ADMIN_HOST=0.0.0.0` in the
container **and** publish the port on host loopback only, as
`127.0.0.1:3002:3002`. Never combine `ADMIN_HOST=0.0.0.0` with a bare
`3002:3002` mapping or host networking: Docker then publishes administration on
every host interface, and host firewalls such as ufw and firewalld do not filter
Docker-published ports. Use the SSH tunnel above for remote access.

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

The bot sandbox (code execution) needs a Docker API. **Docker API access is
root on that Docker host**: whoever can call it, through the socket or through
any proxy that permits `POST /containers/create`, can start a privileged
container or bind-mount the host filesystem. Giving the API container that
access turns any compromise of the Node process into host root. Leave the
sandbox disabled unless you need it.

1. **Recommended:** run a dedicated sandbox Docker daemon on a separate VM or
   host, or a rootless Docker or gVisor runtime, and point the server at it with
   `DOCKER_HOST` (for example `tcp://sandbox.internal:2376` with
   `DOCKER_TLS_VERIFY=1` and `DOCKER_CERT_PATH` naming a read-only mounted
   client-certificate directory). The supplied Compose file does not pass these
   variables; add them in an override file:
   ```yaml
   # docker-compose.override.yml
   services:
     server:
       environment:
         DOCKER_HOST: tcp://sandbox.internal:2376
         DOCKER_TLS_VERIFY: "1"
         DOCKER_CERT_PATH: /run/docker-certs
       volumes:
         - ./docker-certs:/run/docker-certs:ro
   ```

2. If you accept the host-root risk of the local socket, mount it and add the
   socket's group to the non-root `app` user. Do not run the container as root
   or make the socket world-writable:
   ```yaml
   # docker-compose.override.yml; DOCKER_GID from: stat -c %g /var/run/docker.sock
   services:
     server:
       group_add:
         - "${DOCKER_GID:?Set DOCKER_GID to the docker socket's group id}"
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock
   ```

   A socket proxy such as
   [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)
   reduces the reachable API sections, but it filters only by section and HTTP
   method. A permitted container create can still request privileged mode or
   host bind mounts, so a proxy does not remove the host-root exposure.

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

The supplied Compose file rotates both containers' logs with the `json-file`
driver: at most five 20 MB files per container. Older entries are discarded, so
ship logs to your retention system if you need a longer history. Custom
deployments should set equivalent limits; Docker's default driver does not
rotate.

The per-service `driver: json-file` takes precedence over a `log-driver` set in
`/etc/docker/daemon.json`. If the daemon already ships container logs, for
example with `journald`, `syslog`, `fluentd` or `awslogs`, name that driver
again in an override file. When the override names a different driver, Compose
replaces the whole logging block, including the `json-file` size options, so add
any options your driver needs. Logging settings apply when a container is
recreated.

```yaml
# docker-compose.override.yml
services:
  server:
    logging:
      driver: journald
  db:
    logging:
      driver: journald
```

The image sets `NODE_ENV=production`: error responses, including client (4xx)
errors, no longer echo exception messages. Server errors already return
`Internal server error` with a request ID; the details appear only in the
server log.

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

The server image declares a Docker `HEALTHCHECK` that runs this request with
Node inside the container every 30 seconds (60-second start period, three
retries). `docker ps` and `docker inspect` show the result. Docker does not
restart an unhealthy container; alert on the status or use an orchestrator that
acts on it. If you set `HOST` to an address other than the wildcard or
`127.0.0.1`, override the check in your Compose configuration.

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
   docker compose run --rm --no-deps server node dist/db/migrate-cli.js
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
The final container image has no npm, npx, Yarn or Corepack. Use its packaged
Node commands for maintenance; rebuild the image to change dependencies.
Do not use schema push, delete migration rows, rewrite historical SQL, or drop
data to bypass a failure. Follow [migration recovery](../server/docs/migration-recovery.md).

### Request-validation security update

The fixed build rejects sync batches above 500 changes and integration steps,
outputs or triggers above 256 entries before element validation. The existing
16 MiB sync and 1 MiB integration body limits still apply. Exercise large invalid
requests only in an isolated fixture or authorized staging environment.

Before rollout, retain the successful verification run URL, exact source commit,
audit evidence, resource-regression measurements, immutable artifact IDs and
checksums, server image ID/registry digest, and tested platform. CI keeps the
verified client and server artifacts and the client build reports for 90 days
and other test evidence for 7 to 14 days, so preserve approved release records and artifacts outside that
temporary storage. A dirty local checkout is a development build;
it is not an artifact approved for publication by the required workflow.

Inventory each intended team server, its operator, installation type, existing
configuration and recovery material. Keep these states separate in the release
record: **code verified**, **artifacts published**, and **deployment verified**.
Unknown installations and servers awaiting an operator remain explicitly
pending. Publishing an image or client does not establish server rollout.

- Registry installations: update the image reference to the exact verified
  registry digest, pull it, and recreate only the application container using
  that installation's actual Compose/service configuration. Before moving a
  configuration written for 2.0.0 to a later image, set
  `ADMIN_HOST=0.0.0.0` in the container and change its admin publication to
  `127.0.0.1:3002:3002`; without `ADMIN_HOST` the admin panel becomes
  unreachable (see [4.3 Admin Panel Access](#43-admin-panel-access)).
- The default repository Compose installation builds `./server`: update to the
  tested source, run `docker compose build server`, then
  `docker compose up -d --no-deps --force-recreate server`. Pulling a registry
  image alone does not update this installation type. The tracked Compose file
  already sets `ADMIN_HOST` and loopback-only admin publication; check that a
  local override file does not publish port 3002 on every interface. From
  2.0.2 it also sets the `json-file` log driver for both services, which
  replaces a daemon-wide log driver; to keep shipping logs through yours, add
  the override in [4.8 Logging](#48-logging) before recreating the containers.
  Recreate the database container once (`docker compose up -d db`) to apply its
  log rotation; the server-only command above does not. From 2.0.4 it publishes
  the API on host loopback only: if clients reach port 3001 directly rather than
  through a proxy on the same host, set `API_PUBLISH_ADDRESS` first (see
  [Start Services](#start-services)).

Later images also differ in ways that affect custom deployments: since 2.0.1
they have no npm, npx, Yarn or Corepack (use the packaged `node dist/...`
commands), and since 2.0.2 they run on Node 24.22.3 with
`NODE_ENV=production` (error responses no longer echo exception messages) and
declare a `HEALTHCHECK` against `/health`. On Kubernetes, leave `ADMIN_HOST`
unset and reach administration with `kubectl port-forward`; do not expose port
3002 through a Service.

Preserve the database, managed-file volumes, stable application keys and other
deployment settings. Confirm the running image identity and OCI revision label
(for workflow-built images), `node --version`, `/health`, authentication, normal
sync and a valid template share/list/install cycle. Verify oversized rejection
in staging before production and record each server's result. Container image
identity can be checked with `docker inspect` and `docker image inspect`; do not
identify a running build from a mutable `latest` tag alone.

If rollback requires a database restore, follow the complete procedure below,
including explicit sync-history rotation before clients reconnect.

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
   docker compose run --rm --no-deps server node dist/db/migrate-cli.js
   docker compose run --rm --no-deps server node dist/db/rotate-sync-history-cli.js --confirm-restore
   ```

   For a native-host build, use `npm run sync:rotate-history -- --confirm-restore` in the
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
