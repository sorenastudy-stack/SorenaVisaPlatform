-- Visa Section — INZ 1200 rebuild, PR-VISA10 (Military service).
-- Adds INZ Section D fields:
--   * Three gating Y/Ns: militaryServiceCompulsoryHome (D1),
--     everUndertakenMilitaryService (D2), wasExemptFromMilitaryService
--     (D3) on visa_applications.
--   * exemptExplanationEncrypted (BYTEA) — required only when D3 = true.
--     Stored encrypted via CryptoService (AES-256-GCM, same envelope
--     as dutiesEncrypted / activityEncrypted on earlier visa tables).
--   * visa_military_services repeating table for D4 service-period
--     declarations (only when D2 = Yes). dutiesEncrypted is the only
--     PII column on the row. dateStarted / dateFinished are
--     day-precision DateTimes.
--
-- All columns are nullable so a partial draft can save; the Step 10
-- save validator (visa.service.saveMilitaryHistory) enforces required-
-- ness with field-by-field BadRequestException messages. On Yes→No
-- toggle of D2 the service deletes all visa_military_services rows
-- for the visa application atomically before re-inserting (replace-
-- on-save pattern).
--
-- Note: this migration is hand-written. The auto-generated
-- `prisma migrate dev` output picked up unrelated drift (drops of
-- constraint-backed indexes on admission_applications, DROP DEFAULT
-- on updatedAt columns elsewhere) that would have torn down working
-- production constraints. Matches the established PR-VISA1..VISA9
-- convention of hand-rolling Prisma migrations and applying via
-- `prisma migrate deploy`.

ALTER TABLE "visa_applications"
  ADD COLUMN "militaryServiceCompulsoryHome" BOOLEAN,
  ADD COLUMN "everUndertakenMilitaryService" BOOLEAN,
  ADD COLUMN "wasExemptFromMilitaryService"  BOOLEAN,
  ADD COLUMN "exemptExplanationEncrypted"    BYTEA;

CREATE TABLE "visa_military_services" (
  "id"                 TEXT NOT NULL,
  "visaApplicationId"  TEXT NOT NULL,
  "dateStarted"        TIMESTAMP(3),
  "dateFinished"       TIMESTAMP(3),
  "location"           TEXT,
  "corps"              TEXT,
  "division"           TEXT,
  "brigade"            TEXT,
  "battalion"          TEXT,
  "unit"               TEXT,
  "rank"               TEXT,
  "dutiesEncrypted"    BYTEA,
  "commandingOfficer"  TEXT,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_military_services_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_military_services_visaApplicationId_idx"
  ON "visa_military_services"("visaApplicationId");

ALTER TABLE "visa_military_services"
  ADD CONSTRAINT "visa_military_services_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
