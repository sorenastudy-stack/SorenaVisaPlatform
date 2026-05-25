-- PR-LIA-1 — Legal notes + decisions on CRM Cases.
--
-- One table backs both free-form LIA notes and formal decisions:
-- `decision IS NULL` means "note", `decision IS NOT NULL` means
-- "formal decision recorded". Both shape variants ride the same
-- timeline in the LIA case-detail view.
--
-- Both encrypted columns hold AES-256-GCM ciphertext via the
-- existing CryptoService envelope (1 byte version + 12 byte IV +
-- 16 byte tag + ciphertext). decisionReasonEncrypted is NULL for
-- the "note" variant; populated for the "decision" variant.

-- 1. New enum for the decision outcomes.
CREATE TYPE "LegalDecision" AS ENUM (
  'APPROVED',
  'REJECTED',
  'NEEDS_MORE_INFO',
  'WITHDRAWN'
);

-- 2. legal_notes table.
CREATE TABLE "legal_notes" (
  "id"                       TEXT             NOT NULL,
  "caseId"                   TEXT             NOT NULL,
  "authorId"                 TEXT             NOT NULL,
  "bodyEncrypted"            BYTEA            NOT NULL,
  "decision"                 "LegalDecision",
  "decisionReasonEncrypted"  BYTEA,
  "createdAt"                TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "legal_notes_pkey" PRIMARY KEY ("id")
);

-- 3. Composite index for the case-detail timeline query
--    (ORDER BY createdAt ASC scoped to one case).
CREATE INDEX "legal_notes_caseId_createdAt_idx"
  ON "legal_notes"("caseId", "createdAt");

-- 4. FKs.
--    caseId ON DELETE CASCADE — a Case being removed also wipes its
--    legal trail. (Cases are rarely hard-deleted in practice; the
--    cascade matches the Prisma schema.)
--    authorId is RESTRICT-equivalent (no ON DELETE clause) so legal
--    authorship survives a User row delete-without-snapshot. The
--    PR-CONSULT-4 snapshot pattern in audit_logs handles attribution
--    when the author is later hard-deleted.
ALTER TABLE "legal_notes" ADD CONSTRAINT "legal_notes_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "legal_notes" ADD CONSTRAINT "legal_notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
