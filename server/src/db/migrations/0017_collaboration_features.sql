-- Collaboration features: entity comments, IOC assignment, saved searches

-- Add comments (jsonb) and assignee fields to standalone_iocs
ALTER TABLE "standalone_iocs" ADD COLUMN IF NOT EXISTS "comments" jsonb DEFAULT '[]';
ALTER TABLE "standalone_iocs" ADD COLUMN IF NOT EXISTS "assignee_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "standalone_iocs" ADD COLUMN IF NOT EXISTS "assignee_name" text;
CREATE INDEX IF NOT EXISTS "idx_standalone_iocs_assignee_id" ON "standalone_iocs" ("assignee_id");

-- Add comments (jsonb) to timeline_events
ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "comments" jsonb DEFAULT '[]';

-- Saved searches table
CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "query" text NOT NULL,
  "filters" jsonb NOT NULL DEFAULT '{}',
  "is_shared" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_saved_searches_user_id" ON "saved_searches" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_saved_searches_is_shared" ON "saved_searches" ("is_shared");
CREATE INDEX IF NOT EXISTS "idx_saved_searches_created_at" ON "saved_searches" ("created_at");
