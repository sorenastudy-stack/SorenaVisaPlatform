-- PR-LIA-CONVO-NOTES — LIA conversation notes attached to a Case.
--
-- Additive only: one new table, two indexes, two foreign keys. No existing
-- table, column, or constraint is touched, so this rolls forward on a live DB
-- without locking existing rows and rolls back cleanly with a single DROP TABLE.
--
-- Referential actions mirror legal_notes:
--   * caseId   ON DELETE CASCADE   — deleting a Case wipes its conversation notes.
--   * authorId ON DELETE NO ACTION — an authoring LIA cannot be hard-deleted while
--                                    notes reference them (RESTRICT-equivalent).
CREATE TABLE "case_conversation_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "case_conversation_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_conversation_notes_caseId_createdAt_idx" ON "case_conversation_notes"("caseId", "createdAt");

ALTER TABLE "case_conversation_notes" ADD CONSTRAINT "case_conversation_notes_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_conversation_notes" ADD CONSTRAINT "case_conversation_notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
