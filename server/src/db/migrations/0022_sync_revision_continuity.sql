-- Keep entity revisions monotonic even after physical cleanup and recreation.
-- The same writer clock serializes this upgrade with normal synced mutations.
SELECT cursor FROM sync_clock WHERE id = 1 FOR UPDATE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_changes_entity_cursor ON sync_changes (table_name, entity_id, cursor);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_version integer;
  api_table text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    api_table := CASE TG_TABLE_NAME
      WHEN 'timeline_events' THEN 'timelineEvents'
      WHEN 'standalone_iocs' THEN 'standaloneIOCs'
      WHEN 'chat_threads' THEN 'chatThreads'
      ELSE TG_TABLE_NAME
    END;
    SELECT max((record->>'version')::integer) INTO previous_version
      FROM sync_changes WHERE table_name = api_table AND entity_id = NEW.id;
    NEW.version := COALESCE(previous_version, 0) + 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
