-- CreateEnum
CREATE TYPE "ProgrammeSource" AS ENUM ('MANUAL_EXCEL', 'MANUAL_ENTRY', 'AUTOMATED_WEB_CHECK');

-- CreateEnum
CREATE TYPE "ChangeProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "education_programmes" ADD COLUMN     "source" "ProgrammeSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
ADD COLUMN     "sourceRef" TEXT;

-- CreateTable
CREATE TABLE "programme_change_proposals" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "source" "ProgrammeSource" NOT NULL,
    "changedFields" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ChangeProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "programme_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_change_proposals_status_idx" ON "programme_change_proposals"("status");

-- CreateIndex
CREATE INDEX "programme_change_proposals_programmeId_idx" ON "programme_change_proposals"("programmeId");

-- AddForeignKey
ALTER TABLE "programme_change_proposals" ADD CONSTRAINT "programme_change_proposals_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

