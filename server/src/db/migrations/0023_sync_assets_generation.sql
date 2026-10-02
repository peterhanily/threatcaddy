ALTER TABLE sync_clock ADD COLUMN IF NOT EXISTS generation text NOT NULL DEFAULT gen_random_uuid()::text;
--> statement-breakpoint
ALTER TABLE whiteboards ADD COLUMN IF NOT EXISTS files text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS evidence_items (
  id text PRIMARY KEY, title text NOT NULL, folder_id text,
  file_name text NOT NULL, file_type text NOT NULL, mime_type text,
  size bigint NOT NULL DEFAULT 0, last_modified bigint,
  image_width integer, image_height integer, image_aspect_ratio text, image_pixel_count bigint,
  image_data text, image_data_mime_type text, image_analysis text, image_ocr_text text,
  content text NOT NULL DEFAULT '', extraction_status text NOT NULL DEFAULT 'metadata-only',
  extraction_warning text, imported_at bigint NOT NULL,
  chunk_index integer NOT NULL DEFAULT 1, chunk_count integer NOT NULL DEFAULT 1,
  tags jsonb NOT NULL DEFAULT '[]', linked_ioc_ids jsonb NOT NULL DEFAULT '[]', cls_level text,
  trashed boolean NOT NULL DEFAULT false, trashed_at timestamp with time zone,
  archived boolean NOT NULL DEFAULT false, deleted_at timestamp with time zone,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_folder_id ON evidence_items (folder_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_updated_at ON evidence_items (updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_created_by ON evidence_items (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_evidence_folder_updated_at ON evidence_items (folder_id, updated_at);
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
      WHEN 'evidence_items' THEN 'evidenceItems'
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
--> statement-breakpoint
DO $$
DECLARE item record; next_cursor bigint;
BEGIN
  PERFORM cursor FROM sync_clock WHERE id = 1 FOR UPDATE;
  LOCK TABLE evidence_items IN SHARE ROW EXCLUSIVE MODE;
  FOR item IN SELECT to_jsonb(t) AS data FROM evidence_items t ORDER BY id LOOP
    UPDATE sync_clock SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor INTO next_cursor;
    INSERT INTO sync_changes (cursor, table_name, entity_id, folder_id, op, record)
      VALUES (next_cursor, 'evidenceItems', item.data->>'id', item.data->>'folder_id',
        CASE WHEN item.data->>'deleted_at' IS NOT NULL THEN 'delete' ELSE 'put' END, item.data);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_lock_writes BEFORE INSERT OR UPDATE OR DELETE ON evidence_items FOR EACH STATEMENT EXECUTE FUNCTION sync_lock_writes();
--> statement-breakpoint
CREATE TRIGGER sync_revision BEFORE INSERT OR UPDATE ON evidence_items FOR EACH ROW EXECUTE FUNCTION sync_revision();
--> statement-breakpoint
CREATE TRIGGER sync_record_change AFTER INSERT OR UPDATE OR DELETE ON evidence_items FOR EACH ROW EXECUTE FUNCTION sync_record_change('evidenceItems');
