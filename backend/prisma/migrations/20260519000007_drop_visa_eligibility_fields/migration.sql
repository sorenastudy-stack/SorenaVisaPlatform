-- Visa Section — INZ 1200 rebuild, PR-VISA3 fixes.
-- Drops three columns added by 20260519000006:
--   * agentSamePersonSubmitting   — question deleted per smoke-test feedback
--   * agentGaveImmigrationAdvice  — question deleted per smoke-test feedback
--   * tuitionPaymentMode          — question moves to a later INZ section
--                                   (Supporting Documents); a fresh column
--                                   will be reintroduced there.
--
-- Smoke-test data on these columns is acceptable to lose — the visa form
-- is pre-launch and the only data in the DB is from the test student.

ALTER TABLE "visa_applications"
  DROP COLUMN IF EXISTS "agentSamePersonSubmitting",
  DROP COLUMN IF EXISTS "agentGaveImmigrationAdvice",
  DROP COLUMN IF EXISTS "tuitionPaymentMode";
