-- PR-NURTURE — post-FREE_15 nurture sequence (7 touches / 21 days) + ongoing
-- monthly newsletter. Additive only: new enums, new nullable columns on leads,
-- and two new tables (a call-task table + an email/newsletter send ledger that
-- mirrors visa_expiry_reminders_sent).

-- CreateEnum
CREATE TYPE "NurtureStage" AS ENUM ('NONE', 'SEQUENCE', 'NEWSLETTER', 'ENDED');

-- CreateEnum
CREATE TYPE "NurtureCallStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED', 'AUTO_CLOSED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "nurtureLastNewsletterAt" TIMESTAMP(3),
ADD COLUMN     "nurtureReason" TEXT,
ADD COLUMN     "nurtureStage" "NurtureStage" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "nurtureStartedAt" TIMESTAMP(3),
ADD COLUMN     "nurtureUnsubToken" TEXT,
ADD COLUMN     "nurtureUnsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "nurture_call_tasks" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "step" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "NurtureCallStatus" NOT NULL DEFAULT 'PENDING',
    "outcomeNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurture_call_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_nurture_sent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailDeliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailErrorMessage" TEXT,

    CONSTRAINT "lead_nurture_sent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nurture_call_tasks_assignedToId_dueDate_idx" ON "nurture_call_tasks"("assignedToId", "dueDate");

-- CreateIndex
CREATE INDEX "nurture_call_tasks_leadId_idx" ON "nurture_call_tasks"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "nurture_call_tasks_leadId_step_key" ON "nurture_call_tasks"("leadId", "step");

-- CreateIndex
CREATE INDEX "lead_nurture_sent_leadId_sentAt_idx" ON "lead_nurture_sent"("leadId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_nurture_sent_leadId_step_key" ON "lead_nurture_sent"("leadId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "leads_nurtureUnsubToken_key" ON "leads"("nurtureUnsubToken");

-- AddForeignKey
ALTER TABLE "nurture_call_tasks" ADD CONSTRAINT "nurture_call_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurture_call_tasks" ADD CONSTRAINT "nurture_call_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurture_call_tasks" ADD CONSTRAINT "nurture_call_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_nurture_sent" ADD CONSTRAINT "lead_nurture_sent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
