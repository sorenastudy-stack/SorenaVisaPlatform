-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_ERROR');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "scanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scanCheckedAt" TIMESTAMP(3),
ADD COLUMN     "scanSignature" TEXT,
ADD COLUMN     "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING_SCAN';

-- CreateIndex
CREATE INDEX "documents_scanStatus_idx" ON "documents"("scanStatus");

