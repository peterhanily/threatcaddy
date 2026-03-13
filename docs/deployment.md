# ThreatCaddy Deployment Guide

## 1. Docker Deployment (Recommended)

### Prerequisites

- Docker Engine 24+ and Docker Compose v2
- A domain name with DNS pointing to your server (for HTTPS)
- An Ed25519 key pair for JWT signing

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
      DATABASE_URL: postgres://tc:tc@db:5432/threatcaddy
      PORT: "3001"
      ADMIN_PORT: "3002"
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      FILE_STORAGE_PATH: /data/files
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:?Set ALLOWED_ORIGINS in .env (e.g. https://your-domain.com)}
      ADMIN_SECRET: ${ADMIN_SECRET:-}
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
      POSTGRES_PASSWORD: tc
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

1. **Build stage**: `node:22-alpine`, installs all dependencies, compiles TypeScript
2. **Runtime stage**: `node:22-alpine`, installs production dependencies only, copies compiled JS and migrations
3. Runs as non-root user `app`
4. Exposes ports 3001 and 3002

---

## 2. Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_PRIVATE_KEY` | Ed25519 private key in PEM format (single-line, `\n`-escaped) | `-----BEGIN PRIVATE KEY-----\nMC4C...` |
| `JWT_PUBLIC_KEY` | Corresponding Ed25519 public key in PEM format | `-----BEGIN PUBLIC KEY-----\nMCow...` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins. **Must be set in production.** | `https://your-domain.com` |

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://tc:tc@localhost:5432/threatcaddy` |
| `PORT` | API server port | `3001` |
| `ADMIN_PORT` | Admin panel port | `3002` |
| `FILE_STORAGE_PATH` | Directory for uploaded files and backups | `/data/files` |
| `TRUST_PROXY` | Set to `1` when behind a reverse proxy to trust `X-Forwarded-For` headers for rate limiting | `0` |
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

### Bot System (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_MASTER_KEY` | Master key for encrypting bot secrets at rest. If not set, falls back to `JWT_PRIVATE_KEY`. In production, set a dedicated 32+ character secret. | Uses `JWT_PRIVATE_KEY` |
| `BOT_EXECUTION_TIMEOUT_MS` | Maximum bot execution time in milliseconds | `300000` (5 minutes) |
| `BOT_MAX_CONCURRENT_RUNS` | Maximum number of bots executing simultaneously | `10` |
| `SANDBOX_PYTHON_IMAGE` | Docker image for Python sandbox | `python:3.12-slim` |
| `SANDBOX_NODE_IMAGE` | Docker image for Node.js sandbox | `node:22-alpine` |
| `SANDBOX_BASH_IMAGE` | Docker image for Bash sandbox | `alpine:3.19` |

### Database Connection Pool

The PostgreSQL connection pool is configured in `server/src/db/index.ts` with a fixed pool size of 20 connections. To adjust for high-traffic deployments, modify the `max` parameter in the `postgres()` call.

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
        client_max_body_size 100m;
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
```

This tells the server to trust `X-Forwarded-For` headers for rate limiting. Without this, all requests appear to come from the proxy's IP, and rate limits will apply globally instead of per-client.

---

## 4. Production Hardening

### 4.1 ALLOWED_ORIGINS

**Critical**: Always set `ALLOWED_ORIGINS` in production. Without it, the server defaults to `*` (wildcard), which allows any origin to make API requests.

```env
# Single origin
ALLOWED_ORIGINS=https://your-domain.com

# Multiple origins (comma-separated)
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com
```

### 4.2 Database Credentials

The default Docker Compose uses `tc:tc` for PostgreSQL credentials. In production:

1. Change the database password:
   ```yaml
   db:
     environment:
       POSTGRES_PASSWORD: a-strong-random-password
   ```

2. Update `DATABASE_URL`:
   ```yaml
   server:
     environment:
       DATABASE_URL: postgres://tc:a-strong-random-password@db:5432/threatcaddy
   ```

3. Do not expose the PostgreSQL port to the host (the default compose file already does this correctly -- no `ports` on the `db` service).

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

If using the bot system, set a dedicated `BOT_MASTER_KEY`:

```env
BOT_MASTER_KEY=a-32-plus-character-random-secret
```

Without this, bot secrets are encrypted using the JWT private key as the master secret. A dedicated key is more secure because rotating JWT keys won't affect bot secret encryption.

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
- File uploads: 50 MB
- Backup uploads: 100 MB
- Other API requests: 1 MB

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
| Database connections | PostgreSQL `pg_stat_activity` | > 18 active (pool max is 20) |
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

### Standard Upgrade

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose build
docker compose up -d
```

Database migrations run automatically on server startup (`drizzle-orm/postgres-js/migrator`). No manual migration steps are needed.

### Rollback

If an upgrade causes issues:

```bash
# Revert to previous code
git checkout <previous-commit>

# Rebuild and restart
docker compose build
docker compose up -d
```

**Note:** Database migrations are forward-only. If a new migration was applied and you need to rollback, restore from a database backup taken before the upgrade.

### Zero-Downtime Considerations

The current architecture does not support zero-downtime deployments out of the box (single server instance, in-memory WebSocket state, in-memory admin JWT key). For zero-downtime:

1. Take a database backup before upgrading
2. Notify users of a brief maintenance window
3. Stop, rebuild, and start in quick succession
4. WebSocket clients will automatically reconnect (exponential backoff, 1s to 30s)
5. SPA clients will re-authenticate using their refresh token
