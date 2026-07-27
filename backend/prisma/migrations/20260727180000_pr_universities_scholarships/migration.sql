-- PR-UNIVERSITIES — provider scholarships (Owner-managed institutional reference
-- data). Additive only: one new table + its two FKs + two indexes. The referenced
-- enums ("QualificationLevel", "CommissionType") already exist.

-- CreateTable
CREATE TABLE "provider_scholarships" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "programmeId" TEXT,
    "level" "QualificationLevel",
    "name" TEXT NOT NULL,
    "amountType" "CommissionType" NOT NULL DEFAULT 'FIXED',
    "amountValue" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "eligibilityNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "provider_scholarships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_scholarships_providerId_idx" ON "provider_scholarships"("providerId");

-- CreateIndex
CREATE INDEX "provider_scholarships_nationality_idx" ON "provider_scholarships"("nationality");

-- AddForeignKey
ALTER TABLE "provider_scholarships" ADD CONSTRAINT "provider_scholarships_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_scholarships" ADD CONSTRAINT "provider_scholarships_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
