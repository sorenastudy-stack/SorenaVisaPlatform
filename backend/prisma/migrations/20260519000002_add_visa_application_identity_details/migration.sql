-- Visa Section — INZ 1200 rebuild, PR-VISA1 (Identity Details).
-- One row per admission application. This table will grow as later visa
-- sections are added; for now only the Identity Details columns exist.
--
-- otherNames + nationalId hold PII and are stored encrypted (AES-256-GCM)
-- using the same envelope as admission's PR-SEC3 columns
-- ([version:1][iv:12][tag:16][ct:N], see CryptoService).
-- All editable columns are nullable so the student can save a partial draft.

CREATE TABLE "visa_applications" (
  "id"                       TEXT NOT NULL,
  "applicationId"            TEXT NOT NULL,

  "hasMononym"               BOOLEAN,
  "middleNames"              TEXT,
  "hasUsedOtherNames"        BOOLEAN,
  "otherNamesEncrypted"      BYTEA,
  "countryWhenSubmitting"    TEXT,
  "prevAppliedNzVisa"        BOOLEAN,
  "prevRequestedNzeta"       BOOLEAN,
  "everTravelledNz"          BOOLEAN,
  "totalNzTime24Plus"        BOOLEAN,
  "passportIssueDate"        TIMESTAMP(3),
  "passportExpiryDate"       TIMESTAMP(3),
  "passportCountryOfIssue"   TEXT,
  "passportGender"           TEXT,
  "stateOfBirth"             TEXT,
  "cityOfBirth"              TEXT,
  "hasNationalId"            BOOLEAN,
  "nationalIdEncrypted"      BYTEA,
  "nationalIdCountry"        TEXT,

  "currentStep"              INTEGER NOT NULL DEFAULT 1,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visa_applications_applicationId_key"
  ON "visa_applications"("applicationId");

ALTER TABLE "visa_applications"
  ADD CONSTRAINT "visa_applications_applicationId_fkey"
  FOREIGN KEY ("applicationId")
  REFERENCES "admission_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
