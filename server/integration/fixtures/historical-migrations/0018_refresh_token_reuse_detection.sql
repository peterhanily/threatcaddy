-- Refresh token reuse detection: add token_family to sessions
-- All tokens in a rotation chain share a family ID. If a rotated-out token
-- is replayed (not found, but family exists with newer token), all sessions
-- in that family are revoked — indicating token theft.

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "token_family" text;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "rotation_counter" integer NOT NULL DEFAULT 0;

-- Index for fast family lookups during reuse detection
CREATE INDEX IF NOT EXISTS "idx_sessions_token_family" ON "sessions" ("token_family");
