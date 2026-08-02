-- CreateEnum
CREATE TYPE "SubmissionMethod" AS ENUM ('PORTAL', 'EMAIL', 'AGENT_PORTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionOutcome" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'OFFER', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "submission_records" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "admissionProgrammeChoiceId" TEXT NOT NULL,
    "submittedAt" DATE NOT NULL,
    "method" "SubmissionMethod" NOT NULL,
    "portalName" TEXT,
    "referenceNo" TEXT,
    "outcome" "SubmissionOutcome" NOT NULL DEFAULT 'PENDING',
    "responseReceivedAt" DATE,
    "responseNotes" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_records_caseId_idx" ON "submission_records"("caseId");

-- CreateIndex
CREATE INDEX "submission_records_admissionProgrammeChoiceId_idx" ON "submission_records"("admissionProgrammeChoiceId");

-- AddForeignKey
ALTER TABLE "submission_records" ADD CONSTRAINT "submission_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_records" ADD CONSTRAINT "submission_records_admissionProgrammeChoiceId_fkey" FOREIGN KEY ("admissionProgrammeChoiceId") REFERENCES "admission_programme_choices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

