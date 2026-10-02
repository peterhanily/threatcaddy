-- Drop FK on activity_log.user_id so admin_users IDs can be stored for non-repudiation
ALTER TABLE "activity_log" DROP CONSTRAINT IF EXISTS "activity_log_user_id_users_id_fk";

-- Hide sentinel user from Users tab by moving to filtered domain
UPDATE "users" SET "email" = 'system@threatcaddy.internal' WHERE "id" = '__system_admin__';
