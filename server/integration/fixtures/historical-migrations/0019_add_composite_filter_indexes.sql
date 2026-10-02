-- Composite indexes for common filter combinations used by list queries.
-- These are CREATE INDEX IF NOT EXISTS so they are safe to re-run.

-- Notes: list queries filter by trashed + archived
CREATE INDEX IF NOT EXISTS "idx_notes_trashed_archived" ON "notes" ("trashed", "archived");

-- Tasks: list queries filter by folder + status, and trashed + archived
CREATE INDEX IF NOT EXISTS "idx_tasks_folder_id_status" ON "tasks" ("folder_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tasks_trashed_archived" ON "tasks" ("trashed", "archived");

-- Timeline events: list queries filter by trashed + archived
CREATE INDEX IF NOT EXISTS "idx_timeline_events_trashed_archived" ON "timeline_events" ("trashed", "archived");
