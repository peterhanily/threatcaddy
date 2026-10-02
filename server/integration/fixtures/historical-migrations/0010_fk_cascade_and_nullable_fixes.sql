-- Fix FK cascades: ensure user deletion doesn't break entity tables
-- Make createdBy/updatedBy nullable with ON DELETE SET NULL

-- Notes
ALTER TABLE "notes" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "notes" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_created_by_users_id_fk";
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_updated_by_users_id_fk";
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Tasks
ALTER TABLE "tasks" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "tasks" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_created_by_users_id_fk";
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_updated_by_users_id_fk";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Folders
ALTER TABLE "folders" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "folders" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "folders" DROP CONSTRAINT IF EXISTS "folders_created_by_users_id_fk";
ALTER TABLE "folders" DROP CONSTRAINT IF EXISTS "folders_updated_by_users_id_fk";
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "folders" ADD CONSTRAINT "folders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Tags
ALTER TABLE "tags" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "tags" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_created_by_users_id_fk";
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_updated_by_users_id_fk";
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "tags" ADD CONSTRAINT "tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Timeline Events
ALTER TABLE "timeline_events" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "timeline_events" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "timeline_events" DROP CONSTRAINT IF EXISTS "timeline_events_created_by_users_id_fk";
ALTER TABLE "timeline_events" DROP CONSTRAINT IF EXISTS "timeline_events_updated_by_users_id_fk";
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Timelines
ALTER TABLE "timelines" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "timelines" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "timelines" DROP CONSTRAINT IF EXISTS "timelines_created_by_users_id_fk";
ALTER TABLE "timelines" DROP CONSTRAINT IF EXISTS "timelines_updated_by_users_id_fk";
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Whiteboards
ALTER TABLE "whiteboards" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "whiteboards" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "whiteboards" DROP CONSTRAINT IF EXISTS "whiteboards_created_by_users_id_fk";
ALTER TABLE "whiteboards" DROP CONSTRAINT IF EXISTS "whiteboards_updated_by_users_id_fk";
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Standalone IOCs
ALTER TABLE "standalone_iocs" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "standalone_iocs" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "standalone_iocs" DROP CONSTRAINT IF EXISTS "standalone_iocs_created_by_users_id_fk";
ALTER TABLE "standalone_iocs" DROP CONSTRAINT IF EXISTS "standalone_iocs_updated_by_users_id_fk";
ALTER TABLE "standalone_iocs" ADD CONSTRAINT "standalone_iocs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "standalone_iocs" ADD CONSTRAINT "standalone_iocs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Chat Threads
ALTER TABLE "chat_threads" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "chat_threads" ALTER COLUMN "updated_by" DROP NOT NULL;
ALTER TABLE "chat_threads" DROP CONSTRAINT IF EXISTS "chat_threads_created_by_users_id_fk";
ALTER TABLE "chat_threads" DROP CONSTRAINT IF EXISTS "chat_threads_updated_by_users_id_fk";
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;

-- Posts: cascade delete when user is deleted
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_author_id_users_id_fk";
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Files: cascade delete when user is deleted
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_uploaded_by_users_id_fk";
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE;

-- Activity log: make userId nullable, set null on user deletion
ALTER TABLE "activity_log" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "activity_log" DROP CONSTRAINT IF EXISTS "activity_log_user_id_users_id_fk";
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- Notifications: fix cascade for source_user_id and post_id
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_source_user_id_users_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_post_id_posts_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;
