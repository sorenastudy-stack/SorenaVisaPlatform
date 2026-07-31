-- AlterTable
ALTER TABLE "country_execution_configs" ADD COLUMN     "intakeMaxWindowMonths" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "intakeMinLeadMonths" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "liaLeadMonths" INTEGER NOT NULL DEFAULT 4;

