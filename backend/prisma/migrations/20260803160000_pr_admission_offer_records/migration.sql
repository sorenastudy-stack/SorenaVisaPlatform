-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('CONDITIONAL', 'UNCONDITIONAL');

-- CreateEnum
CREATE TYPE "OfferDecision" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "offer_records" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "admissionProgrammeChoiceId" TEXT NOT NULL,
    "submissionRecordId" TEXT,
    "offerType" "OfferType" NOT NULL,
    "conditions" TEXT,
    "offeredAt" DATE,
    "expiresAt" DATE,
    "letterFileName" TEXT,
    "letterFileUrl" TEXT,
    "notes" TEXT,
    "decision" "OfferDecision" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offer_records_caseId_idx" ON "offer_records"("caseId");

-- CreateIndex
CREATE INDEX "offer_records_admissionProgrammeChoiceId_idx" ON "offer_records"("admissionProgrammeChoiceId");

-- AddForeignKey
ALTER TABLE "offer_records" ADD CONSTRAINT "offer_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_records" ADD CONSTRAINT "offer_records_admissionProgrammeChoiceId_fkey" FOREIGN KEY ("admissionProgrammeChoiceId") REFERENCES "admission_programme_choices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

