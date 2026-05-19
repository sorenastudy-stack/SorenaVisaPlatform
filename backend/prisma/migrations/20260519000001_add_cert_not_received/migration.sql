-- PR-C1: record student's "I have not received the certificate yet" status
-- on a per-education-entry basis. Defaults to false on existing rows.
ALTER TABLE "admission_education_entries"
  ADD COLUMN "certificateNotReceived" BOOLEAN NOT NULL DEFAULT false;
