-- Visa Section — INZ 1200 rebuild, PR-VISA14 (Supporting documents
-- page 2, metadata only). FINAL Visa Section PR.
--
-- File storage is still deferred to a later PR. The new document
-- types extend PR-13's metadata-only pattern: the browser PUTs
-- originalFilename / mimeType / sizeBytes via the existing
-- /students/me/visa/supporting-documents/metadata endpoint; file
-- bytes never reach the backend.
--
-- Adds:
--   * 17 new values to the existing VisaSupportingDocumentType enum
--     so page 2 documents share the (visaApplicationId, documentType)
--     UNIQUE key with page 1.
--   * Two new enums: TuitionPaymentMethod (4 values),
--     OtherEvidenceType (5 values).
--   * 28 new columns on visa_applications:
--       - 2 tuition fields (1 boolean + 1 enum)
--       - 5 funds-source boolean multi-select
--       - 4 outward-source boolean multi-select
--       - 5 funds-format boolean multi-select (shown when
--         fundsSourceSavings = true)
--       - 4 savings-source boolean multi-select (shown when
--         fundsFormatBankAccount = true)
--       - 3 encrypted free-text PII (depositExplanation +
--         scholarshipName + scholarshipOrganisation) — same AES-256-GCM
--         envelope as PR-13's countryOfResidenceEncrypted
--       - 2 work-rights boolean gates
--       - 1 English-test gate
--       - 1 final declaration boolean
--   * visa_other_evidence_entries table — repeating child for the
--     "Other evidence" section. Multiple rows allowed per application
--     (no UNIQUE constraint, unlike visa_supporting_documents).
--     customLabelEncrypted is required only when evidenceType = OTHER.
--
-- All columns nullable so partial drafts can save; the Step 14 save
-- validator (visa.service.saveSupportingDocuments2) enforces the
-- conditional-required rules and *cascade-clears* downstream state
-- when a gate flips false (see service comments for the full ruleset).
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as PR-VISA1..VISA13 to avoid `migrate dev` picking up unrelated
-- drift on working production constraints.

ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'OFFER_OF_PLACE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PHD_RESEARCH_PROPOSAL';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PUBLICATIONS_LIST';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PERSONAL_CIRCUMSTANCES_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PREVIOUS_TERTIARY_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'CURRENT_EMPLOYMENT_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PREVIOUS_EMPLOYMENT_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'ENGLISH_TEST_RESULTS';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'TUITION_PAYMENT_CONFIRMATION';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'INZ1014_FINANCIAL_UNDERTAKING';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'PREPAID_ACCOMMODATION_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'SCHOLARSHIP_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'OUTWARD_TRAVEL_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'BANK_STATEMENTS';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'EMPLOYMENT_INCOME_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'SCHEDULED_HOLIDAY_EVIDENCE';
ALTER TYPE "VisaSupportingDocumentType" ADD VALUE 'OTHER_EVIDENCE';

CREATE TYPE "TuitionPaymentMethod" AS ENUM (
  'SELF_PAID',
  'PARTNER_PROVIDER_OR_GOVT_LOAN',
  'THIRD_PARTY_SPONSOR',
  'SCHOLARSHIP'
);

CREATE TYPE "OtherEvidenceType" AS ENUM (
  'COVER_LETTER',
  'STATEMENT_OF_PURPOSE',
  'ADDITIONAL_FUNDS_EVIDENCE',
  'FAMILY_TIES_EVIDENCE',
  'OTHER'
);

ALTER TABLE "visa_applications"
  ADD COLUMN "tuitionFeesPaid"                  BOOLEAN,
  ADD COLUMN "tuitionPaymentMethod"             "TuitionPaymentMethod",
  ADD COLUMN "fundsSourceSavings"               BOOLEAN,
  ADD COLUMN "fundsSourceNZSponsor"             BOOLEAN,
  ADD COLUMN "fundsSourceInz1014"               BOOLEAN,
  ADD COLUMN "fundsSourcePrepaidAccom"          BOOLEAN,
  ADD COLUMN "fundsSourceScholarship"           BOOLEAN,
  ADD COLUMN "outwardSourceSufficientFunds"     BOOLEAN,
  ADD COLUMN "outwardSourceInz1014"             BOOLEAN,
  ADD COLUMN "outwardSourcePrepaidBooking"      BOOLEAN,
  ADD COLUMN "outwardSourceScholarship"         BOOLEAN,
  ADD COLUMN "fundsFormatBankAccount"           BOOLEAN,
  ADD COLUMN "fundsFormatProvidentFund"         BOOLEAN,
  ADD COLUMN "fundsFormatEducationLoan"         BOOLEAN,
  ADD COLUMN "fundsFormatFixedTermDeposit"      BOOLEAN,
  ADD COLUMN "fundsFormatOther"                 BOOLEAN,
  ADD COLUMN "savingsSourceWages"               BOOLEAN,
  ADD COLUMN "savingsSourceSelfEmployment"      BOOLEAN,
  ADD COLUMN "savingsSourceRentalIncome"        BOOLEAN,
  ADD COLUMN "savingsSourceOther"               BOOLEAN,
  ADD COLUMN "depositExplanationEncrypted"      BYTEA,
  ADD COLUMN "scholarshipNameEncrypted"         BYTEA,
  ADD COLUMN "scholarshipOrganisationEncrypted" BYTEA,
  ADD COLUMN "studyIs120CreditsOrMore"          BOOLEAN,
  ADD COLUMN "courseRequiresPracticalWork"      BOOLEAN,
  ADD COLUMN "tookEnglishTest"                  BOOLEAN,
  ADD COLUMN "declarationChecked"               BOOLEAN;

CREATE TABLE "visa_other_evidence_entries" (
  "id"                    TEXT NOT NULL,
  "visaApplicationId"     TEXT NOT NULL,
  "evidenceType"          "OtherEvidenceType" NOT NULL,
  "customLabelEncrypted"  BYTEA,
  "originalFilename"      TEXT NOT NULL,
  "mimeType"              TEXT NOT NULL,
  "sizeBytes"             INTEGER NOT NULL,
  "uploadedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_other_evidence_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_other_evidence_entries_visaApplicationId_idx"
  ON "visa_other_evidence_entries"("visaApplicationId");

ALTER TABLE "visa_other_evidence_entries"
  ADD CONSTRAINT "visa_other_evidence_entries_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
