-- PR-FILES-2 — split per-file data off VisaSupportingDocument and
-- VisaOtherEvidenceEntry into dedicated child tables, so a single
-- requirement (or single other-evidence entry) can hold multiple
-- uploaded files.
--
-- The parent rows survive intact: they keep their id, their FK
-- relations (notably visa_supporting_documents.fulfilmentMessages
-- via case_messages), and -- for supporting docs -- the
-- UNIQUE(visaApplicationId, documentType) that enforces "one
-- requirement per type per application". After this migration the
-- parent represents the *requirement*; files live in the child.
--
-- Existing rows with fileUrl IS NOT NULL get one child row apiece so
-- the test uploads survive the restructure. Metadata-only rows
-- (originalFilename present but fileUrl NULL, the pre-PR-FILES-1
-- legacy state) keep their parent but produce no child -- there's no
-- real file on disk to point at. Pre-apply count confirmed: 13
-- supporting + 1 other-evidence = 14 child rows expected.
--
-- Hand-written, applied via `prisma migrate deploy` -- same convention
-- as every prior PR. NEVER `prisma migrate dev`.

-- ─── 1. CREATE TABLE: visa_supporting_document_files ────────────────
CREATE TABLE "visa_supporting_document_files" (
  "id"                       TEXT          NOT NULL,
  "visaSupportingDocumentId" TEXT          NOT NULL,
  "originalFilename"         TEXT          NOT NULL,
  "mimeType"                 TEXT          NOT NULL,
  "sizeBytes"                INTEGER       NOT NULL,
  "fileUrl"                  TEXT          NOT NULL,
  "uploadedAt"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "visa_supporting_document_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_supporting_document_files_visaSupportingDocumentId_idx"
  ON "visa_supporting_document_files"("visaSupportingDocumentId");

ALTER TABLE "visa_supporting_document_files"
  ADD CONSTRAINT "visa_supporting_document_files_visaSupportingDocumentId_fkey"
  FOREIGN KEY ("visaSupportingDocumentId") REFERENCES "visa_supporting_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2. CREATE TABLE: visa_other_evidence_entry_files ──────────────
CREATE TABLE "visa_other_evidence_entry_files" (
  "id"                       TEXT          NOT NULL,
  "visaOtherEvidenceEntryId" TEXT          NOT NULL,
  "originalFilename"         TEXT          NOT NULL,
  "mimeType"                 TEXT          NOT NULL,
  "sizeBytes"                INTEGER       NOT NULL,
  "fileUrl"                  TEXT          NOT NULL,
  "uploadedAt"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "visa_other_evidence_entry_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_other_evidence_entry_files_visaOtherEvidenceEntryId_idx"
  ON "visa_other_evidence_entry_files"("visaOtherEvidenceEntryId");

ALTER TABLE "visa_other_evidence_entry_files"
  ADD CONSTRAINT "visa_other_evidence_entry_files_visaOtherEvidenceEntryId_fkey"
  FOREIGN KEY ("visaOtherEvidenceEntryId") REFERENCES "visa_other_evidence_entries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. DATA MIGRATION: copy existing file rows into the children ──
-- Only parents with fileUrl IS NOT NULL produce a child. Legacy
-- metadata-only parents (fileUrl IS NULL, originalFilename present
-- from the pre-PR-FILES-1 era) keep their parent identity but
-- produce no child -- there's no actual file on disk to link to.
-- pgcrypto's gen_random_uuid() was installed by PR-SCORECARD-4
-- (already in production).
INSERT INTO "visa_supporting_document_files" (
  "id",
  "visaSupportingDocumentId",
  "originalFilename",
  "mimeType",
  "sizeBytes",
  "fileUrl",
  "uploadedAt",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  "originalFilename",
  "mimeType",
  "sizeBytes",
  "fileUrl",
  "uploadedAt",
  "createdAt"
FROM "visa_supporting_documents"
WHERE "fileUrl" IS NOT NULL;

INSERT INTO "visa_other_evidence_entry_files" (
  "id",
  "visaOtherEvidenceEntryId",
  "originalFilename",
  "mimeType",
  "sizeBytes",
  "fileUrl",
  "uploadedAt",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  "originalFilename",
  "mimeType",
  "sizeBytes",
  "fileUrl",
  "uploadedAt",
  "createdAt"
FROM "visa_other_evidence_entries"
WHERE "fileUrl" IS NOT NULL;

-- ─── 4. DROP file-specific columns off the parents ─────────────────
-- The columns are now redundant: file data lives in the children.
-- documentType / evidenceType / customLabelEncrypted /
-- visaApplicationId / createdAt / updatedAt / id all stay.
ALTER TABLE "visa_supporting_documents"
  DROP COLUMN "originalFilename",
  DROP COLUMN "mimeType",
  DROP COLUMN "sizeBytes",
  DROP COLUMN "fileUrl",
  DROP COLUMN "uploadedAt";

ALTER TABLE "visa_other_evidence_entries"
  DROP COLUMN "originalFilename",
  DROP COLUMN "mimeType",
  DROP COLUMN "sizeBytes",
  DROP COLUMN "fileUrl",
  DROP COLUMN "uploadedAt";
