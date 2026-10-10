# ThreatCaddy Backup & Recovery Guide

## Overview

ThreatCaddy has three layers of data that can be backed up independently:

1. **Client-side (IndexedDB)** -- Local browser data, exported as a JSON backup or through the separate encrypted-backup flow
2. **Server-side (encrypted backup files)** -- Entity snapshots uploaded to the server via the backup API
3. **Database (PostgreSQL)** -- The server's authoritative data store

---

## 1. Client-Side Backups (IndexedDB)

### Hosted App: JSON Backup and a Restore Drill

For the hosted app without a team server, use **Save Backup** in the app header
or **Settings → Export JSON**. Store the downloaded `threatcaddy-backup-*.json`
outside the browser. This JSON file is **not password-encrypted**; protect it as
sensitive investigation data, including when local database encryption is enabled.

Verify recovery in a new temporary browser profile before relying on a backup:

1. Export from the browser profile and workspace containing your investigations.
2. Open the app in a separate, empty profile. Do not clear your working profile.
3. Import the JSON backup. Use **Replace All** only in that empty profile; it
   deletes existing app data at the destination. The header import also offers
   **Merge** for a populated destination; back that destination up first.
4. Compare investigation names, note and chat content, classifications, source
   associations, and any templates or whiteboard content you depend on.
5. Reload the restored app and check the same records again. Keep the original
   profile and backup until recovery has been verified.

A JSON export is an application-data backup, not a copy of the whole browser
profile or a server/database/files backup. Do not assume browser settings,
provider credentials, or externally stored server files are included.

The header's **Merge** restores investigation records and note templates; it
does not currently restore playbook templates, agent tables, or quick-link
settings. For a complete JSON restore, use **Replace All** in an empty profile
and verify the optional data you use there before changing a populated profile.

### Moving from HTTP to HTTPS

Browser storage is origin-specific: `http://threatcaddy.com` and
`https://threatcaddy.com` have separate IndexedDB databases. An HTTP-to-HTTPS
redirect does **not** move existing investigations to the HTTPS database.

Before enabling GitHub Pages **Enforce HTTPS**, export any HTTP-only data from
its original profile and restore/verify it on HTTPS using the drill above.
If HTTPS already contains data, export that data too and use the header's
**Merge** option rather than replacing it. Do not remove the original HTTP data
or backups during migration. If all users already use HTTPS and have no HTTP
data, no data migration is needed.

After the migration, enable only **Settings → Pages → Enforce HTTPS**, leaving
the custom domain, DNS, and Pages source unchanged. Confirm that HTTP redirects
to the HTTPS origin and that HTTPS still loads successfully. Future visits and
bookmarks should use HTTPS.

### How It Works

The separate **Server Encrypted Backups** flow builds a payload from IndexedDB,
encrypts it with a user-provided password, and uploads the encrypted blob to a
connected team server. These controls require that server; they are not a local
encrypted-file export for hosted-only users. The format and restore modes below
describe that flow, not the plain JSON export.

**Relevant files:**
- `src/lib/backup-data.ts` -- Payload construction
- `src/lib/backup-crypto.ts` -- Encryption/decryption
- `src/lib/backup-restore.ts` -- Restore logic

### Backup Types

| Type | Description |
|------|-------------|
| **Full** | Entities from the supported backup tables (or scoped to an investigation/entity) |
| **Differential** | Snapshot differences against a verified full parent, including removed IDs; the matching full parent is required for restore |

### Backup Scopes

| Scope | What's Included |
|-------|----------------|
| `all` | Every supported entity table listed in `src/lib/backup-tables.ts` |
| `investigation` | A single folder and all its scoped entities (notes, tasks, timeline events, whiteboards, IOCs, chat threads), plus referenced tags and timelines |
| `entity` | A single entity from a specific table (format: `tableName:entityId`) |

### Encrypted Backup Format

Backups are encrypted with AES-256-GCM using a password-derived key:

```
Password
    |
    v (PBKDF2, 600,000 iterations, SHA-256, random 16-byte salt)
AES-GCM-256 Key
    |
    v (AES-GCM encrypt with random 12-byte IV)
EncryptedBackupBlob {
    v: 1,           // format version
    salt: string,   // base64 PBKDF2 salt
    iv: string,     // base64 AES-GCM IV
    ct: string      // base64 ciphertext
}
```

The plaintext payload (before encryption) has this structure:

```json
{
    "version": 1,
    "type": "full",
    "scope": "all",
    "scopeId": null,
    "parentBackupId": null,
    "createdAt": 1709827200000,
    "lastBackupAt": null,
    "data": {
        "notes": [...],
        "tasks": [...],
        "folders": [...],
        "tags": [...],
        "timelineEvents": [...],
        "timelines": [...],
        "whiteboards": [...],
        "standaloneIOCs": [...],
        "chatThreads": [...]
    },
    "deletedIds": {}
}
```

### Creating a Client-Side Backup

With a team server connected, use **Settings → Server Encrypted Backups** with
a password to create and upload an encrypted blob.
The header's **Save Backup** and Settings' **Export JSON** instead produce the
plain JSON format described above; they do not prompt for an encryption password.

### Restoring from a Client-Side Backup

Two restore modes are available:

| Mode | Behavior |
|------|----------|
| **Full Replace** | Replaces records within the full backup's declared scope and included tables. Omitted tables and out-of-scope records are retained; shared references are protected. Replacement can delete existing records, so back up the destination first. |
| **Merge** | For a full backup, adds missing records and updates existing records when the backup version is newer (`updatedAt` comparison). A verified differential backup applies its recorded changes, including tombstone deletions, to the matching parent state; this is not a non-destructive operation. |

**Important:** An unlocked workspace's encryption middleware returns decrypted
application values to backup creation. The separate encrypted-backup flow
protects that payload with the backup password; plain JSON export does not.
On restore, the destination workspace's encryption middleware applies its own
at-rest encryption. Keep the backup password separately from the backup file.

---

## 2. Server-Side Backups (Encrypted Backup API)

### API Endpoints

**File:** `server/src/routes/backups.ts`

All endpoints require authentication (`Authorization: Bearer <token>`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST /api/backups` | Upload encrypted backup | Multipart: `metadata` (JSON string) + `blob` (binary file) |
| `GET /api/backups` | List user's backups | Returns metadata for all backups owned by the authenticated user |
| `GET /api/backups/:id` | Download backup blob | Returns the raw `.enc` file |
| `DELETE /api/backups/:id` | Delete backup | Removes from DB and disk |

### Limits

- **Max backups per user**: 50
- **Max upload size**: 100 MB (enforced by body limit middleware)
- **Rate limit**: 5 requests per minute on `/api/backups`

### Upload Metadata

The `metadata` field in the multipart upload accepts:

```json
{
    "name": "Weekly full backup",
    "type": "full",
    "scope": "all",
    "scopeId": null,
    "entityCount": 1234,
    "parentBackupId": null
}
```

### Storage

Backup blobs are stored on disk at `${FILE_STORAGE_PATH}/backups/<id>.enc`. The file storage path defaults to `/data/files` (Docker volume `file-data`).

### Server-Side Backup Workflow

1. Client builds the backup payload from IndexedDB (`buildFullBackupPayload()` or `buildDifferentialPayload()`)
2. Client encrypts the payload with the user's backup password (`encryptBackup()`)
3. Client uploads the encrypted blob via `POST /api/backups` (multipart form data)
4. Server stores the blob on disk and records metadata in the `backups` table
5. To restore: client downloads via `GET /api/backups/:id`, decrypts with the backup password, and restores using merge or replace mode

---

## 3. Database Backup (PostgreSQL)

### Docker Compose Setup

If running the standard `docker-compose.yml`, PostgreSQL data is stored in the `pg-data` named volume.

#### Full Database Dump

```bash
# From the host machine
docker compose exec db pg_dump -U tc -d threatcaddy --format=custom -f /tmp/backup.dump

# Copy the dump file to the host
docker compose cp db:/tmp/backup.dump ./threatcaddy-backup-$(date +%Y%m%d).dump
```

#### SQL Format (human-readable, portable)

```bash
docker compose exec db pg_dump -U tc -d threatcaddy --format=plain > threatcaddy-backup-$(date +%Y%m%d).sql
```

#### Schema Only

```bash
docker compose exec db pg_dump -U tc -d threatcaddy --schema-only > threatcaddy-schema-$(date +%Y%m%d).sql
```

#### Data Only

```bash
docker compose exec db pg_dump -U tc -d threatcaddy --data-only --format=custom -f /tmp/data.dump
docker compose cp db:/tmp/data.dump ./threatcaddy-data-$(date +%Y%m%d).dump
```

### Bare-Metal PostgreSQL

If running PostgreSQL directly (not in Docker):

```bash
# Full backup
pg_dump -U tc -h localhost -d threatcaddy --format=custom -f threatcaddy-backup-$(date +%Y%m%d).dump

# With password prompt
PGPASSWORD=tc pg_dump -U tc -h localhost -d threatcaddy --format=custom -f threatcaddy-backup-$(date +%Y%m%d).dump
```

### Automated Backups with Cron

Add to crontab (`crontab -e`):

```cron
# Daily at 2 AM
0 2 * * * docker compose -f /path/to/docker-compose.yml exec -T db pg_dump -U tc -d threatcaddy --format=custom > /backups/threatcaddy-$(date +\%Y\%m\%d).dump 2>/dev/null

# Weekly full backup (Sundays at 3 AM)
0 3 * * 0 docker compose -f /path/to/docker-compose.yml exec -T db pg_dump -U tc -d threatcaddy --format=plain | gzip > /backups/threatcaddy-weekly-$(date +\%Y\%m\%d).sql.gz 2>/dev/null

# Cleanup backups older than 30 days
0 4 * * * find /backups -name "threatcaddy-*.dump" -mtime +30 -delete
```

### File Storage Backup

Back up the file storage volume alongside the database:

```bash
# Docker volume backup
docker run --rm \
    -v threatcaddy_file-data:/data \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/files-$(date +%Y%m%d).tar.gz -C /data .

# Or directly copy from container
docker compose cp server:/data/files ./files-backup-$(date +%Y%m%d)/
```

---

## 4. Recovery Procedures

### Scenario 1: Browser Data Lost (IndexedDB cleared)

**Situation:** User cleared browser data, or switched browsers/devices.

**Recovery from server-side backup:**
1. Open ThreatCaddy in the browser
2. Go to Settings > Backup & Restore
3. Connect to the team server (if not already)
4. Download a backup from the server backup list
5. Enter the backup password
6. Choose restore mode (Full Replace recommended for empty database)

**Recovery from local file:**
1. Open ThreatCaddy
2. Go to Settings > Backup & Restore
3. Import the `.enc` backup file
4. Enter the backup password
5. Choose restore mode

**Recovery via server sync (if connected to team server):**
1. Open ThreatCaddy and connect to the team server
2. The sync engine will automatically pull all data the user has access to
3. No manual intervention needed -- the initial sync pushes nothing (empty local DB) and pulls everything

### Scenario 2: Server Data Corruption

**Situation:** PostgreSQL data is corrupted or lost.

**Recovery steps:**
1. Stop the server:
   ```bash
   docker compose down
   ```

2. Remove the corrupted volume (if needed):
   ```bash
   docker volume rm threatcaddy_pg-data
   ```

3. Restore from database dump:
   ```bash
   # Start only the database
   docker compose up -d db

   # Wait for it to be healthy
   docker compose exec db pg_isready -U tc -d threatcaddy

   # Restore from custom format dump
   docker compose cp ./threatcaddy-backup-20260307.dump db:/tmp/backup.dump
   docker compose exec db pg_restore -U tc -d threatcaddy --clean --if-exists /tmp/backup.dump

   # Or from SQL format
   docker compose cp ./threatcaddy-backup-20260307.sql db:/tmp/backup.sql
   docker compose exec db psql -U tc -d threatcaddy -f /tmp/backup.sql
   ```

4. Restore file storage (if needed):
   ```bash
   docker run --rm \
       -v threatcaddy_file-data:/data \
       -v $(pwd)/backups:/backup \
       alpine tar xzf /backup/files-20260307.tar.gz -C /data
   ```

5. Start the full stack:
   ```bash
   docker compose up -d
   ```

6. The server will run migrations automatically on startup. Verify via health check:
   ```bash
   curl http://localhost:3001/health
   ```

### Scenario 3: Server Migration (Moving to New Host)

1. On the old host, create backups:
   ```bash
   # Database
   docker compose exec db pg_dump -U tc -d threatcaddy --format=custom -f /tmp/backup.dump
   docker compose cp db:/tmp/backup.dump ./migration-db.dump

   # Files
   docker compose cp server:/data/files ./migration-files/

   # Environment
   cp .env ./migration.env
   ```

2. On the new host:
   ```bash
   # Copy files
   scp migration-db.dump migration.env new-host:~/threatcaddy/
   scp -r migration-files/ new-host:~/threatcaddy/

   # Set up docker-compose.yml and .env
   # Start database
   docker compose up -d db

   # Restore database
   docker compose cp ./migration-db.dump db:/tmp/backup.dump
   docker compose exec db pg_restore -U tc -d threatcaddy /tmp/backup.dump

   # Restore files
   docker compose cp ./migration-files/. server:/data/files/

   # Start everything
   docker compose up -d
   ```

3. Update DNS / reverse proxy to point to the new host.
4. Update `ALLOWED_ORIGINS` in `.env` if the domain changed.

### Scenario 4: Encryption Key Loss (Client-Side)

**Situation:** User forgot their encryption passphrase.

**Recovery options:**
1. **Recovery phrase**: If the user has their 24-word recovery phrase, they can use it as the passphrase to unwrap the master key.
2. **Server data**: If connected to a team server, the server has the entity data (though field content may be encrypted client-side). Disabling encryption and re-syncing may recover unencrypted content.
3. **No recovery possible**: If no recovery phrase and no server, encrypted data in IndexedDB is permanently inaccessible. This is by design.

### Scenario 5: Admin Secret Lost

**Situation:** The admin bootstrap secret is lost and no admin users exist.

**Recovery steps:**
1. Set a new `ADMIN_SECRET` in the `.env` file or environment variables
2. Restart the server -- the new secret will be hashed and stored in the database, replacing the old one
3. Use the new secret to bootstrap the first admin user via the admin panel

---

## 5. Recommended Backup Schedule

### For Individual Users (Local-Only Mode)

| What | How Often | Method |
|------|-----------|--------|
| Application JSON backup | Weekly and before major changes | Save Backup / Export JSON; protect the downloaded plaintext file in secure storage |
| Investigation-scoped backup | After major updates | Export specific investigation |

### For Team Deployments

| What | How Often | Method | Retention |
|------|-----------|--------|-----------|
| PostgreSQL full dump | Daily | Cron + `pg_dump --format=custom` | 30 days |
| PostgreSQL weekly dump | Weekly (Sunday) | Cron + `pg_dump` + gzip | 90 days |
| File storage (`/data/files`) | Daily | Cron + tar/rsync | 30 days |
| Server-side encrypted backups | Users manage their own | Via backup API | Max 50 per user |
| Admin secret | On change | Copy `.admin-secret` file or record `ADMIN_SECRET` env var | Indefinite |
| `.env` / environment config | On change | Secret manager or encrypted offline backup; never commit secret-bearing files to source control | Indefinite |
| JWT key pair (Ed25519) | On initial setup | Secure offline storage | Indefinite |

### What to Monitor

- **Disk usage**: `/data/files` volume (backups + uploaded files)
- **Database size**: `SELECT pg_size_pretty(pg_database_size('threatcaddy'));`
- **Backup success**: Check cron job logs
- **Health endpoint**: `GET /health` returns database connectivity and file storage accessibility
- **Tombstone accumulation**: Soft-deleted entities are hard-deleted after 90 days by the cleanup service

### Testing Backups

Periodically verify backups by restoring to a test environment:

```bash
# Create a test database
docker compose exec db createdb -U tc threatcaddy_test

# Restore the backup to the test database
docker compose exec db pg_restore -U tc -d threatcaddy_test /tmp/backup.dump

# Verify key tables have data
docker compose exec db psql -U tc -d threatcaddy_test -c "SELECT count(*) FROM users;"
docker compose exec db psql -U tc -d threatcaddy_test -c "SELECT count(*) FROM folders;"
docker compose exec db psql -U tc -d threatcaddy_test -c "SELECT count(*) FROM notes;"

# Clean up
docker compose exec db dropdb -U tc threatcaddy_test
```
