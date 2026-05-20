-- Visa Section — INZ 1200 rebuild, PR-VISA11 (Travel history).
-- Adds INZ Section "Travel history" fields:
--   * Single gating Y/N hasTravelledInternationally on
--     visa_applications. When No the entries table stays empty; when
--     Yes the student adds one row per international trip in the last
--     5 years (excluding NZ).
--   * visa_arrival_mode / visa_purpose_of_travel enums for the two
--     dropdowns on each entry — encoded as enums rather than free-text
--     to keep INZ's exact option set tamper-proof.
--   * visa_travel_history_entries repeating table. destination /
--     pointOfEntry / otherPurpose are PII (free-text + identifiable
--     locations) and stored encrypted via CryptoService (AES-256-GCM,
--     same envelope as dutiesEncrypted on visa_military_services).
--     Month/year are Ints because INZ collects month-precision and a
--     synthetic day-1 timestamp would be a footgun for downstream
--     date math.
--
-- All columns are nullable so a partial draft can save; the Step 11
-- save validator (visa.service.saveTravelHistory) enforces required-
-- ness with field-by-field BadRequestException messages, mirroring
-- Step 10. On Yes→No toggle of hasTravelledInternationally the
-- service deletes all visa_travel_history_entries rows for the visa
-- application atomically before re-inserting (replace-on-save).
--
-- Note: hand-written, applied via `prisma migrate deploy` — same
-- convention as PR-VISA1..VISA10 to avoid `migrate dev` picking up
-- unrelated drift on working production constraints.

CREATE TYPE "VisaArrivalMode" AS ENUM ('AIR', 'SEA', 'LAND');

CREATE TYPE "VisaPurposeOfTravel" AS ENUM (
  'EDUCATION', 'TOURISM', 'BUSINESS', 'FAMILY',
  'MEDICAL',   'TRANSIT', 'WORK',     'OTHER'
);

ALTER TABLE "visa_applications"
  ADD COLUMN "hasTravelledInternationally" BOOLEAN;

CREATE TABLE "visa_travel_history_entries" (
  "id"                       TEXT NOT NULL,
  "visaApplicationId"        TEXT NOT NULL,
  "destinationEncrypted"     BYTEA,
  "dateEnteredMonth"         INTEGER,
  "dateEnteredYear"          INTEGER,
  "dateExitedMonth"          INTEGER,
  "dateExitedYear"           INTEGER,
  "arrivalMode"              "VisaArrivalMode",
  "pointOfEntryEncrypted"    BYTEA,
  "purposeOfTravel"          "VisaPurposeOfTravel",
  "otherPurposeEncrypted"    BYTEA,
  "sortOrder"                INTEGER NOT NULL DEFAULT 0,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_travel_history_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_travel_history_entries_visaApplicationId_idx"
  ON "visa_travel_history_entries"("visaApplicationId");

ALTER TABLE "visa_travel_history_entries"
  ADD CONSTRAINT "visa_travel_history_entries_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
