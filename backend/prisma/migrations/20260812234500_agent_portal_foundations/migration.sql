-- PR-AGENT-PORTAL phase 0 — foundations for the agent portal.
--
-- Purely additive. Nothing is dropped, re-typed or rewritten; both new NOT NULL
-- columns carry defaults, so every existing row is valid the moment this runs.
-- No behaviour changes on its own: this is the shape later phases need.
--
-- WHAT IT ADDS
--   affiliate_agents.userId          the login an agent signs in with, once
--                                    they have one. UNIQUE, so one account can
--                                    never stand for two agents and make
--                                    attribution ambiguous. SET NULL on user
--                                    delete: the agent record and everything
--                                    owed to it survive losing an account.
--   affiliate_agents.isLiaType       whether this agent is themselves a
--                                    licensed adviser. One model, one flag.
--   affiliate_agents.commissionRate  per-agent override; NULL keeps the company
--                                    default. Payables still snapshot the rate.
--   affiliate_agents.<id|business>*  R2 keys plus display metadata for the two
--                                    verification documents. The bytes live in
--                                    R2; only the key is stored here.
--   affiliate_agents.verified*       the Owner's decision, and why if refused.
--   lia_profiles.licenceExpiryDate   a verified licence is not permanent.
--   lia_profiles.isLicenceExpired    set by the daily sweep, for listing only.
--                                    The gate still compares the date itself.

-- AlterTable
ALTER TABLE "lia_profiles" ADD COLUMN     "isLicenceExpired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenceExpiryDate" DATE;

-- AlterTable
ALTER TABLE "affiliate_agents" ADD COLUMN     "businessDocumentMime" TEXT,
ADD COLUMN     "businessDocumentName" TEXT,
ADD COLUMN     "businessDocumentR2Key" TEXT,
ADD COLUMN     "businessDocumentSizeBytes" INTEGER,
ADD COLUMN     "businessDocumentType" VARCHAR(120),
ADD COLUMN     "businessDocumentUploadedAt" TIMESTAMP(3),
ADD COLUMN     "commissionRatePercent" DOUBLE PRECISION,
ADD COLUMN     "idDocumentMime" TEXT,
ADD COLUMN     "idDocumentName" TEXT,
ADD COLUMN     "idDocumentR2Key" TEXT,
ADD COLUMN     "idDocumentSizeBytes" INTEGER,
ADD COLUMN     "idDocumentUploadedAt" TIMESTAMP(3),
ADD COLUMN     "isLiaType" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "verificationRejectedAt" TIMESTAMP(3),
ADD COLUMN     "verificationRejectionReason" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_agents_userId_key" ON "affiliate_agents"("userId");

-- CreateIndex
CREATE INDEX "affiliate_agents_isLiaType_idx" ON "affiliate_agents"("isLiaType");

-- AddForeignKey
ALTER TABLE "affiliate_agents" ADD CONSTRAINT "affiliate_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_agents" ADD CONSTRAINT "affiliate_agents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

