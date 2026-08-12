-- PR-COMMISSION-ANCHOR — a commission is earned on a programme choice, not an
-- `Application`.
--
-- `Application` has never held a row in production and nothing in the admission
-- flow writes to it; the live pipeline is AdmissionApplication →
-- AdmissionProgrammeChoice → SubmissionRecord / OfferRecord. The Commission
-- anchor moves to where the work actually happens.
--
-- The `Application` model and its table are deliberately LEFT IN PLACE: several
-- services still read them (case documents, SLA, dashboard, subscriptions,
-- students) and the LIA case pages render them. Only the Commission link moves.

-- Fail closed rather than lose links.
--
-- The generated form of this migration was a bare DROP COLUMN + ADD COLUMN NOT
-- NULL, which silently discards every commission's application link and then
-- fails on any non-empty table anyway. There are zero commission rows today, so
-- there is nothing to map — but "there is nothing to map" is a fact about right
-- now, and a migration that quietly destroys links if that changes is not one
-- worth keeping. If a row exists, stop and make someone decide.
DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM "commissions";
  IF n > 0 THEN
    RAISE EXCEPTION
      'commissions is not empty (% row(s)). This migration re-anchors commissions from applications to admission_programme_choices and cannot infer the mapping. Backfill programmeChoiceId first, then re-run.', n;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_applicationId_fkey";

-- DropIndex
DROP INDEX "commissions_applicationId_key";

-- AlterTable
ALTER TABLE "commissions" DROP COLUMN "applicationId",
ADD COLUMN     "programmeChoiceId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "commissions_programmeChoiceId_key" ON "commissions"("programmeChoiceId");

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_programmeChoiceId_fkey" FOREIGN KEY ("programmeChoiceId") REFERENCES "admission_programme_choices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
