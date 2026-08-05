-- PR-IMPORT — verbatim source columns from the three NZ catalogue workbooks.
--
-- Purely additive: nullable columns only, no table altered in a lossy way.
-- Every one is editable in the admin UI (Owner may correct a value before approving,
-- and automated re-checks propose changes into the same fields).
--
-- tuitionFeeRaw is kept ALONGSIDE tuitionFeeNZD on purpose: the source states fees
-- conditionally often enough that flattening to a single number would quote students
-- a price the institution never published.

-- AlterTable: institution short display name (ITP/PTE "Brand")
ALTER TABLE "education_providers" ADD COLUMN "brand" TEXT;

-- AlterTable: programme source columns
ALTER TABLE "education_programmes" ADD COLUMN "tuitionFeeRaw" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "tuitionParseNote" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "academicPrerequisites" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "englishRequirementRaw" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "otherRequirements" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "remaining2026Intakes" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "published2027Intakes" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "projected2027Intakes" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "intakeBasis2027" TEXT;
ALTER TABLE "education_programmes" ADD COLUMN "intakes2027Planning" TEXT;
