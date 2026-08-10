-- CreateEnum
CREATE TYPE "DeclarationType" AS ENUM ('AGENT_DECLARATION', 'ADMISSION_ACCEPTANCE', 'VISA_SUBMIT_DECLARATION');

-- AlterTable
ALTER TABLE "policy_acceptance" ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "declarationText" TEXT,
ADD COLUMN     "declarationType" "DeclarationType";

-- CreateIndex
CREATE INDEX "policy_acceptance_applicationId_idx" ON "policy_acceptance"("applicationId");

-- CreateIndex
CREATE INDEX "policy_acceptance_declarationType_idx" ON "policy_acceptance"("declarationType");

