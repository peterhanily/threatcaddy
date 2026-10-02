-- Add deletedAt tombstone column to all synced entity tables
ALTER TABLE "notes" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "folders" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "tags" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "timeline_events" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "timelines" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "whiteboards" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "standalone_iocs" ADD COLUMN "deleted_at" timestamp with time zone;
ALTER TABLE "chat_threads" ADD COLUMN "deleted_at" timestamp with time zone;

-- Sessions indexes
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");

-- Investigation members indexes
CREATE INDEX IF NOT EXISTS "idx_members_folder_id" ON "investigation_members" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_members_user_id" ON "investigation_members" USING btree ("user_id");

-- Entity table indexes (updatedAt for sync pull, folderId for scoped queries)
CREATE INDEX IF NOT EXISTS "idx_notes_folder_id" ON "notes" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_notes_updated_at" ON "notes" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_tasks_folder_id" ON "tasks" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_tasks_updated_at" ON "tasks" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_folders_updated_at" ON "folders" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_tags_updated_at" ON "tags" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_timeline_events_folder_id" ON "timeline_events" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_timeline_events_updated_at" ON "timeline_events" USING btree ("updated_at");
CREATE INDEX IF NOT EXISTS "idx_timeline_events_timeline_id" ON "timeline_events" USING btree ("timeline_id");

CREATE INDEX IF NOT EXISTS "idx_timelines_updated_at" ON "timelines" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_whiteboards_folder_id" ON "whiteboards" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_whiteboards_updated_at" ON "whiteboards" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_standalone_iocs_folder_id" ON "standalone_iocs" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_standalone_iocs_updated_at" ON "standalone_iocs" USING btree ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_chat_threads_folder_id" ON "chat_threads" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_chat_threads_updated_at" ON "chat_threads" USING btree ("updated_at");

-- Activity log indexes
CREATE INDEX IF NOT EXISTS "idx_activity_log_user_id" ON "activity_log" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_activity_log_timestamp" ON "activity_log" USING btree ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_activity_log_folder_id" ON "activity_log" USING btree ("folder_id");

-- Social feed indexes
CREATE INDEX IF NOT EXISTS "idx_posts_author_id" ON "posts" USING btree ("author_id");
CREATE INDEX IF NOT EXISTS "idx_posts_folder_id" ON "posts" USING btree ("folder_id");
CREATE INDEX IF NOT EXISTS "idx_posts_created_at" ON "posts" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_posts_parent_id" ON "posts" USING btree ("parent_id");
CREATE INDEX IF NOT EXISTS "idx_reactions_post_id" ON "reactions" USING btree ("post_id");

-- Notifications indexes
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_created_at" ON "notifications" USING btree ("created_at");

-- Files indexes
CREATE INDEX IF NOT EXISTS "idx_files_folder_id" ON "files" USING btree ("folder_id");
