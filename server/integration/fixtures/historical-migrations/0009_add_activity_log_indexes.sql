CREATE INDEX IF NOT EXISTS "idx_activity_log_category" ON "activity_log" USING btree ("category");
CREATE INDEX IF NOT EXISTS "idx_activity_log_action" ON "activity_log" USING btree ("action");
