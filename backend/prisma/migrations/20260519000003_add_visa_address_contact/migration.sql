-- Visa Section — INZ 1200 rebuild, PR-VISA2 (Address and contact information).
-- Extends visa_applications with the columns INZ collects in Section 2.
--
-- physicalStreetEncrypted and postalStreetEncrypted hold PII (street
-- addresses) and use the same AES-256-GCM envelope as the existing visa +
-- admission encrypted columns ([version:1][iv:12][tag:16][ct:N], see
-- CryptoService).
--
-- The migration leaves every new column nullable. INZ requires several of
-- these at submission time, but during draft entry the student may not have
-- filled them yet — required-ness is enforced in the UI's save validator,
-- not the schema.

ALTER TABLE "visa_applications"
  ADD COLUMN "physicalStreetEncrypted"   BYTEA,
  ADD COLUMN "physicalSuburb"            TEXT,
  ADD COLUMN "physicalCity"              TEXT,
  ADD COLUMN "physicalState"             TEXT,
  ADD COLUMN "physicalPostcode"          TEXT,
  ADD COLUMN "physicalCountry"           TEXT,
  ADD COLUMN "postalSameAsPhysical"      BOOLEAN,
  ADD COLUMN "postalStreetEncrypted"     BYTEA,
  ADD COLUMN "postalSuburb"              TEXT,
  ADD COLUMN "postalCity"                TEXT,
  ADD COLUMN "postalState"               TEXT,
  ADD COLUMN "postalPostcode"            TEXT,
  ADD COLUMN "postalCountry"             TEXT,
  ADD COLUMN "preferredContactNumber"    TEXT,
  ADD COLUMN "alternativeContactNumber"  TEXT;
