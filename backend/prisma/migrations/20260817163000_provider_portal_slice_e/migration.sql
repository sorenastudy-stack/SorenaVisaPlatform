-- AlterTable
ALTER TABLE "provider_scholarships" ADD COLUMN     "nationalityGroupId" TEXT,
ALTER COLUMN "nationality" DROP NOT NULL;

-- AlterTable
ALTER TABLE "provider_tuitions" ADD COLUMN     "nationalityGroupId" TEXT,
ALTER COLUMN "nationality" DROP NOT NULL;

-- CreateTable
CREATE TABLE "nationality_groups" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nationalities" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nationality_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nationality_groups_providerId_idx" ON "nationality_groups"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "nationality_groups_providerId_name_key" ON "nationality_groups"("providerId", "name");

-- CreateIndex
CREATE INDEX "provider_scholarships_nationalityGroupId_idx" ON "provider_scholarships"("nationalityGroupId");

-- CreateIndex
CREATE INDEX "provider_tuitions_nationalityGroupId_idx" ON "provider_tuitions"("nationalityGroupId");

-- AddForeignKey
ALTER TABLE "provider_scholarships" ADD CONSTRAINT "provider_scholarships_nationalityGroupId_fkey" FOREIGN KEY ("nationalityGroupId") REFERENCES "nationality_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nationality_groups" ADD CONSTRAINT "nationality_groups_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_tuitions" ADD CONSTRAINT "provider_tuitions_nationalityGroupId_fkey" FOREIGN KEY ("nationalityGroupId") REFERENCES "nationality_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- PR-PROVIDER-PORTAL slice E — EXACTLY ONE OF nationality / nationalityGroupId.
--
-- Prisma cannot express a CHECK constraint, so it is added here by hand. It is
-- not belt-and-braces over the service validation — it is the only thing that
-- holds for a row written by a script, a psql session, or a future importer that
-- forgets. `<>` on two booleans is XOR: exactly one side must be NULL.
--
-- Neither set  → a rate that applies to nobody, which the resolver would skip on
--                its way to the flat fee, quoting a student the wrong number
--                without anything looking wrong.
-- Both set     → a rate whose meaning depends on which field the reader checks
--                first, and the two answers are different amounts of money.
--
-- Safe to add without a backfill: every existing row (0 tuition, 297 dev
-- scholarships, 0 prod) has a nationality and no group, which satisfies this.
ALTER TABLE "provider_tuitions"
  ADD CONSTRAINT "provider_tuitions_nationality_xor_group"
  CHECK (("nationality" IS NULL) <> ("nationalityGroupId" IS NULL));

ALTER TABLE "provider_scholarships"
  ADD CONSTRAINT "provider_scholarships_nationality_xor_group"
  CHECK (("nationality" IS NULL) <> ("nationalityGroupId" IS NULL));
