-- Visa Section — INZ 1200 rebuild, PR-VISA12 (Immigration assistance).
-- Adds INZ Section "Immigration assistance" fields, single-instance
-- (no child model) so everything lives on the parent visa_applications
-- row:
--   * completingOnBehalf BOOLEAN — gate Y/N. False (or null on draft)
--     means the applicant is completing the form themselves.
--   * immigration_assistance_capacity enum — selected only when the
--     gate = true. Two of the five values (LICENSED_IMMIGRATION_
--     ADVISER, EXEMPT_PERSON) unlock the five adviser fields below;
--     the other three (FAMILY_MEMBER, FRIEND, OTHER) leave those
--     fields null.
--   * adviser_number_encrypted / adviser_full_name_encrypted /
--     adviser_email_encrypted / adviser_contact_number_encrypted —
--     four BYTEA PII columns. Adviser numbers + names + emails +
--     phone numbers are third-party PII; same AES-256-GCM envelope
--     as the Section 10 / 11 encrypted columns.
--   * adviser_is_primary_contact BOOLEAN — whether INZ should route
--     correspondence to the adviser rather than the applicant.
--
-- All columns are nullable so a partial draft can save; the Step 12
-- save validator (visa.service.saveImmigrationAssistance) enforces
-- the conditional-required rules and *clears* the adviser block
-- server-side when the gate flag or capacity removes its need.
--
-- Note: hand-written, applied via `prisma migrate deploy` — same
-- convention as PR-VISA1..VISA11 to avoid `migrate dev` picking up
-- unrelated drift on working production constraints.

CREATE TYPE "ImmigrationAssistanceCapacity" AS ENUM (
  'LICENSED_IMMIGRATION_ADVISER',
  'EXEMPT_PERSON',
  'FAMILY_MEMBER',
  'FRIEND',
  'OTHER'
);

ALTER TABLE "visa_applications"
  ADD COLUMN "completingOnBehalf"            BOOLEAN,
  ADD COLUMN "immigrationAssistanceCapacity" "ImmigrationAssistanceCapacity",
  ADD COLUMN "adviserNumberEncrypted"        BYTEA,
  ADD COLUMN "adviserFullNameEncrypted"      BYTEA,
  ADD COLUMN "adviserEmailEncrypted"         BYTEA,
  ADD COLUMN "adviserContactNumberEncrypted" BYTEA,
  ADD COLUMN "adviserIsPrimaryContact"       BOOLEAN;
