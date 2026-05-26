-- PR-LIA-2 — Per-Case LIA assignment + forward-compat country specialisation.
--
-- One new nullable FK on cases (`liaId`) for the auto-picked /
-- manually-reassigned Legal & Immigration Adviser. NULL until the
-- client signs the contract (or if no active LIA was available at
-- sign time). SetNull on the LIA's user-row delete so case history
-- survives staff hard-deletes — the PR-CONSULT-4 audit-snapshot
-- pattern preserves attribution.
--
-- One new array column on users (`specialisedCountries`) for a future
-- country-aware router (PR-LIA-2.1). Empty array = "general"; the
-- PR-LIA-2 auto-assignment doesn't read it yet, but the column exists
-- so the future PR can populate it without another migration.

ALTER TABLE "cases" ADD COLUMN "liaId" TEXT;

CREATE INDEX "cases_liaId_idx" ON "cases"("liaId");

ALTER TABLE "cases" ADD CONSTRAINT "cases_liaId_fkey"
  FOREIGN KEY ("liaId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "specialisedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
