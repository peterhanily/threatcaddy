CREATE TABLE "allowed_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
