CREATE INDEX IF NOT EXISTS "idx_notes_archived" ON "notes" USING btree ("archived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notes_pinned" ON "notes" USING btree ("pinned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_status" ON "tasks" USING btree ("status");
