-- Returning applicants keep one canonical Lead while every completed
-- Scorecard attempt remains a separate scorecard_submissions row.
--
-- Forward migration: replace the historical one-to-one unique index with a
-- normal lookup index. No rows are rewritten or deleted.
--
-- This repository has documented migration-history drift. Do not use
-- `prisma migrate dev` or `prisma db push`. After explicit rollout approval:
-- backup -> validate on an isolated database -> execute this SQL -> verify the
-- index/constraint state -> mark this migration applied -> deploy -> smoke test.
-- Never mark it applied before the SQL and object-level verification succeed.
--
-- Execute with:
--   prisma db execute --file prisma/migrations/20260822060000_scorecard_repeat_submissions/migration.sql --schema prisma/schema.prisma
-- Then register with:
--   prisma migrate resolve --applied 20260822060000_scorecard_repeat_submissions
ALTER TABLE "scorecard_submissions"
  DROP CONSTRAINT IF EXISTS "scorecard_submissions_leadId_key";

DROP INDEX IF EXISTS "scorecard_submissions_leadId_key";

CREATE INDEX IF NOT EXISTS "scorecard_submissions_leadId_idx"
  ON "scorecard_submissions"("leadId");

-- Controlled rollback (manual only): first verify the query below returns
-- zero rows, then drop the normal index and recreate the unique index.
--
-- SELECT "leadId", COUNT(*)
-- FROM "scorecard_submissions"
-- WHERE "leadId" IS NOT NULL
-- GROUP BY "leadId"
-- HAVING COUNT(*) > 1;
--
-- DROP INDEX IF EXISTS "scorecard_submissions_leadId_idx";
-- CREATE UNIQUE INDEX "scorecard_submissions_leadId_key"
--   ON "scorecard_submissions"("leadId");
