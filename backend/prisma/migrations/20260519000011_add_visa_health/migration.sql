-- Visa Section — INZ 1200 rebuild, PR-VISA5 (Health).
-- Two pieces of plain DDL — both happily coexist in one transaction:
--   (a) ALTER TABLE visa_applications: 11 nullable columns for the
--       Health step's parent fields (TB Y/N, medical care Y/Ns,
--       pregnancy, length-of-stay enum, medical exam fields, two
--       declarations and the TB-no-more checkbox).
--   (b) CREATE TABLE visa_tb_risk_countries: repeating child rows for
--       the TB-risk countries block. Same shape as the citizenship
--       child table from 20260519000010 — id, visaApplicationId FK,
--       country, totalDurationDays, sortOrder, timestamps. Cascade-
--       deletes with the parent visa_applications row.
--
-- All columns are nullable on the parent table so the student can save
-- a partial draft. Required-ness is enforced in the UI's save validator
-- and (for the TB-risk-countries-OR-no-more rule) at the Step 5 save
-- handler in visa.service.
--
-- TB row defaults (country='', totalDurationDays=0) intentionally
-- permit empty rows on create — same draft-then-fill pattern as
-- visa_other_citizenships. The Step 5 frontend save-validator enforces
-- non-empty country and totalDurationDays > 0 before "Save and
-- continue" accepts the step.

ALTER TABLE "visa_applications"
  ADD COLUMN "hasTuberculosis"             BOOLEAN,
  ADD COLUMN "needsRenalDialysis"          BOOLEAN,
  ADD COLUMN "hasMedicalCondition"         BOOLEAN,
  ADD COLUMN "needsResidentialCare"        BOOLEAN,
  ADD COLUMN "isPregnant"                  BOOLEAN,
  ADD COLUMN "intendedLengthOfStay"        TEXT,
  ADD COLUMN "hadMedicalExam"              BOOLEAN,
  ADD COLUMN "medicalRefNumber"            TEXT,
  ADD COLUMN "tbCountriesNoMore"           BOOLEAN,
  ADD COLUMN "insuranceDeclarationAgreed"  BOOLEAN,
  ADD COLUMN "publicHealthAckAgreed"       BOOLEAN;

CREATE TABLE "visa_tb_risk_countries" (
  "id"                  TEXT NOT NULL,
  "visaApplicationId"   TEXT NOT NULL,
  "country"             TEXT NOT NULL,
  "totalDurationDays"   INTEGER NOT NULL,
  "sortOrder"           INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_tb_risk_countries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_tb_risk_countries_visaApplicationId_idx"
  ON "visa_tb_risk_countries"("visaApplicationId");

ALTER TABLE "visa_tb_risk_countries"
  ADD CONSTRAINT "visa_tb_risk_countries_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
