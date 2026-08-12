-- PR-AGENT-PAYABLES — what Sorena owes an introducing agent.
--
-- Purely additive: one enum, one table, two foreign keys. Nothing existing is
-- dropped, re-typed or rewritten, so there is no destructive step to guard.
--
-- `commissionId` is UNIQUE: one payable per commission, the same rule shape as
-- one commission per programme choice. A share of a commission cannot be owed
-- twice.

-- CreateEnum
CREATE TYPE "AgentPayableStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "agent_payables" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "status" "AgentPayableStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidByName" TEXT,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_payables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_payables_commissionId_key" ON "agent_payables"("commissionId");

-- CreateIndex
CREATE INDEX "agent_payables_status_idx" ON "agent_payables"("status");

-- CreateIndex
CREATE INDEX "agent_payables_agentId_status_idx" ON "agent_payables"("agentId", "status");

-- AddForeignKey
ALTER TABLE "agent_payables" ADD CONSTRAINT "agent_payables_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "affiliate_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payables" ADD CONSTRAINT "agent_payables_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

