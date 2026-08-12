-- PR-AGENT-PAYABLES (phase 2), part 2 of 2 — the rejection trail, and the
-- constraint change that makes a rejection survivable.
--
-- WHY THE UNIQUE INDEX CHANGES
-- Phase 1 made commissionId outright UNIQUE: one payable per commission, so a
-- share could never be owed twice. That rule is still right for LIVE rows, but
-- it collides with a terminal REJECTED state: the rejected row stays on record
-- for reconciliation, and its mere existence would block the commission from
-- ever producing a payable again — even if the refusal was a mistake, or the
-- circumstances change.
--
-- So the constraint narrows from "one payable per commission" to "one LIVE
-- payable per commission", exactly the shape already used for commission
-- triggers (commission_triggers_one_live_per_choice). Prisma cannot express a
-- partial unique index, so it lives here and the service turns its violation
-- (P2002) into a plain 400.
--
-- Nothing is dropped or rewritten: the four columns are nullable, the enum
-- value was added in part 1, and no existing row changes status.

-- AlterTable
ALTER TABLE "agent_payables" ADD COLUMN "rejectedById" TEXT;
ALTER TABLE "agent_payables" ADD COLUMN "rejectedByName" TEXT;
ALTER TABLE "agent_payables" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "agent_payables" ADD COLUMN "rejectionReason" TEXT;

-- DropIndex — replaced by the partial index below, not removed.
DROP INDEX "agent_payables_commissionId_key";

-- CreateIndex
CREATE UNIQUE INDEX "agent_payables_one_live_per_commission"
  ON "agent_payables"("commissionId")
  WHERE "status" <> 'REJECTED';
