-- CreateEnum
CREATE TYPE "CvStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "cv_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CvStatus" NOT NULL DEFAULT 'DRAFT',
    "contentJson" JSONB NOT NULL,
    "sourceSnapshotJson" JSONB NOT NULL,
    "model" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "cv_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cv_documents_caseId_status_idx" ON "cv_documents"("caseId", "status");

-- AddForeignKey
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

