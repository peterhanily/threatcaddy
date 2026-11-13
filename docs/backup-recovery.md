# ThreatCaddy Backup & Recovery Guide

## Overview

ThreatCaddy has three layers of data that can be backed up independently:

1. **Client-side (IndexedDB)** -- Local browser data, exported as a JSON backup or through the separate encrypted-backup flow
2. **Server-side (encrypted backup files)** -- Entity snapshots uploaded to the server via the backup API
3. **Database (PostgreSQL)** -- The server's authoritative data store

---

## 1. Client-Side Backups (IndexedDB)

### Team sync and backup cover different data

Team sync shares supported fields across devices. It is not a full backup of
your browser workspace. The originating device retains the following details
through normal sync echoes and conflict resolution, but a fresh device cannot
download them from the team server:

| Entity | Details retained only on the originating device |
| --- | --- |
| Notes | Note folder hierarchy (`parentNoteId`, `isFolder`) and review-required flag |
| Tasks | Checklists, rejection count/history and escalation flag |
| Investigations | Playbook progress, assigned note templates, agent enabled/status/policy/thread and last-run state |
| Standalone IOCs | First/last-seen dates and linked evidence IDs |
| Chat threads | Mode, source, context summary and chat folder hierarchy |
| Chat messages | Tool calls/results, image attachments and agent cycle summaries |

The sync registry includes notes, tasks, investigations, tags, timeline events,
timelines, whiteboards, standalone IOCs, chat threads and evidence items. Their
supported shared fields include IOC/timeline comments and timeline coordinates.
Agent actions/profiles/deployments/meetings, note/playbook/integration templates,
installed integrations and custom slash commands are separate local entity
tables; they are included in full portable backups, not team entity sync.
Unshared local investigations also require a client backup.

Before **Remove Local Copy**, browser-storage clearing, or **Reset Workspace**,
save a full backup and verify it in a separate browser profile. Re-downloading a
synced investigation restores only its shared fields. **Save Backup** downloads
unencrypted JSON, even when local encryption is enabled. Use the separate
encrypted-backup flow when a password-protected archive is required. A
server/PostgreSQL backup cannot recover details that were never uploaded.

The export includes all 19 portable entity tables and flushes registered drafts
before capturing a consistent snapshot; an unsaved draft that cannot be
persisted blocks export. Transport revisions are kept separately from portable
content. Older sync rows with a stored server revision remain exportable without
discarding supported local fields or authorship metadata.

### Hosted App: JSON Backup and a Restore Drill

For the hosted app without a team server, use **Save Backup** in the app header
or **Settings → Export JSON**. Store the downloaded `threatcaddy-backup-*.json`
outside the browser. This JSON file is **not password-encrypted**; protect it as
sensitive investigation data, including when local database encryption is enabled.

Verify recovery in a new temporary browser profile before relying on a backup:

1. Export from the browser profile and workspace containing your investigations.
2. Open the app in a separate, empty profile. Do not clear your working profile.
3. Import the JSON backup. Use **Replace All** only in that empty profile; it
   replaces the entity types included in the file at the destination. An empty
   list clears that type; an omitted type is preserved. The header also offers
   **Merge** for a populated destination; back that destination up first.
4. Compare investigation names, note and chat content, classifications, source
   associations, and any templates or whiteboard content you depend on.
5. Reload the restored app and check the same records again. Keep the original
   profile and backup until recovery has been verified.

Normal retention rules still apply after recovery. For example, notes already
in trash for more than 30 days can be purged when the restored workspace loads.
Restoring a backup does not reset their trash timestamp or grant a new retention
period. Keep the original archive if historical trashed content is needed.

A JSON export is an application-data backup, not a copy of the whole browser
profile or a server/database/files backup. Do not assume browser settings,
provider credentials, or externally stored server files are included.

Both header restore modes cover the portable entity registry in
`src/lib/backup-tables.ts`, including templates, agent records, integrations and
custom slash commands. Merge adds missing records and replaces older revisions;
it does not remove records. Quick links are separate workspace settings, not
database entities. Internal sync queues, authentication sessions, browser
permissions and encryption keys are not portable backup data.

New plain backups carry a `threatcaddy-backup` format marker while retaining
the flat version-1 JSON layout. Ordinary legacy JSON backups and downloaded
cloud full-backup envelopes are also accepted. Malformed or unsupported data
is rejected before entity writes; records are not silently dropped or shortened.
Resolve pending or failed editor drafts before replacing or merging data.
Keep the app open while a restore is running, and check any retained draft
recovery notice before closing it.

### Downloaded Cloud Backups

Download the object from your configured cloud storage, then use **Load Backup**.
For password-encrypted files, enter the backup password in the import dialog;
for plain JSON, leave it blank. A failed password or validation check leaves
the dialog open so you can correct the problem and retry. The password is not
saved in settings or sent to a server by the import dialog.

Full-workspace files can be restored through this dialog. Scoped server backups
and verified differentials use the separate server restore flow, which checks
their declared scope and matching parent; do not flatten or manually edit them.
Cloud upload status distinguishes complete success, partial delivery and failure.
If some destinations fail, retain the backup password and check each result
before relying on remote recovery.

Portable files are limited to **50 MiB on disk**, including the encrypted
envelope. Base64 encryption increases file size, so a near-limit plain backup
may be too large to encrypt into a supported portable file. Creation fails
before download/upload in that case; keep the source data and use appropriately
scoped backups through the separate server workflow where available. Whiteboard
embedded files retain their separate 8 MiB per-board limit. These limits are not
raised or bypassed by manually editing a file.

After a successful restore, any notices about omitted configuration, suspended
automation or unsaved quick-link settings stay visible in the dialog. The entity
transaction is already committed at that point; the dialog offers **Close**, not
another restore. Save the original file until you have reviewed those notices.

#### Supported Cloud Destination URLs

Generated backup filenames require a destination that authorizes multiple objects:

- **OCI:** use a bucket PAR URL ending in `/o/`, or a slash-terminated prefix URL.
  A prefix-restricted PAR must permit the actual `threatcaddy/` paths appended by
  the app. The URL alone cannot prove the remote grant's permissions or expiry.
  See [OCI PAR scopes](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingpreauthenticatedrequests.htm).
- **Azure:** use a container SAS URL with `sr=c`, a signature, and a container
  path. Blob-specific, directory and account SAS modes are not supported here.
  See [Azure signed-resource scopes](https://learn.microsoft.com/en-us/rest/api/storageservices/create-service-sas).
- **S3 and GCS:** exact-object signed URLs are not supported by this generated-path
  upload flow. Appending a filename changes the signed resource. They now fail
  before any upload or connectivity-test write; saved destinations are retained
  so you can inspect or replace them. See [S3 presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
  and [GCS signed resource paths](https://docs.cloud.google.com/storage/docs/authentication/canonical-requests).

For supported destinations, **Test writes a small object** at
`threatcaddy/.connectivity-test` beneath the configured bucket/prefix. It is not a
read-only check. The app does not repurpose an exact-object backup URL for this
test. Cloud permissions, expiry, browser CORS and the deployment's allowed
connection origins still need to permit uploads; a syntactically valid URL is
not evidence that a backup was delivered.

### Credentials and Automation

Treat every backup as sensitive. Plain JSON is not encrypted, even if the source
workspace uses encryption at rest. Portable plaintext exports exclude installed
integration configuration and record this omission in their metadata. The header
and JSON import dialogs suspend imported automation; the separate server restore
flow preserves its exact snapshot semantics. Re-enter configuration
and review imported automation before enabling it. Password-encrypted exports
can preserve installed integration configuration inside the encrypted payload.

This is not a general-purpose secret scrubber: investigation text, evidence,
template source and user-defined fields may themselves contain credentials or
private material. Review a backup before sharing it. Provider settings and
cloud destination URLs are not included as browser settings.

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

If running the standard `docker-compose.yml`, PostgreSQL data is stored in the `pg-data` named volume. A dump alone is only the database portion of recovery. For a consistent recovery snapshot, stop the application server before capturing both the dump and managed files, retain checksums and the matching image identity, then resume it after capture. Keep dump files private and encrypt the off-device copy.

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

# Prompt for the database password; do not embed it in shell history
pg_dump -W -U tc -h localhost -d threatcaddy --format=custom -f threatcaddy-backup-$(date +%Y%m%d).dump
```

### Automated Backups

Schedule a reviewed backup job that captures a consistent database/file pair,
checks every command's exit status, and reports failure. Write to a new private
staging directory for each run and publish its manifest only after capture,
encryption and remote checksum verification succeed. Keep the last verified
recovery copy until a newer copy has passed a restore rehearsal. Do not suppress
backup errors or automatically delete the only known-good copy based on age.

A nightly database dump can supplement this process, but does not replace the
matching files, off-device encrypted copy and separately recoverable keys.

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

1. Stop the application server. Preserve the original database and file volumes;
   do not delete the only copy while investigating corruption.
2. Retrieve the verified database dump and managed-file snapshot from the same
   stopped-server capture. Check their SHA-256 manifest before restoring. Use
   separate, empty recovery volumes/database and a private network so the
   original deployment remains recoverable.
3. Restore the custom-format dump with `pg_restore --exit-on-error --no-owner`
   into the empty recovery database. Restore the matching files into the empty
   recovery file volume. A database-only restore can leave missing evidence or
   cause valid files to be quarantined. Do not run the application yet.
4. Verify every table count, migration history, and referenced file against the
   snapshot manifest. Retain the same `BOT_MASTER_KEY` to decrypt stored bot and
   provider credentials. Recover current deployment secrets from their separate
   secure custody; never restore a known-compromised historical JWT pair.
5. With the application still stopped, run
   `npm run sync:rotate-history -- --confirm-restore` against the recovery
   database using the matching packaged server. This changes the history
   generation so clients reconcile before uploading; it preserves entity rows.
6. Start the matched application image against the verified recovery pair only
   after reviewing enabled automation and outbound-provider configuration.
   Check `/health`, authentication, a representative investigation and attachment,
   and a clean client's sync reconciliation. Retain the original volumes until
   recovery is accepted.

See [deployment rollback and restore](deployment.md#6-upgrading) for the
Compose commands and compatible-image constraints. A local restore rehearsal
proves the selected snapshot is readable; it does not prove there is a usable
copy on another device.

### Independent server recovery copy

Capture a new consistent database/file pair with the server stopped, plus the
exact server image digest/source revision, schema history, table counts, and
file/checksum manifest. Encrypt the recovery archive using an authenticated
backup tool before transferring it to an approved off-device destination.
Keep the archive's decryption identity/key in separate recoverable custody;
storing it beside the archive defeats that separation. Deployment keys such
as `BOT_MASTER_KEY` also need a separately recoverable encrypted copy.

Download the uploaded ciphertext into a clean recovery environment, verify its
checksum, decrypt with the independently retrieved key and perform the restore
steps above. Record the source snapshot time, remote object/version, ciphertext
checksum, key-custody reference (never the key), image identity, restore counts,
file verification and cleanup outcome. An uploaded but untested archive, a
second directory on the same disk, and sync alone do not complete this drill.

### Scenario 3: Server Migration (Moving to New Host)

1. Stop the old application server and capture the consistent database/file pair,
   manifest and exact image identity described above. Preserve deployment keys
   in secure custody, including `BOT_MASTER_KEY`; do not print or commit them.
2. Transfer the encrypted recovery archive to the new host over an authenticated
   channel. Verify its checksum and restore into empty private volumes using
   Scenario 2. Keep both application servers stopped while rotating the restored
   sync history. Configure the new host's access restrictions and allowed origins
   before starting its application.
3. Verify health, sign-in, representative records/files and client reconciliation
   on the new host before switching DNS or the reverse proxy. Retain the stopped
   old deployment until migration is accepted; do not let both hosts accept writes
   to diverging copies of the investigation database.

### Scenario 4: Encryption Key Loss (Client-Side)

**Situation:** User forgot their encryption passphrase.

**Recovery options:**
1. **Preserve the original**: Do not reset the workspace, clear site storage, remove encryption metadata, or attempt to disable encryption without unlocking it. Preserve the locked database and its workspace-scoped localStorage metadata together; the database alone does not contain the wrapped-key metadata.
2. **Recovery phrase**: Select the recovery-key mode on the unlock screen and enter the saved 24-word phrase. It uses a separate recovery-wrapped copy of the master key, not the ordinary passphrase wrapping.
3. **Verified independent copy**: A known-good password-encrypted backup can be restored into a separate workspace using its backup password. Alternatively, if team sync previously completed, verify the required entities are still accessible on that server, then sign in from a separate fresh workspace/browser profile. Sync receives readable entity values; browser encryption at rest is not end-to-end sync encryption. This cannot recover local-only data, untransmitted edits or records the server no longer has. Leave the locked original intact until the recovered copy is checked.
4. **No usable key or independent copy**: The remaining encrypted data cannot be recovered. Resetting deletes it; it does not decrypt it.

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
