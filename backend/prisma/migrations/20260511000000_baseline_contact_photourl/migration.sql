-- Baseline migration: records the previously-drifted Contact.photoUrl column.
-- The column was added via `prisma db push` during the student portal scaffold
-- (commit 855fda5 — "feat(student): scaffold Student portal ...") but the
-- corresponding migration.sql (20260430_add_student_portal_models) omitted the
-- ALTER TABLE for `contacts.photoUrl`. This migration captures it.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so it is safe on environments
-- where the column already exists (dev) and on fresh environments (CI/prod).
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
