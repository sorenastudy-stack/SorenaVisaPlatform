-- Encrypt 16 PII fields on admission_applications (PR-SEC3).
-- Cutover migration: drops the plaintext columns and replaces them with
-- BYTEA columns holding AES-256-GCM ciphertext. The ciphertext layout is
-- [version:1][iv:12][tag:16][ct:N] (see CryptoService).
--
-- Pre-launch: no real client data. The single dev test row will lose any
-- values in these columns (acceptable per the spec). Production deployments
-- of this migration require empty plaintext columns or a separate backfill
-- step beforehand.

-- Step 2 — passport + visa narrative
ALTER TABLE "admission_applications" DROP COLUMN "passportNumber";
ALTER TABLE "admission_applications" ADD COLUMN "passportNumberEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "visaRefusalDetails";
ALTER TABLE "admission_applications" ADD COLUMN "visaRefusalDetailsEncrypted" BYTEA;

-- Step 3B — Health free-text
ALTER TABLE "admission_applications" DROP COLUMN "disabilityDetails";
ALTER TABLE "admission_applications" ADD COLUMN "disabilityDetailsEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "evacDetails";
ALTER TABLE "admission_applications" ADD COLUMN "evacDetailsEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "medicalNotes";
ALTER TABLE "admission_applications" ADD COLUMN "medicalNotesEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "otherStudyNotes";
ALTER TABLE "admission_applications" ADD COLUMN "otherStudyNotesEncrypted" BYTEA;

-- Step 5 — Guardian PII
ALTER TABLE "admission_applications" DROP COLUMN "guardianFirstName";
ALTER TABLE "admission_applications" ADD COLUMN "guardianFirstNameEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianLastName";
ALTER TABLE "admission_applications" ADD COLUMN "guardianLastNameEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianMobile";
ALTER TABLE "admission_applications" ADD COLUMN "guardianMobileEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianHomePhone";
ALTER TABLE "admission_applications" ADD COLUMN "guardianHomePhoneEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianStreet";
ALTER TABLE "admission_applications" ADD COLUMN "guardianStreetEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianSuburb";
ALTER TABLE "admission_applications" ADD COLUMN "guardianSuburbEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "guardianPostcode";
ALTER TABLE "admission_applications" ADD COLUMN "guardianPostcodeEncrypted" BYTEA;

-- Step 7 — Counsellor PII + free-text
ALTER TABLE "admission_applications" DROP COLUMN "counsellorFirstName";
ALTER TABLE "admission_applications" ADD COLUMN "counsellorFirstNameEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "counsellorLastName";
ALTER TABLE "admission_applications" ADD COLUMN "counsellorLastNameEncrypted" BYTEA;

ALTER TABLE "admission_applications" DROP COLUMN "agentComments";
ALTER TABLE "admission_applications" ADD COLUMN "agentCommentsEncrypted" BYTEA;
