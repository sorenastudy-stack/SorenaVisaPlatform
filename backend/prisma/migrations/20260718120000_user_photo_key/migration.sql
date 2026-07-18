-- PR-STAFF-PHOTOS — add a nullable R2 object-key column for staff profile photos.
-- Additive + nullable + no backfill → safe on a live table, instantly reversible
-- (DROP COLUMN). Applies automatically via the pre-deploy `prisma migrate deploy`.
ALTER TABLE "users" ADD COLUMN "photoKey" TEXT;
