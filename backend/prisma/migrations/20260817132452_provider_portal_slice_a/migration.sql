-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PROVIDER';

-- AlterTable
ALTER TABLE "education_providers" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "provider_scholarships" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "provider_tuitions" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "education_providers_userId_key" ON "education_providers"("userId");

-- AddForeignKey
ALTER TABLE "education_providers" ADD CONSTRAINT "education_providers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Backfill ────────────────────────────────────────────────────────────────
--
-- SCHOLARSHIPS: every row that exists at this moment predates the review gate.
-- They were entered by staff under the old standard, where `isActive` was the
-- only switch, so they are already "approved" in every sense except the column
-- that did not exist yet. Marking them APPROVED keeps them exactly as visible as
-- they were a second ago; leaving them PENDING would silently blank pricing that
-- has been live.
--
-- This is safe to write as an unqualified UPDATE precisely because it runs ONCE,
-- atomically, in the same migration that adds the column: "every row right now"
-- and "every row that predates the gate" are the same set. Anything inserted
-- after this statement gets the PENDING default.
--
-- Counts at authoring time — dev 297 scholarships (198 active), production 0.
UPDATE "provider_scholarships" SET "reviewStatus" = 'APPROVED';

-- TUITION: deliberately NOT backfilled.
--
-- Both dev and production hold ZERO tuition rows, so there is nothing that could
-- be made invisible and nothing to grandfather. Writing a blanket APPROVED here
-- would set a precedent for a table whose first real rows should be reviewed —
-- and if this migration is ever replayed against a database that DOES have
-- tuition, the safe default is the one that hides a price, not the one that
-- publishes it unreviewed.
