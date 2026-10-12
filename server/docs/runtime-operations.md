# Runtime boundaries and storage recovery

Run exactly one server process per application database. WebSockets, rate limiting and bot scheduling are in-process. Startup holds a dedicated PostgreSQL advisory lease; a second server refuses to start, and loss of the lease connection terminates the first process. This is an operational startup guard, not a distributed queue or a high-availability fencing protocol. Do not scale replicas or place a transaction-pooling proxy between the server and PostgreSQL. Stop the server before offline restore/history rotation.

## HTTP listener bindings

`HOST` optionally sets the public API's bind address. `ADMIN_HOST` optionally sets the administrative listener's address and falls back to `HOST`. With both unset, the existing Node/platform wildcard binding is unchanged; setting a CORS origin does not restrict network listeners. Use `HOST=127.0.0.1 ADMIN_HOST=127.0.0.1` for a local-only server, or set `ADMIN_HOST=127.0.0.1` when only administration must remain local. Ports remain independently configurable through `PORT` and `ADMIN_PORT`.

In a container, loopback means that container, not the host or another proxy container. Choose bindings and published ports for your deployment topology, retain firewall/proxy access controls, and do not expose the admin listener publicly. Startup logs include the actual bound address for each listener. The packaged integration harness explicitly binds both listeners to loopback.

## Upload quotas

Files and encrypted backups share transaction-serialized quotas. `STORAGE_QUOTA_PER_USER_BYTES` defaults to 2 GiB and `STORAGE_QUOTA_TOTAL_BYTES` to 20 GiB. Set positive integer byte counts; zero does not disable protection. The logical total counts retained original blobs plus a conservative 1 MiB reservation per thumbnail. Uploads also require 64 MiB of remaining filesystem space after the new body. PostgreSQL data, existing quarantine, and unrelated volume files are not part of the logical quota; monitor the underlying volume independently.

Individual file/backup limits are 50/100 MiB, plus 1 MiB of request allowance for multipart overhead. Backups retain the 50-per-user limit. HTTP 507 identifies exhausted storage capacity. Delete unneeded backups or explicitly remove an owned attachment with authenticated `DELETE /api/files/:id` (the uploader also needs current editor access for a scoped file). Removing a note alone does not destroy its shared evidence attachments. Review remaining references before deleting an attachment, or have the administrator adjust the explicit quota. Do not switch registration to open to work around onboarding restrictions.

Startup moves recognizable, unreferenced managed blobs older than one hour into `${FILE_STORAGE_PATH}/.orphan-quarantine`. It does not recursively delete data. Fresh files, secrets, unknown filenames, symlinks, and referenced blobs are left untouched. Quarantine names retain the original filename and indicate backup blobs. An operator can inspect and restore a quarantined blob together with its matching recovered database record. Quarantine is never automatically purged; archive or remove verified-unneeded entries only under your retention policy. A database restore should be paired with its storage snapshot before starting the server.

Database failure during a new upload triggers cleanup of that upload's newly created files. Abrupt process termination or disk failure may leave an orphan for the next startup reconciliation. Backups are streamed on download. Files, thumbnails and backups use `private, no-store`; already downloaded copies cannot be remotely revoked.

## Investigation deletion and retention

Sync deletion is reversible: only a current, active human investigation owner can delete or restore a folder, even when the caller has a server administrator role. The server retains the folder's children, attachments and memberships while it is soft-deleted, but ordinary child reads and writes are denied. Clients receive minimal identity/revision tombstones without copied evidence bodies. Restoring the folder republishes its live children; independently deleted children are not restored. Restoration produces new sync revisions and may therefore require review of older queued edits.

The owner `DELETE /api/investigations/:id` and administrative `DELETE /admin/api/investigations/:id/content` endpoints are **permanent purges**, not reversible sync deletion. The administrative operation rechecks the active admin account and exact current investigation name inside the transaction. Both paths remove the same scoped entity, evidence, membership and file references; managed files are removed only after database commit. Failed file cleanup is reported as pending and leaves recoverable orphaned bytes for storage reconciliation. Legacy unscoped replies are removed with their investigation; foreign-investigation posts retain their content and have references to removed posts detached. A reply tree larger than 10,000 posts fails closed without partial deletion and requires administrator review.

Tombstone retention defaults to 90 days. Expired folder tombstones are purged together with retained children and attachments; a folder restored before the retention transaction is not purged. Independently deleted evidence participates in the same tombstone retention policy.

Malformed legacy feed threads whose parent or reply target cannot establish a live, authorized scope are hidden and require administrator review. The server does not repair these records by granting access or treating a missing investigation as public.

Deletion is not device erasure or export revocation. Connected clients lose their investigation subscription, but permanently purged memberships no longer authorize later cursor pulls. An offline former member may retain an old local copy; previously downloaded files, backups and exports cannot be remotely erased. Follow your endpoint and backup retention procedures separately. The sync log retains historical records for ordered synchronization; soft deletion is not immediate erasure of that history.

## Closed registration

The existing `invite` configuration now means closed self-registration. A legacy email allowlist is not proof of mailbox possession and cannot authorize registration. Administrators can create accounts through the Users tab or authenticated `POST /admin/api/users`, then deliver credentials through a trusted out-of-band channel. Users should change that password after first login. Legacy allowlist entries remain removable reference metadata only. A verified one-time invitation flow is not implemented; no invitation email is sent or implied.

## TAXII projection

The read-only TAXII endpoint exposes current live IOC objects and visible intra-investigation relationships, not historical versions, manifests, writes, or synthetic STIX bundles/reports. Follow envelope `more`/`next`; pages contain at most 500 objects and database scans are bounded. Every page checks current membership. Deleted investigations and deleted/trashed/archived IOCs are excluded. Local-only investigations remain client-side and are never server collections.

`added_after` uses the latest server-recorded IOC update time, with deterministic continuation offsets for multiple objects from one IOC. Full collection refresh is required to reconcile removals or changed relationship targets; this endpoint is not an append-only historical TAXII archive. Match filters apply to currently retained versions only. Unknown/custom classifications remain statement markings. Canonical TLP 2.0 IDs reference the OASIS common objects without inventing replacement definitions; original imported granular marking restrictions are conservatively preserved at whole-object scope.
