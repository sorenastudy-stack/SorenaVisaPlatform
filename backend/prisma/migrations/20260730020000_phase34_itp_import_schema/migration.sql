-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('UNIVERSITY', 'ITP', 'PTE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NEEDS_RECHECK');

-- CreateEnum
CREATE TYPE "IntakeBasis" AS ENUM ('REMAINING', 'PUBLISHED', 'PROJECTED');

-- AlterEnum
ALTER TYPE "QualificationLevel" ADD VALUE 'CERTIFICATE';

-- AlterTable
ALTER TABLE "education_providers" ADD COLUMN     "institutionType" "InstitutionType",
ADD COLUMN     "legalEntityName" TEXT;

-- AlterTable
ALTER TABLE "education_programmes" ADD COLUMN     "campusCity" TEXT,
ADD COLUMN     "deliveryMode" TEXT,
ADD COLUMN     "durationText" TEXT,
ADD COLUMN     "fee2027Status" TEXT,
ADD COLUMN     "feeBasis" TEXT,
ADD COLUMN     "feeYear" INTEGER,
ADD COLUMN     "majorStrand" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "programmeUrl" TEXT,
ADD COLUMN     "qualificationType" TEXT,
ADD COLUMN     "scholarshipNote" TEXT,
ADD COLUMN     "studentVisaSuitable" BOOLEAN,
ADD COLUMN     "verificationSourceUrl" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus",
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "programme_requirements" ADD COLUMN     "academicPrerequisites" TEXT,
ADD COLUMN     "englishRequirementText" TEXT,
ADD COLUMN     "otherRequirements" TEXT;

-- CreateTable
CREATE TABLE "programme_intakes" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "IntakeBasis" NOT NULL,
    "needsReconfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_intakes_programmeId_idx" ON "programme_intakes"("programmeId");

-- CreateIndex
CREATE INDEX "programme_intakes_year_basis_idx" ON "programme_intakes"("year", "basis");

-- AddForeignKey
ALTER TABLE "programme_intakes" ADD CONSTRAINT "programme_intakes_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

