-- PR-EDU1: Education History repeating table + optional per-entry document link.
-- Two migrations are required because Postgres restricts ALTER TYPE ADD VALUE
-- from coexisting with other DDL in the same transaction. The new enum values
-- (NOTARIZED_CERTIFICATE, NOTARIZED_TRANSCRIPT) live in 20260512000001.

CREATE TABLE "admission_education_entries" (
  "id"                     TEXT NOT NULL,
  "admissionApplicationId" TEXT NOT NULL,
  "qualificationLevel"     TEXT NOT NULL,
  "institutionName"        TEXT NOT NULL,
  "country"                TEXT NOT NULL,
  "fieldOfStudy"           TEXT,
  "startYear"              INTEGER,
  "endYear"                INTEGER,
  "completed"              BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"              INTEGER NOT NULL DEFAULT 0,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admission_education_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_education_entries_admissionApplicationId_idx"
  ON "admission_education_entries"("admissionApplicationId");

ALTER TABLE "admission_education_entries"
  ADD CONSTRAINT "admission_education_entries_admissionApplicationId_fkey"
  FOREIGN KEY ("admissionApplicationId")
  REFERENCES "admission_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional per-entry linkage on admission_documents. Existing rows keep
-- educationEntryId = NULL (application-level documents). New rows uploaded
-- with an educationEntryId attach to a specific education entry.
ALTER TABLE "admission_documents"
  ADD COLUMN "educationEntryId" TEXT;

CREATE INDEX "admission_documents_educationEntryId_idx"
  ON "admission_documents"("educationEntryId");

ALTER TABLE "admission_documents"
  ADD CONSTRAINT "admission_documents_educationEntryId_fkey"
  FOREIGN KEY ("educationEntryId")
  REFERENCES "admission_education_entries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
