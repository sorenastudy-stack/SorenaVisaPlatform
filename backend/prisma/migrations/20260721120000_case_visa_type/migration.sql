-- PR-CONTRACT-CAPTURE — visa type captured from the signed engagement contract.
-- Additive + nullable + no backfill → safe on a live table, instantly reversible
-- (DROP COLUMN). Populated by the DocuSign webhook on envelope completion.
ALTER TABLE "cases" ADD COLUMN "visaType" TEXT;
