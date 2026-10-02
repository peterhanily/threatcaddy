-- Forward completion of runtime schema omitted from the original migration set.
-- Historical SQL and timestamps remain unchanged; migrateDatabase repairs their
-- verified missing suffix before applying this migration.
ALTER TABLE "whiteboards" ADD COLUMN "cls_level" text;
ALTER TABLE "chat_threads" ADD COLUMN "cls_level" text;
ALTER TABLE "posts" ADD COLUMN "cls_level" text;
ALTER TABLE "bot_configs" ADD COLUMN "source_type" text NOT NULL DEFAULT 'manual';
ALTER TABLE "bot_configs" ADD COLUMN "source_deployment_id" text;
--> statement-breakpoint
ALTER TABLE "investigation_members" ADD CONSTRAINT "investigation_members_folder_id_folders_id_fk"
  FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "idx_bot_configs_source_type" ON "bot_configs" ("source_type");
CREATE INDEX "idx_bot_runs_config_created" ON "bot_runs" ("bot_config_id", "created_at");
CREATE INDEX "idx_notes_folder_id_updated_at" ON "notes" ("folder_id", "updated_at");
CREATE INDEX "idx_tasks_folder_id_updated_at" ON "tasks" ("folder_id", "updated_at");
CREATE INDEX "idx_timeline_events_folder_id_updated_at" ON "timeline_events" ("folder_id", "updated_at");
CREATE INDEX "idx_whiteboards_folder_id_updated_at" ON "whiteboards" ("folder_id", "updated_at");
CREATE INDEX "idx_standalone_iocs_folder_id_updated_at" ON "standalone_iocs" ("folder_id", "updated_at");
CREATE INDEX "idx_chat_threads_folder_id_updated_at" ON "chat_threads" ("folder_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "llm_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "estimated_cost_micros" integer NOT NULL DEFAULT 0,
  "latency_ms" integer,
  "thread_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_llm_usage_user_id" ON "llm_usage" ("user_id");
CREATE INDEX "idx_llm_usage_created_at" ON "llm_usage" ("created_at");
CREATE INDEX "idx_llm_usage_provider" ON "llm_usage" ("provider");
--> statement-breakpoint
CREATE TABLE "user_llm_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "encrypted_key" text NOT NULL,
  "label" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "unique_user_provider" UNIQUE ("user_id", "provider")
);
--> statement-breakpoint
CREATE TABLE "agent_heartbeats" (
  "folder_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_beat" timestamptz NOT NULL DEFAULT now(),
  "server_takeover_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "investigation_id" text NOT NULL,
  "bot_config_id" text REFERENCES "bot_configs"("id") ON DELETE SET NULL,
  "deployment_source_id" text,
  "thread_id" text,
  "tool_name" text NOT NULL,
  "tool_input" jsonb NOT NULL DEFAULT '{}',
  "rationale" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'pending',
  "result_summary" text,
  "severity" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "executed_at" timestamptz,
  "reviewed_at" timestamptz,
  "reviewed_by" text,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_agent_actions_investigation" ON "agent_actions" ("investigation_id");
CREATE INDEX "idx_agent_actions_status" ON "agent_actions" ("status");
CREATE INDEX "idx_agent_actions_inv_status" ON "agent_actions" ("investigation_id", "status");
