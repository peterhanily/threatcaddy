CREATE TABLE IF NOT EXISTS sync_clock (
  id integer PRIMARY KEY,
  cursor bigint NOT NULL DEFAULT 0,
  CONSTRAINT sync_clock_singleton CHECK (id = 1)
);
--> statement-breakpoint
INSERT INTO sync_clock (id, cursor) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sync_changes (
  cursor bigint PRIMARY KEY,
  table_name text NOT NULL,
  entity_id text NOT NULL,
  folder_id text,
  previous_folder_id text,
  op text NOT NULL CHECK (op IN ('put', 'delete')),
  record jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_changes_folder_cursor ON sync_changes (folder_id, cursor);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_changes_previous_folder_cursor ON sync_changes (previous_folder_id, cursor);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_lock_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Acquire before row writes; holding this lock through commit prevents a
  -- later cursor from becoming visible while an earlier writer is uncommitted.
  PERFORM cursor FROM sync_clock WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sync clock is missing'; END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_cursor bigint;
  row_data jsonb;
  old_data jsonb;
  scope_id text;
  previous_scope_id text;
  operation text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := jsonb_set(to_jsonb(OLD), '{version}', to_jsonb(OLD.version + 1));
    operation := 'delete';
  ELSE
    row_data := to_jsonb(NEW);
    operation := CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'put' END;
  END IF;
  scope_id := CASE WHEN TG_TABLE_NAME = 'folders' THEN row_data->>'id' ELSE row_data->>'folder_id' END;
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    previous_scope_id := CASE WHEN TG_TABLE_NAME = 'folders' THEN old_data->>'id' ELSE old_data->>'folder_id' END;
    IF previous_scope_id IS NOT DISTINCT FROM scope_id THEN previous_scope_id := NULL; END IF;
  END IF;
  UPDATE sync_clock SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor INTO next_cursor;
  INSERT INTO sync_changes (cursor, table_name, entity_id, folder_id, previous_folder_id, op, record)
    VALUES (next_cursor, TG_ARGV[0], row_data->>'id', scope_id, previous_scope_id, operation, row_data);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  mapping record;
  item record;
  next_cursor bigint;
  scope_id text;
BEGIN
  PERFORM cursor FROM sync_clock WHERE id = 1 FOR UPDATE;
  FOR mapping IN SELECT * FROM (VALUES
    ('notes', 'notes'), ('tasks', 'tasks'), ('folders', 'folders'),
    ('tags', 'tags'), ('timeline_events', 'timelineEvents'), ('timelines', 'timelines'),
    ('whiteboards', 'whiteboards'), ('standalone_iocs', 'standaloneIOCs'), ('chat_threads', 'chatThreads')
  ) AS tables(db_name, api_name)
  LOOP
    -- Prevent a concurrent pre-migration writer from being lost during backfill.
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', mapping.db_name);
    FOR item IN EXECUTE format('SELECT to_jsonb(t) AS data FROM %I t ORDER BY id', mapping.db_name)
    LOOP
      UPDATE sync_clock SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor INTO next_cursor;
      scope_id := CASE WHEN mapping.db_name = 'folders' THEN item.data->>'id' ELSE item.data->>'folder_id' END;
      INSERT INTO sync_changes (cursor, table_name, entity_id, folder_id, op, record)
        VALUES (next_cursor, mapping.api_name, item.data->>'id', scope_id,
          CASE WHEN item.data->>'deleted_at' IS NOT NULL THEN 'delete' ELSE 'put' END, item.data);
    END LOOP;
    EXECUTE format('CREATE TRIGGER sync_lock_writes BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION sync_lock_writes()', mapping.db_name);
    EXECUTE format('CREATE TRIGGER sync_revision BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_revision()', mapping.db_name);
    EXECUTE format('CREATE TRIGGER sync_record_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_record_change(%L)', mapping.db_name, mapping.api_name);
  END LOOP;
END;
$$;
