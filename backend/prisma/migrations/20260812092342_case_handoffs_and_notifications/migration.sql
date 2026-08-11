-- CreateEnum
CREATE TYPE "CaseSlot" AS ENUM ('ADMISSION', 'SUPPORT', 'FINANCE', 'LIA');

-- CreateEnum
CREATE TYPE "HandoffState" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "case_handoffs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromSlot" "CaseSlot" NOT NULL,
    "toSlot" "CaseSlot" NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "fromUserName" TEXT,
    "toUserName" TEXT,
    "note" TEXT,
    "status" "HandoffState" NOT NULL DEFAULT 'PENDING',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_handoffs_toUserId_status_idx" ON "case_handoffs"("toUserId", "status");

-- CreateIndex
CREATE INDEX "case_handoffs_caseId_createdAt_idx" ON "case_handoffs"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- AddForeignKey
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
