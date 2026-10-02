-- Bot system: bot_configs and bot_runs tables

CREATE TABLE IF NOT EXISTS "bot_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT false,
  "triggers" jsonb NOT NULL DEFAULT '{}',
  "config" jsonb NOT NULL DEFAULT '{}',
  "capabilities" jsonb NOT NULL DEFAULT '[]',
  "allowed_domains" jsonb NOT NULL DEFAULT '[]',
  "scope_type" text NOT NULL DEFAULT 'investigation',
  "scope_folder_ids" jsonb NOT NULL DEFAULT '[]',
  "rate_limit_per_hour" integer NOT NULL DEFAULT 100,
  "rate_limit_per_day" integer NOT NULL DEFAULT 1000,
  "last_run_at" timestamp with time zone,
  "last_error" text,
  "run_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "bot_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "bot_config_id" text NOT NULL REFERENCES "bot_configs"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "trigger" text NOT NULL,
  "input_summary" text NOT NULL DEFAULT '',
  "output_summary" text NOT NULL DEFAULT '',
  "duration_ms" integer NOT NULL DEFAULT 0,
  "error" text,
  "entities_created" integer NOT NULL DEFAULT 0,
  "entities_updated" integer NOT NULL DEFAULT 0,
  "api_calls_made" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_bot_configs_user_id" ON "bot_configs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_bot_configs_enabled" ON "bot_configs" ("enabled");
CREATE INDEX IF NOT EXISTS "idx_bot_configs_type" ON "bot_configs" ("type");
CREATE INDEX IF NOT EXISTS "idx_bot_runs_bot_config_id" ON "bot_runs" ("bot_config_id");
CREATE INDEX IF NOT EXISTS "idx_bot_runs_status" ON "bot_runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_bot_runs_created_at" ON "bot_runs" ("created_at");
