-- Visa Section — INZ 1200 rebuild, PR-VISA6 (Education history).
-- Adds visa_education_supplements: one row per admission_education_entry,
-- holding ONLY the INZ Section-6 extras that admission does not capture.
--
-- Column-by-column reasoning (audited against schema.prisma's
-- admission_education_entries definition before this migration was
-- written):
--   * startMonth / endMonth — admission stores startYear/endYear as
--     plain Int (year only). INZ wants month + year.
--   * institutionState / institutionTown — admission has institutionName
--     and country but NO state or town columns at all.
--   * qualificationAwarded — admission's `completed` flag indicates
--     student-finished, not institution-conferred; `certificateNotReceived`
--     hints that the cert may not yet be in the student's hand. INZ's
--     "Was the qualification awarded?" is a third, distinct question
--     about whether the credential has been issued, so we store it
--     separately to match INZ wording exactly.
--
-- educationEntryId has a UNIQUE constraint so the relationship is strict
-- 1:1 with admission_education_entries; the FK CASCADE on both parents
-- means deleting either an admission entry or the visa_application
-- automatically removes the supplement — no orphan rows possible.

CREATE TABLE "visa_education_supplements" (
  "id"                   TEXT NOT NULL,
  "visaApplicationId"    TEXT NOT NULL,
  "educationEntryId"     TEXT NOT NULL,
  "startMonth"           INTEGER,
  "endMonth"             INTEGER,
  "institutionState"     TEXT,
  "institutionTown"      TEXT,
  "qualificationAwarded" BOOLEAN,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_education_supplements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visa_education_supplements_educationEntryId_key"
  ON "visa_education_supplements"("educationEntryId");

CREATE INDEX "visa_education_supplements_visaApplicationId_idx"
  ON "visa_education_supplements"("visaApplicationId");

ALTER TABLE "visa_education_supplements"
  ADD CONSTRAINT "visa_education_supplements_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_education_supplements"
  ADD CONSTRAINT "visa_education_supplements_educationEntryId_fkey"
  FOREIGN KEY ("educationEntryId")
  REFERENCES "admission_education_entries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
