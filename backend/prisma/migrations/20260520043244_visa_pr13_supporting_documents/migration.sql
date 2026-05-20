-- Visa Section — INZ 1200 rebuild, PR-VISA13 (Supporting documents
-- page 1, metadata only).
--
-- File storage is DEFERRED to a later PR. This migration creates
-- only the metadata tables — file bytes never reach the backend
-- under this PR. The frontend extracts originalFilename / mimeType /
-- sizeBytes from the browser File object and sends only those
-- primitives; we store them here so PR-14 (page 2) can list the
-- per-document requirements consistently, and a later PR can wire
-- the actual blob store.
--
-- Adds:
--   * visa_supporting_document_type enum — six values for page 1;
--     PR-VISA14 (page 2) will ALTER TYPE to add more values.
--   * visa_supporting_documents table — one row per (application,
--     document type). UNIQUE constraint enforces replace-on-upload
--     (the service deletes the existing row by composite key before
--     inserting the new one).
--   * Three new columns on visa_applications:
--       - livingInDifferentCountry BOOLEAN
--       - countryOfResidenceEncrypted BYTEA (encrypted PII via
--         CryptoService, same envelope as the Section 12 adviser
--         fields — identifying location)
--       - areAllDocsInEnglish BOOLEAN
--
-- All columns nullable so partial drafts can save; the Step 13 save
-- validator (visa.service.saveSupportingDocuments) enforces the
-- conditional-required rules and clears unused downstream fields
-- on save (livingInDifferentCountry = false → nulls
-- countryOfResidence + deletes any stale RESIDENCE_VISA row).
--
-- Hand-written, applied via `prisma migrate deploy` — same
-- convention as PR-VISA1..VISA12 to avoid `migrate dev` picking up
-- unrelated drift on working production constraints.

CREATE TYPE "VisaSupportingDocumentType" AS ENUM (
  'PASSPORT',
  'NATIONAL_ID',
  'RESIDENCE_VISA',
  'MILITARY_RECORD',
  'TRAVEL_HISTORY',
  'AUTHORITY_DOC'
);

ALTER TABLE "visa_applications"
  ADD COLUMN "livingInDifferentCountry"    BOOLEAN,
  ADD COLUMN "countryOfResidenceEncrypted" BYTEA,
  ADD COLUMN "areAllDocsInEnglish"         BOOLEAN;

CREATE TABLE "visa_supporting_documents" (
  "id"                TEXT NOT NULL,
  "visaApplicationId" TEXT NOT NULL,
  "documentType"      "VisaSupportingDocumentType" NOT NULL,
  "originalFilename"  TEXT NOT NULL,
  "mimeType"          TEXT NOT NULL,
  "sizeBytes"         INTEGER NOT NULL,
  "uploadedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_supporting_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visa_supporting_documents_visaApplicationId_documentType_key"
  ON "visa_supporting_documents"("visaApplicationId", "documentType");

CREATE INDEX "visa_supporting_documents_visaApplicationId_idx"
  ON "visa_supporting_documents"("visaApplicationId");

ALTER TABLE "visa_supporting_documents"
  ADD CONSTRAINT "visa_supporting_documents_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
