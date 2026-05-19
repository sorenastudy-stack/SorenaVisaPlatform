-- Visa Section — INZ 1200 rebuild, PR-VISA4 fix.
-- Adds a repeating child table for the "Do you hold any other
-- citizenships?" = Yes branch of Step 4. Mirrors the
-- admission_education_entries layout: one row per other citizenship,
-- linked back to visa_applications, cascade-deleted on parent removal.
--
-- The Step 4 save handler in visa.service deletes every row in this
-- table for the visa_application when holdsOtherCitizenships is patched
-- to false — keeps the row store clean when the student switches their
-- answer back to No.

CREATE TABLE "visa_other_citizenships" (
  "id"                TEXT NOT NULL,
  "visaApplicationId" TEXT NOT NULL,
  "country"           TEXT NOT NULL,
  "holdsPassport"     BOOLEAN NOT NULL,
  "sortOrder"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_other_citizenships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_other_citizenships_visaApplicationId_idx"
  ON "visa_other_citizenships"("visaApplicationId");

ALTER TABLE "visa_other_citizenships"
  ADD CONSTRAINT "visa_other_citizenships_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
