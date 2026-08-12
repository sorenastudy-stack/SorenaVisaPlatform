-- PR-COMMISSION-TRIGGER — the Admission Officer's claim and Finance's decision.
--
-- Purely additive: one nullable column and one new table. Nothing is dropped,
-- rewritten, or re-typed, so unlike the Part 1 anchor migration there is no
-- destructive step to guard — an existing row cannot be damaged by a column
-- that did not exist a moment ago. The guard in the previous migration earned
-- its place by protecting a DROP COLUMN; adding one here would be ceremony.

-- CreateEnum
CREATE TYPE "CommissionTriggerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "admission_programme_choices" ADD COLUMN     "firstClassAttendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commission_triggers" (
    "id" TEXT NOT NULL,
    "programmeChoiceId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CommissionTriggerStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_triggers_status_idx" ON "commission_triggers"("status");

-- CreateIndex
CREATE INDEX "commission_triggers_programmeChoiceId_idx" ON "commission_triggers"("programmeChoiceId");

-- AddForeignKey
ALTER TABLE "commission_triggers" ADD CONSTRAINT "commission_triggers_programmeChoiceId_fkey" FOREIGN KEY ("programmeChoiceId") REFERENCES "admission_programme_choices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One LIVE claim per programme choice, and a full history of rejected ones.
--
-- A plain UNIQUE on "programmeChoiceId" would make the first rejection
-- permanent: the row stays, so nothing could ever be claimed for that programme
-- again even if the circumstances that caused the rejection were fixed. A
-- partial index says what is actually meant — at most one trigger that is not
-- REJECTED — so a claim can be re-submitted after a refusal while every refusal
-- stays on record.
--
-- Prisma cannot express a partial unique index in the schema, so it lives here
-- and the service translates its violation (P2002) into a plain 400.
CREATE UNIQUE INDEX "commission_triggers_one_live_per_choice"
  ON "commission_triggers"("programmeChoiceId")
  WHERE "status" <> 'REJECTED';
