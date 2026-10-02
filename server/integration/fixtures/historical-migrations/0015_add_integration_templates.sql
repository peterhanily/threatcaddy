-- Integration templates: shared integration template definitions

CREATE TABLE IF NOT EXISTS "integration_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "template" jsonb NOT NULL,
  "shared_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_integration_templates_name" ON "integration_templates" ("name");
CREATE INDEX IF NOT EXISTS "idx_integration_templates_shared_by" ON "integration_templates" ("shared_by");
CREATE INDEX IF NOT EXISTS "idx_integration_templates_created_at" ON "integration_templates" ("created_at");
