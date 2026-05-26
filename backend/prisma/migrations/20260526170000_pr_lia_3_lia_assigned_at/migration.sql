-- PR-LIA-3 — Track when the LIA was assigned for time-to-action /
-- time-to-resolution metrics in the productivity report.
--
-- Both write paths (assignLiaToCase + manualReassign) populate this
-- column in the same transaction that touches `liaId`. NULL when no
-- LIA is assigned.

ALTER TABLE "cases" ADD COLUMN "liaAssignedAt" TIMESTAMP(3);

-- Idempotent one-off backfill: any case that already has an LIA
-- attached (from PR-LIA-2 auto-assignment) gets a synthetic
-- liaAssignedAt = createdAt. The "IS NULL" guard makes this safe to
-- re-run — only rows without a value are touched.
UPDATE "cases"
   SET "liaAssignedAt" = "createdAt"
 WHERE "liaId" IS NOT NULL
   AND "liaAssignedAt" IS NULL;
