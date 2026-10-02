CREATE INDEX IF NOT EXISTS idx_posts_deleted_created_at ON posts (deleted, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_parent_id_deleted ON posts (parent_id, deleted);
