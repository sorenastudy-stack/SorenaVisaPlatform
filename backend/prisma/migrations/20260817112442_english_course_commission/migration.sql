-- AlterTable
ALTER TABLE "education_providers" ADD COLUMN     "commissionEnglishY1Type" "CommissionType",
ADD COLUMN     "commissionEnglishY1Value" DOUBLE PRECISION,
ADD COLUMN     "commissionEnglishY2Type" "CommissionType",
ADD COLUMN     "commissionEnglishY2Value" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "education_programmes" ADD COLUMN     "isEnglishLanguageCourse" BOOLEAN NOT NULL DEFAULT false;

