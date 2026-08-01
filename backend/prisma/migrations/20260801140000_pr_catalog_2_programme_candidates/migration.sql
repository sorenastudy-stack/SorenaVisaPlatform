-- AlterTable
ALTER TABLE "education_providers" ADD COLUMN     "catalogueUrl" TEXT;

-- CreateTable
CREATE TABLE "programme_candidates" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "source" "ProgrammeSource" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "proposedData" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "detectedFields" TEXT[],
    "nameNormalized" TEXT NOT NULL,
    "nzqfLevel" TEXT,
    "campusCity" TEXT,
    "status" "ChangeProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_candidates_status_idx" ON "programme_candidates"("status");

-- CreateIndex
CREATE INDEX "programme_candidates_providerId_idx" ON "programme_candidates"("providerId");

-- CreateIndex
CREATE INDEX "programme_candidates_providerId_nameNormalized_nzqfLevel_ca_idx" ON "programme_candidates"("providerId", "nameNormalized", "nzqfLevel", "campusCity");

-- AddForeignKey
ALTER TABLE "programme_candidates" ADD CONSTRAINT "programme_candidates_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

