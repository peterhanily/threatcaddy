# Bot credential upgrade and exposure review

The server requires a stable `BOT_MASTER_KEY` in every environment before startup or persistent secret encryption. New installations should generate 32 random bytes encoded as 64 hexadecimal characters and retain the value in their deployment secret store and protected recovery material.

Existing installations may retain their existing configured key if it contains 32–1024 characters without surrounding whitespace. **Do not replace a working legacy key merely to make it hexadecimal.** Key derivation uses the original string bytes; changing them makes existing `enc:` and `enc2:` ciphertext unreadable. Changing the environment while the process is running is rejected.

Before upgrading, preserve a verified database backup and the exact existing configured master key together through separate protected recovery channels. Confirm restore and credential decryption in an isolated environment with access appropriate for those secrets. Never paste the master key, stored configuration, or decrypted credentials into an issue, log, chat, or support transcript.

The previous implementation could persist `privateKey`, `passphrase`, and credential fields inside arrays in plaintext, and return those fields through bot configuration APIs. The repaired serializers mask these fields immediately. Saving a configuration through the bot update service encrypts retained legacy plaintext values as well as new values. No automatic rewrite of every stored configuration occurs on startup.

For an operator-controlled exposure review, `findPlaintextSecretPaths(config)` in `src/bots/secret-store.ts` returns **field paths only**, such as `hosts[0].privateKey`. Inspect a protected database snapshot or an explicitly authorized read-only connection, record the affected bot identifiers and field paths, and keep raw values out of the report. Review who could access bot list/detail endpoints, administrative exports, backups and logs while the affected configuration existed. Absence of plaintext today does not establish that the credential was never exposed.

Rotate credentials determined to have been exposed through their issuing service or host, then update the saved bot configuration and verify it survives a server restart. Coordinate SSH key replacement with the host administrator and preserve a working recovery access path. This implementation does not inspect deployed credentials, infer exposure from synthetic tests, or claim that any external credential has been rotated.

If encrypted credentials cannot be decrypted, first restore the exact master key from the matching recovery material. A missing-key installation previously generated an ephemeral in-memory key; after that key is lost, ciphertext cannot be recovered by generating another key. Replace affected service credentials through their issuer and re-enter them after a stable master key is configured. Do not bulk-delete or overwrite ciphertext while investigating.

Master-key rotation is a separate offline maintenance operation: stop writers, preserve verified recovery material, decrypt using the old key and re-encrypt with the new key in an isolated trusted process, validate every affected record, and atomically install the transformed data and new key. No master-key rotation command is supplied by this change.

## Saved local AI provider keys

Newly entered or explicitly replaced local-provider API keys in the admin AI settings use the existing master-key encryption format. Keep the exact, stable `BOT_MASTER_KEY` in protected backup material; encrypted keys cannot be recovered by generating a replacement master key. Invalid or undecryptable ciphertext fails closed rather than being used as an API key.

Existing plaintext keys remain readable and are **not automatically migrated** on startup, read, or unrelated settings saves. To convert an existing key, re-enter its actual value in the admin AI settings and save it; leaving the masked value unchanged does not convert it. Saving an empty key explicitly clears it. Previous database backups remain unchanged and must still be protected. This upgrade does not perform or verify a migration of a deployed installation.

## Webhook ownership and handoff availability

Set `WEBHOOK_INGEST_OWNER_ID` to an existing active analyst or administrator account when enabling `WEBHOOK_INGEST_SECRET`. New investigations receive that account as creator and owner in the same transaction as the alert. Existing investigations require that account to retain editor access. Inactive users, viewers and internal bot accounts cannot serve as recipients. Existing ownerless investigations require an administrator to review and assign ownership; the upgrade does not guess an owner.

Server-side AgentCaddy handoff remains unavailable until durable approvals and exact client/server tool policies are implemented. Registration stores disabled deployment metadata only and reports `serverExecutionAvailable: false`. Heartbeat and manual-trigger endpoints return an unavailable response; neither enables execution. Persisted handoff bots and configurations carrying unsupported policy fields cannot load into the server runtime. Ordinary bot configurations retain their existing behavior.
