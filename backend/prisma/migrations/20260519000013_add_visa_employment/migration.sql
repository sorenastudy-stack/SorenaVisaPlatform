-- Visa Section — INZ 1200 rebuild, PR-VISA7 (Employment history).
-- Three pieces of plain DDL — all coexist in one transaction:
--   (a) ALTER TABLE visa_applications: 5 nullable Y/N columns for the
--       Step 7 screening questions.
--   (b) CREATE TABLE visa_employment_entries: repeating jobs table.
--       One row per job, the CURRENT job and any PREVIOUS jobs share
--       the same table, distinguished by `entryKind`. duties is PII
--       and stored encrypted via CryptoService using the standard
--       AES-256-GCM envelope ([version:1][iv:12][tag:16][ct:N]).
--   (c) CREATE TABLE visa_unemployment_entries: repeating unpaid /
--       voluntary period table. Both free-text fields are PII (the
--       activity description and the financial-support description)
--       and stored encrypted with the same envelope.
--
-- All editable columns on the child tables are nullable so empty
-- rows can be created (draft-then-fill pattern, same as
-- visa_other_citizenships and visa_tb_risk_countries). The Step 7
-- frontend save-validator enforces required-ness before "Save and
-- continue" accepts the step. Cascade FKs on the parent visa
-- application mean deleting the visa application removes everything.

ALTER TABLE "visa_applications"
  ADD COLUMN "everGovernmentEmployed"  BOOLEAN,
  ADD COLUMN "everPrisonGuard"         BOOLEAN,
  ADD COLUMN "currentlyWorking"        BOOLEAN,
  ADD COLUMN "hadPreviousEmployment"   BOOLEAN,
  ADD COLUMN "everUnemployed"          BOOLEAN;

CREATE TABLE "visa_employment_entries" (
  "id"                   TEXT NOT NULL,
  "visaApplicationId"    TEXT NOT NULL,
  "entryKind"            TEXT NOT NULL,
  "startDate"            TIMESTAMP(3),
  "endDate"              TIMESTAMP(3),
  "roleTitle"            TEXT,
  "dutiesEncrypted"      BYTEA,
  "countryOfWork"        TEXT,
  "stateOfWork"          TEXT,
  "supervisorName"       TEXT,
  "organisationField"    TEXT,
  "organisationCountry"  TEXT,
  "organisationState"    TEXT,
  "employerName"         TEXT,
  "employerStreet"       TEXT,
  "employerSuburb"       TEXT,
  "employerTownCity"     TEXT,
  "employerSubregion"    TEXT,
  "employerRegion"       TEXT,
  "employerPostcode"     TEXT,
  "employerPhone"        TEXT,
  "employerEmail"        TEXT,
  "sortOrder"            INTEGER NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_employment_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_employment_entries_visaApplicationId_idx"
  ON "visa_employment_entries"("visaApplicationId");

ALTER TABLE "visa_employment_entries"
  ADD CONSTRAINT "visa_employment_entries_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_unemployment_entries" (
  "id"                          TEXT NOT NULL,
  "visaApplicationId"           TEXT NOT NULL,
  "startDate"                   TIMESTAMP(3),
  "endDate"                     TIMESTAMP(3),
  "activityEncrypted"           BYTEA,
  "financialSupportEncrypted"   BYTEA,
  "sortOrder"                   INTEGER NOT NULL DEFAULT 0,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_unemployment_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_unemployment_entries_visaApplicationId_idx"
  ON "visa_unemployment_entries"("visaApplicationId");

ALTER TABLE "visa_unemployment_entries"
  ADD CONSTRAINT "visa_unemployment_entries_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
