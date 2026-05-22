-- PR-WIX-1 — Lead-capture webhook signal columns on `leads`.
--
-- All four columns nullable because existing leads pre-date the
-- webhook. Required-at-create is enforced by the webhook DTO, not
-- the column.

ALTER TABLE "leads" ADD COLUMN "currentEducationLevel" TEXT;
ALTER TABLE "leads" ADD COLUMN "externalSubmissionId"  TEXT;
ALTER TABLE "leads" ADD COLUMN "countryRaw"            TEXT;
ALTER TABLE "leads" ADD COLUMN "webhookMetadata"       JSONB;

-- Unique on the dedupe key so two retries for the same submission
-- can't double-create. Partial-ish via the NULL handling — Postgres
-- treats NULLs as distinct in UNIQUE indexes by default, so old
-- rows (NULL externalSubmissionId) don't clash with each other.
CREATE UNIQUE INDEX "leads_externalSubmissionId_key"
  ON "leads"("externalSubmissionId");
