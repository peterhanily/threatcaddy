ALTER TABLE posts RENAME COLUMN images TO attachments;
ALTER TABLE posts ADD COLUMN reply_to_id TEXT;
