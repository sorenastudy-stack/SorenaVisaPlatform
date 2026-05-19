-- Visa Section — INZ 1200 rebuild, PR-VISA8 (Relationships).
-- Single transaction: ALTER TABLE + 6 CREATE TABLEs + indexes + FKs.
-- All plain DDL — Postgres has no problem batching these.
--
-- Schema reuse (vs. the PR-VISA8 brief):
--   * admission_applications.maritalStatus  → drives the visa
--     partnership-status question read-only. NO new relationshipStatus
--     column added to visa_applications (would duplicate admission).
--   * admission_applications.hasChildren    → drives the Children
--     block visibility. NO new visa-side flag.
-- Only three new flag columns were genuinely missing from admission:
-- hasFormerPartners, hasSiblings, hasNzContacts.
--
-- Every third-party name + passport number + phone + street address
-- is PII and stored encrypted (AES-256-GCM via CryptoService).
-- Plaintext columns hold non-PII identifiers (country, gender, etc).
--
-- visa_partner is singleton (UNIQUE constraint on visaApplicationId).
-- All other child tables are repeating with sortOrder; cascade on
-- parent FK so deleting a visa_application takes the rows with it.

ALTER TABLE "visa_applications"
  ADD COLUMN "hasFormerPartners" BOOLEAN,
  ADD COLUMN "hasSiblings"       BOOLEAN,
  ADD COLUMN "hasNzContacts"     BOOLEAN;

CREATE TABLE "visa_partner" (
  "id"                       TEXT NOT NULL,
  "visaApplicationId"        TEXT NOT NULL,
  "relationshipToApplicant"  TEXT,
  "givenNameEncrypted"       BYTEA,
  "middleNamesEncrypted"     BYTEA,
  "surnameEncrypted"         BYTEA,
  "gender"                   TEXT,
  "dateOfBirth"              TIMESTAMP(3),
  "relationshipStatus"       TEXT,
  "countryOfBirth"           TEXT,
  "stateOfBirth"             TEXT,
  "cityOfBirth"              TEXT,
  "nationality"              TEXT,
  "countryOfResidence"       TEXT,
  "occupation"               TEXT,
  "holdsPassport"            BOOLEAN,
  "passportNumberEncrypted"  BYTEA,
  "passportCountryOfIssue"   TEXT,
  "passportIssueDate"        TIMESTAMP(3),
  "passportExpiryDate"       TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_partner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visa_partner_visaApplicationId_key"
  ON "visa_partner"("visaApplicationId");
ALTER TABLE "visa_partner"
  ADD CONSTRAINT "visa_partner_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_former_partners" (
  "id"                    TEXT NOT NULL,
  "visaApplicationId"     TEXT NOT NULL,
  "givenNameEncrypted"    BYTEA,
  "middleNamesEncrypted"  BYTEA,
  "surnameEncrypted"      BYTEA,
  "gender"                TEXT,
  "dateOfBirth"           TIMESTAMP(3),
  "relationshipStatus"    TEXT,
  "countryOfBirth"        TEXT,
  "nationality"           TEXT,
  "sortOrder"             INTEGER NOT NULL DEFAULT 0,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_former_partners_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visa_former_partners_visaApplicationId_idx"
  ON "visa_former_partners"("visaApplicationId");
ALTER TABLE "visa_former_partners"
  ADD CONSTRAINT "visa_former_partners_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_children" (
  "id"                        TEXT NOT NULL,
  "visaApplicationId"         TEXT NOT NULL,
  "givenNameEncrypted"        BYTEA,
  "middleNamesEncrypted"      BYTEA,
  "surnameEncrypted"          BYTEA,
  "gender"                    TEXT,
  "dateOfBirth"               TIMESTAMP(3),
  "countryOfBirth"            TEXT,
  "nationality"               TEXT,
  "relationshipToApplicant"   TEXT,
  "livesWithApplicant"        BOOLEAN,
  "sortOrder"                 INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_children_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visa_children_visaApplicationId_idx"
  ON "visa_children"("visaApplicationId");
ALTER TABLE "visa_children"
  ADD CONSTRAINT "visa_children_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_parents" (
  "id"                        TEXT NOT NULL,
  "visaApplicationId"         TEXT NOT NULL,
  "givenNameEncrypted"        BYTEA,
  "middleNamesEncrypted"      BYTEA,
  "surnameEncrypted"          BYTEA,
  "relationshipToApplicant"   TEXT,
  "isDeceased"                BOOLEAN,
  "gender"                    TEXT,
  "dateOfBirth"               TIMESTAMP(3),
  "dateOfBirthUnknown"        BOOLEAN,
  "relationshipStatus"        TEXT,
  "countryOfBirth"            TEXT,
  "citizenship"               TEXT,
  "countryOfResidence"        TEXT,
  "occupation"                TEXT,
  "sortOrder"                 INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_parents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visa_parents_visaApplicationId_idx"
  ON "visa_parents"("visaApplicationId");
ALTER TABLE "visa_parents"
  ADD CONSTRAINT "visa_parents_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_siblings" (
  "id"                        TEXT NOT NULL,
  "visaApplicationId"         TEXT NOT NULL,
  "givenNameEncrypted"        BYTEA,
  "middleNamesEncrypted"      BYTEA,
  "surnameEncrypted"          BYTEA,
  "relationshipToApplicant"   TEXT,
  "gender"                    TEXT,
  "dateOfBirth"               TIMESTAMP(3),
  "dateOfBirthUnknown"        BOOLEAN,
  "relationshipStatus"        TEXT,
  "countryOfBirth"            TEXT,
  "citizenship"               TEXT,
  "countryOfResidence"        TEXT,
  "occupation"                TEXT,
  "sortOrder"                 INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_siblings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visa_siblings_visaApplicationId_idx"
  ON "visa_siblings"("visaApplicationId");
ALTER TABLE "visa_siblings"
  ADD CONSTRAINT "visa_siblings_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_nz_contacts" (
  "id"                        TEXT NOT NULL,
  "visaApplicationId"         TEXT NOT NULL,
  "givenNameEncrypted"        BYTEA,
  "middleNamesEncrypted"      BYTEA,
  "surnameEncrypted"          BYTEA,
  "relationshipToApplicant"   TEXT,
  "phoneEncrypted"            BYTEA,
  "email"                     TEXT,
  "streetEncrypted"           BYTEA,
  "suburb"                    TEXT,
  "townCity"                  TEXT,
  "region"                    TEXT,
  "postcode"                  TEXT,
  "sortOrder"                 INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_nz_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visa_nz_contacts_visaApplicationId_idx"
  ON "visa_nz_contacts"("visaApplicationId");
ALTER TABLE "visa_nz_contacts"
  ADD CONSTRAINT "visa_nz_contacts_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
