-- PR-LIA-5 — LIA's internal-only review verdict on client-uploaded
-- documents. The source document lives in one of three tables
-- (AdmissionDocument, ApplicationDocument, VisaSupportingDocument);
-- we identify it by `(source, sourceRowId)` rather than a typed FK
-- so we don't have to modify any of the source upload models.
--
-- UNREVIEWED is the implicit default — no row exists until the LIA
-- records a verdict. Re-reviewing upserts on the (source, sourceRowId)
-- unique constraint.

-- 1. Two new enums.
CREATE TYPE "CaseDocumentReviewSource" AS ENUM (
  'ADMISSION',
  'APPLICATION',
  'VISA_SUPPORTING'
);

CREATE TYPE "CaseDocumentReviewStatus" AS ENUM (
  'APPROVED',
  'REJECTED'
);

-- 2. case_document_reviews table.
CREATE TABLE "case_document_reviews" (
  "id"               TEXT                          NOT NULL,
  "caseId"           TEXT                          NOT NULL,
  "source"           "CaseDocumentReviewSource"    NOT NULL,
  "sourceRowId"      TEXT                          NOT NULL,
  "status"           "CaseDocumentReviewStatus"    NOT NULL,
  "reasonEncrypted"  BYTEA                         NOT NULL,
  "reviewedById"     TEXT                          NOT NULL,
  "reviewedAt"       TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_document_reviews_pkey" PRIMARY KEY ("id")
);

-- 3. Unique constraint — one current review per (source, sourceRowId).
--    Re-reviewing the same document upserts this row.
CREATE UNIQUE INDEX "case_document_reviews_source_sourceRowId_key"
  ON "case_document_reviews"("source", "sourceRowId");

-- 4. Timeline index for the case-detail "recent reviews" view.
CREATE INDEX "case_document_reviews_caseId_reviewedAt_idx"
  ON "case_document_reviews"("caseId", "reviewedAt");

-- 5. FKs.
--    caseId ON DELETE CASCADE — removing a case wipes its review
--      verdicts (the case is gone, the verdicts are meaningless).
--    reviewedById ON DELETE NO ACTION — reviewer authorship survives
--      a User hard-delete; PR-CONSULT-4 audit snapshots handle
--      attribution post-deletion.
ALTER TABLE "case_document_reviews" ADD CONSTRAINT "case_document_reviews_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_document_reviews" ADD CONSTRAINT "case_document_reviews_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
