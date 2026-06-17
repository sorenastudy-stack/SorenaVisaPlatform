-- CreateEnum
CREATE TYPE "DocumentUploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentUploadStatus" NOT NULL DEFAULT 'PENDING',
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_r2Key_key" ON "documents"("r2Key");

-- CreateIndex
CREATE INDEX "documents_caseId_idx" ON "documents"("caseId");

-- CreateIndex
CREATE INDEX "documents_uploaderId_idx" ON "documents"("uploaderId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

