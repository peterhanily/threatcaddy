CREATE INDEX IF NOT EXISTS "idx_notes_created_by" ON "notes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_created_by" ON "tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_folders_created_by" ON "folders" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tags_created_by" ON "tags" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timeline_events_created_by" ON "timeline_events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timelines_created_by" ON "timelines" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whiteboards_created_by" ON "whiteboards" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_standalone_iocs_created_by" ON "standalone_iocs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_threads_created_by" ON "chat_threads" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reactions_user_id" ON "reactions" USING btree ("user_id");
