-- Task assignee column
ALTER TABLE "tasks" ADD COLUMN "assignee_id" text REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_tasks_assignee_id" ON "tasks" ("assignee_id");
