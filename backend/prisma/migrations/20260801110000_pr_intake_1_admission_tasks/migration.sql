-- CreateEnum
CREATE TYPE "AdmissionTaskType" AS ENUM ('INTAKE_REASSIGNED', 'INTAKE_REASSIGN_FAILED');

-- CreateEnum
CREATE TYPE "AdmissionTaskStatus" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "admission_applications" ADD COLUMN     "intakeReviewNeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "admission_tasks" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "type" "AdmissionTaskType" NOT NULL,
    "status" "AdmissionTaskStatus" NOT NULL DEFAULT 'OPEN',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "admission_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admission_tasks_assignedToId_status_idx" ON "admission_tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "admission_tasks_caseId_idx" ON "admission_tasks"("caseId");

-- AddForeignKey
ALTER TABLE "admission_tasks" ADD CONSTRAINT "admission_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

