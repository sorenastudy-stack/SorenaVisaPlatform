-- PR-EXPLORE (Round 3) — nationality-scoped tuition, mirroring provider_scholarships.
-- Additive: new table only. education_programmes.tuitionFeeNZD is untouched and
-- remains the explicit default/fallback.
CREATE TABLE "provider_tuitions" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "programmeId" TEXT,
    "level" "QualificationLevel",
    "nationality" TEXT NOT NULL,
    "amountValue" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "feeYear" INTEGER,
    "term" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "provider_tuitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_tuitions_providerId_idx" ON "provider_tuitions"("providerId");
CREATE INDEX "provider_tuitions_nationality_idx" ON "provider_tuitions"("nationality");
CREATE INDEX "provider_tuitions_programmeId_idx" ON "provider_tuitions"("programmeId");

ALTER TABLE "provider_tuitions" ADD CONSTRAINT "provider_tuitions_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_tuitions" ADD CONSTRAINT "provider_tuitions_programmeId_fkey"
    FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
