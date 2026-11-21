CREATE TABLE IF NOT EXISTS identities (
  id text PRIMARY KEY, folder_id text,
  type text NOT NULL, name text NOT NULL, description text,
  aliases jsonb NOT NULL DEFAULT '[]', status text, contact boolean,
  details jsonb NOT NULL DEFAULT '[]', connections jsonb NOT NULL DEFAULT '[]',
  tags jsonb NOT NULL DEFAULT '[]', cls_level text,
  trashed boolean NOT NULL DEFAULT false, trashed_at timestamp with time zone,
  archived boolean NOT NULL DEFAULT false, deleted_at timestamp with time zone,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_identities_folder_id ON identities (folder_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_identities_updated_at ON identities (updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_identities_created_by ON identities (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_identities_folder_updated_at ON identities (folder_id, updated_at);
--> statement-breakpoint
DO $$
DECLARE item record; next_cursor bigint;
BEGIN
  PERFORM cursor FROM sync_clock WHERE id = 1 FOR UPDATE;
  LOCK TABLE identities IN SHARE ROW EXCLUSIVE MODE;
  FOR item IN SELECT to_jsonb(t) AS data FROM identities t ORDER BY id LOOP
    UPDATE sync_clock SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor INTO next_cursor;
    INSERT INTO sync_changes (cursor, table_name, entity_id, folder_id, op, record)
      VALUES (next_cursor, 'identities', item.data->>'id', item.data->>'folder_id',
        CASE WHEN item.data->>'deleted_at' IS NOT NULL THEN 'delete' ELSE 'put' END, item.data);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_lock_writes BEFORE INSERT OR UPDATE OR DELETE ON identities FOR EACH STATEMENT EXECUTE FUNCTION sync_lock_writes();
--> statement-breakpoint
CREATE TRIGGER sync_revision BEFORE INSERT OR UPDATE ON identities FOR EACH ROW EXECUTE FUNCTION sync_revision();
--> statement-breakpoint
CREATE TRIGGER sync_record_change AFTER INSERT OR UPDATE OR DELETE ON identities FOR EACH ROW EXECUTE FUNCTION sync_record_change('identities');
