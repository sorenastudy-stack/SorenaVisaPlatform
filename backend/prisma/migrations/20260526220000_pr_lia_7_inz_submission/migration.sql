-- PR-LIA-7 — INZ submission lifecycle.
--
-- 1. New CaseStage value: INZ_SUBMITTED (between VISA and COMPLETED).
-- 2. Seven new columns on `cases` capturing the submission details +
--    payment-receipt file metadata.
-- 3. Index on inzApplicationNumber for "find case by INZ reference"
--    lookups from staff tooling.
--
-- Postgres 12+ allows `ALTER TYPE ... ADD VALUE` inside a transaction
-- as long as the new value isn't *used* in the same transaction.
-- None of our other statements reference INZ_SUBMITTED, so a single
-- migration is safe.

-- 1. Extend the enum. Placed between VISA and COMPLETED to preserve
--    the logical workflow order in psql `\dT+ CaseStage` output.
ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'INZ_SUBMITTED' BEFORE 'COMPLETED';

-- 2. Submission state columns. All nullable — pre-PR-LIA-7 cases have
--    inzSubmittedAt = NULL and remain in the VISA stage until an LIA
--    submits. The four receipt-metadata fields are co-managed with
--    inzReceiptFileUrl: either all populated or all NULL.
ALTER TABLE "cases" ADD COLUMN "inzApplicationNumber" VARCHAR(128);
ALTER TABLE "cases" ADD COLUMN "inzSubmittedAt"       TIMESTAMP(3);
ALTER TABLE "cases" ADD COLUMN "inzSubmissionNotes"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptFileUrl"    TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptFileName"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptMimeType"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptSizeBytes"  INTEGER;

-- 3. Lookup index on the INZ reference number. Non-unique on purpose
--    (see schema comment for rationale).
CREATE INDEX "cases_inzApplicationNumber_idx"
  ON "cases"("inzApplicationNumber");
