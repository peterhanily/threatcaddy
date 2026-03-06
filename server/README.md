# ThreatCaddy Server

Backend API server for ThreatCaddy. Handles authentication, real-time sync, social feed, file storage, and CaddyChat. Built with Hono + Drizzle ORM on PostgreSQL.

## Prerequisites

- Node.js 22+
- PostgreSQL 17+

## Setup

```bash
cd server
npm install
```

Create a `.env` file:

```bash
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/threatcaddy

# JWT keys (generate with: openssl genpkey -algorithm ed25519 -out private.pem)
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Server
PORT=3001
ADMIN_PORT=3002
ALLOWED_ORIGINS=http://localhost:5173
TRUST_PROXY=false

# Admin
ADMIN_SECRET=changeme

# File storage
FILE_STORAGE_PATH=./data/files

# LLM API keys (optional)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
MISTRAL_API_KEY=
```

Generate JWT keys:

```bash
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

Create the database:

```bash
createdb threatcaddy
npm run db:push    # push schema directly
# or
npm run db:migrate # run migrations
```

Start the server:

```bash
npm run dev   # development with auto-reload
npm run build && npm start  # production
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_PRIVATE_KEY` | Yes | — | Ed25519 private key (PEM) for signing tokens |
| `JWT_PUBLIC_KEY` | Yes | — | Ed25519 public key (PEM) for verifying tokens |
| `PORT` | No | `3001` | Main API port |
| `ADMIN_PORT` | No | `3002` | Admin panel port |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| `ADMIN_SECRET` | No | auto-generated | Secret for admin panel login |
| `TRUST_PROXY` | No | `false` | Trust proxy headers (set `true` behind a reverse proxy) |
| `FILE_STORAGE_PATH` | No | `./data/files` | Directory for uploaded files |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | No | — | OpenAI API key |
| `GOOGLE_API_KEY` | No | — | Google AI API key for Gemini models |
| `MISTRAL_API_KEY` | No | — | Mistral API key |

## API Endpoints

### Auth (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register new user |
| POST | `/login` | Login |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout |
| GET | `/me` | Get current user |
| PATCH | `/me` | Update profile |
| POST | `/change-password` | Change password |

### Sync (`/api/sync`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/push` | Push entity changes |
| GET | `/pull` | Pull changes since timestamp |
| GET | `/snapshot/:folderId` | Full folder snapshot |

### Investigations (`/api/investigations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List user's investigations |
| GET | `/:id/members` | Get investigation members |
| POST | `/:id/members` | Add member |
| PATCH | `/:id/members/:userId` | Update member role |
| DELETE | `/:id/members/:userId` | Remove member |
| POST | `/:id/invite` | Invite user by email |

### Feed (`/api/feed`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Paginated feed |
| POST | `/posts` | Create post |
| GET | `/posts/:id` | Get post with replies |
| PATCH | `/posts/:id` | Edit post |
| DELETE | `/posts/:id` | Soft-delete post |
| POST | `/posts/:id/reactions` | Add reaction |
| DELETE | `/posts/:id/reactions/:emoji` | Remove reaction |

### Files (`/api/files`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload file (max 50 MB) |
| GET | `/:id` | Download file |
| GET | `/:id/thumbnail` | Download thumbnail |

### LLM (`/api/llm`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Stream LLM response (SSE) |
| GET | `/config` | Available providers |

### Audit (`/api/audit`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Activity log (filterable) |

### Notifications (`/api/notifications`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List notifications |
| PATCH | `/:id/read` | Mark as read |
| POST | `/mark-all-read` | Mark all as read |
| DELETE | `/read` | Delete read notifications |

### Users (`/api/users`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Search users / list all (admin) |
| GET | `/:id` | Get user profile |
| GET | `/:id/feed` | User's post timeline |
| PATCH | `/:id` | Admin update user |
| DELETE | `/:id` | Admin deactivate user |

### Admin (`/admin`)

Served on a separate port (`ADMIN_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Admin panel UI |
| POST | `/api/login` | Admin login |
| GET | `/api/users` | List all users |
| PATCH | `/api/users/:id` | Update user role/status |
| POST | `/api/users/:id/reset-password` | Reset password |
| POST | `/api/change-secret` | Change admin secret |
| GET | `/api/stats` | Server statistics |
| GET | `/api/settings` | Get settings |
| PATCH | `/api/settings` | Update settings |
| GET | `/api/allowed-emails` | List allowed emails |
| POST | `/api/allowed-emails` | Add allowed email |
| DELETE | `/api/allowed-emails/:email` | Remove allowed email |
| GET | `/api/investigations` | Investigation overview |

### WebSocket (`/ws`)

Token-based auth — send `{ type: "auth", token: "..." }` as the first message.

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `auth` | Client → Server | Authenticate connection |
| `subscribe` | Client → Server | Subscribe to folder updates |
| `unsubscribe` | Client → Server | Unsubscribe from folder |
| `presence-update` | Client → Server | Update user presence |
| `auth-ok` | Server → Client | Authentication successful |
| `presence` | Server → Client | Presence state for folder |
| `ping` / `pong` | Both | Keep-alive heartbeat |

## Docker

```bash
docker compose up --build -d
```

This starts:
- **server** on ports 3001 (API) and 3002 (Admin)
- **PostgreSQL 17** on port 5432

Data is persisted in Docker volumes (`pg-data`, `file-data`).

## Development

```bash
npm run dev          # Start with auto-reload (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled output
npm test             # Run tests (vitest)
npm run test:watch   # Tests in watch mode
npm run db:generate  # Generate migrations from schema
npm run db:migrate   # Run pending migrations
npm run db:push      # Push schema to database directly
```
