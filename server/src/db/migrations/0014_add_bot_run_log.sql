-- Add execution log JSONB column to bot_runs for run detail viewer
ALTER TABLE "bot_runs" ADD COLUMN IF NOT EXISTS "log" jsonb DEFAULT '[]'::jsonb;
