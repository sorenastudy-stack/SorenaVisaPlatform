-- CreateEnum
CREATE TYPE "SopStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "sop_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "admissionProgrammeChoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SopStatus" NOT NULL DEFAULT 'DRAFT',
    "contentJson" JSONB NOT NULL,
    "sourceSnapshotJson" JSONB NOT NULL,
    "gateResultsJson" JSONB,
    "model" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_documents_caseId_status_idx" ON "sop_documents"("caseId", "status");

-- CreateIndex
CREATE INDEX "sop_documents_admissionProgrammeChoiceId_status_idx" ON "sop_documents"("admissionProgrammeChoiceId", "status");

-- AddForeignKey
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_admissionProgrammeChoiceId_fkey" FOREIGN KEY ("admissionProgrammeChoiceId") REFERENCES "admission_programme_choices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

