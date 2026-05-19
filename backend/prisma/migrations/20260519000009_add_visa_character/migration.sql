-- Visa Section — INZ 1200 rebuild, PR-VISA4 (Character).
-- Adds the nine Section-4 columns to visa_applications:
--   * Four Y/N character declarations (everConvicted, underInvestigation,
--     everDeportedExcluded, everRefusedVisa)
--   * Three police-certificate metadata fields (issue date, country of
--     issue, is-in-English) — the file itself goes through the admission
--     documents pipeline with documentType=VISA_POLICE_CERTIFICATE
--     (added in 20260519000008).
--   * holdsOtherCitizenships — gate for the "other citizenships" branch
--   * livedOtherCountry5Years — gate for the "lived 5+ years elsewhere"
--     branch (additional uploads under that branch reuse the same
--     VISA_POLICE_CERTIFICATE document type).
--
-- All columns are nullable so the student can save a partial draft.
-- Required-ness is enforced in the UI's save validator, not the schema.

ALTER TABLE "visa_applications"
  ADD COLUMN "everConvicted"             BOOLEAN,
  ADD COLUMN "underInvestigation"        BOOLEAN,
  ADD COLUMN "everDeportedExcluded"      BOOLEAN,
  ADD COLUMN "everRefusedVisa"           BOOLEAN,
  ADD COLUMN "policeCertIssueDate"       TIMESTAMP(3),
  ADD COLUMN "policeCertCountryOfIssue"  TEXT,
  ADD COLUMN "policeCertInEnglish"       BOOLEAN,
  ADD COLUMN "holdsOtherCitizenships"    BOOLEAN,
  ADD COLUMN "livedOtherCountry5Years"   BOOLEAN;
