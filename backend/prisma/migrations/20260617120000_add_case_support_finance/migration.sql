-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "financeId" TEXT,
ADD COLUMN     "supportId" TEXT;

-- CreateIndex
CREATE INDEX "cases_supportId_idx" ON "cases"("supportId");

-- CreateIndex
CREATE INDEX "cases_financeId_idx" ON "cases"("financeId");

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_financeId_fkey" FOREIGN KEY ("financeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
