CREATE TABLE IF NOT EXISTS "backups" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text DEFAULT 'full' NOT NULL,
  "scope" text DEFAULT 'all' NOT NULL,
  "scope_id" text,
  "entity_count" integer DEFAULT 0 NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "storage_path" text NOT NULL,
  "parent_backup_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_backups_user_id" ON "backups" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_backups_created_at" ON "backups" USING btree ("created_at");
