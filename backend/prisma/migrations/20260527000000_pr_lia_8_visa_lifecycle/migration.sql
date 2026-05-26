-- PR-LIA-8 — Visa lifecycle.
--
-- 1. New enum: VisaIssueOutcome (APPROVED | DECLINED).
-- 2. New table: visas — one row per Case, populated when the LIA
--    records the INZ outcome. Approval rows carry the visa file
--    metadata + start/end dates; decline rows carry an encrypted
--    reason. Both move the parent Case to COMPLETED.
-- 3. Indexes:
--    * (issuedById, issuedAt) — productivity report can later
--      aggregate decisions per-LIA without a full scan.
--    * (visaEndDate)          — forward hook for PR-LIA-9 expiry-
--      reminder queries (find APPROVED visas expiring soon).
-- 4. FKs:
--    * caseId → cases.id  ON DELETE CASCADE  (deleting the case
--      tears down the visa record too; matches LegalNote / CaseMessage)
--    * issuedById → users.id  NO ACTION      (audit-snapshot pattern
--      means we never need to delete the issuer through here)

-- 1. Enum
CREATE TYPE "VisaIssueOutcome" AS ENUM ('APPROVED', 'DECLINED');

-- 2. Table
CREATE TABLE "visas" (
  "id"                     TEXT             NOT NULL,
  "caseId"                 TEXT             NOT NULL,
  "outcome"                "VisaIssueOutcome" NOT NULL,
  -- Approval fields
  "visaStartDate"          TIMESTAMP(3),
  "visaEndDate"            TIMESTAMP(3),
  "visaDocumentUrl"        TEXT,
  "visaDocumentName"       TEXT,
  "visaDocumentMime"       TEXT,
  "visaDocumentSize"       INTEGER,
  -- Decline fields
  "declineReasonEncrypted" BYTEA,
  -- Common metadata
  "issuedById"             TEXT             NOT NULL,
  "issuedAt"               TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"                  TEXT,
  "createdAt"              TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "visas_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes
CREATE UNIQUE INDEX "visas_caseId_key" ON "visas"("caseId");
CREATE INDEX "visas_issuedById_issuedAt_idx" ON "visas"("issuedById", "issuedAt");
CREATE INDEX "visas_visaEndDate_idx" ON "visas"("visaEndDate");

-- 4. FKs
ALTER TABLE "visas"
  ADD CONSTRAINT "visas_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visas"
  ADD CONSTRAINT "visas_issuedById_fkey"
  FOREIGN KEY ("issuedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
