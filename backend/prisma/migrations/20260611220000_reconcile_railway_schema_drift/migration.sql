-- ─── Reconcile Railway schema drift (idempotent, additive) ──────────────
--
-- Background: Railway's _prisma_migrations table marked the initial
-- migration (20260406091133_init_full_schema) as applied but every
-- subsequent migration (~60 of them) as unapplied AND was not
-- actually running their SQL on deploy. The deployed schema was at
-- "April 2026 initial state" while the code expected "June 2026 head",
-- causing column-not-exist 500s on register / login / etc.
--
-- This migration was generated via `prisma migrate diff --from-url
-- <live-railway-url> --to-schema-datamodel prisma/schema.prisma` and
-- then wrapped to be idempotent so it succeeds whether the artefact
-- (table/column/enum/index/constraint) already exists or not. Every
-- operation is one of:
--   - CREATE TYPE  → wrapped in DO-block guarded by pg_type
--   - CREATE TABLE → CREATE TABLE IF NOT EXISTS
--   - ADD COLUMN   → ADD COLUMN IF NOT EXISTS
--   - ALTER TYPE ADD VALUE → ADD VALUE IF NOT EXISTS
--   - DROP NOT NULL → DO-block guarded by information_schema
--   - ADD CONSTRAINT → DO-block guarded by pg_constraint
--   - CREATE INDEX / UNIQUE INDEX → ... IF NOT EXISTS
--
-- Zero DROP TABLE / DROP COLUMN / TRUNCATE / DELETE. Verified at
-- generation time by grep. Safe to re-run; safe on already-correct
-- databases; safe on a fresh DB after init.

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LegalDecision') THEN
    EXECUTE $sql$CREATE TYPE "LegalDecision" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'WITHDRAWN')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseMessageAuthorRole') THEN
    EXECUTE $sql$CREATE TYPE "CaseMessageAuthorRole" AS ENUM ('LIA', 'CLIENT')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseMessageKind') THEN
    EXECUTE $sql$CREATE TYPE "CaseMessageKind" AS ENUM ('MESSAGE', 'DOCUMENT_REQUEST', 'PROGRESS_UPDATE')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseDocumentReviewSource') THEN
    EXECUTE $sql$CREATE TYPE "CaseDocumentReviewSource" AS ENUM ('ADMISSION', 'APPLICATION', 'VISA_SUPPORTING')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseDocumentReviewStatus') THEN
    EXECUTE $sql$CREATE TYPE "CaseDocumentReviewStatus" AS ENUM ('APPROVED', 'REJECTED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketStatus') THEN
    EXECUTE $sql$CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'AWAITING_CLIENT', 'AWAITING_STAFF', 'RESOLVED', 'CLOSED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketPriority') THEN
    EXECUTE $sql$CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceStatus') THEN
    EXECUTE $sql$CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractSignerRole') THEN
    EXECUTE $sql$CREATE TYPE "ContractSignerRole" AS ENUM ('CLIENT', 'GUARDIAN', 'PARTNER', 'FAMILY_MEMBER', 'LIA', 'DIRECTOR')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractSignerStatus') THEN
    EXECUTE $sql$CREATE TYPE "ContractSignerStatus" AS ENUM ('PENDING', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaIssueOutcome') THEN
    EXECUTE $sql$CREATE TYPE "VisaIssueOutcome" AS ENUM ('APPROVED', 'DECLINED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaExpiryReminderRecipient') THEN
    EXECUTE $sql$CREATE TYPE "VisaExpiryReminderRecipient" AS ENUM ('LIA', 'CLIENT', 'OWNER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdmissionApplicationStatus') THEN
    EXECUTE $sql$CREATE TYPE "AdmissionApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdmissionDocumentType') THEN
    EXECUTE $sql$CREATE TYPE "AdmissionDocumentType" AS ENUM ('PASSPORT', 'NZ_VISA_HISTORY', 'VISA_REFUSAL_LETTER', 'ENGLISH_TEST_EVIDENCE', 'EDUCATION_TRANSCRIPTS', 'SUPPORTING_DOCUMENT', 'NOTARIZED_CERTIFICATE', 'NOTARIZED_TRANSCRIPT', 'VISA_PHOTO', 'VISA_POLICE_CERTIFICATE')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaArrivalMode') THEN
    EXECUTE $sql$CREATE TYPE "VisaArrivalMode" AS ENUM ('AIR', 'SEA', 'LAND')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaPurposeOfTravel') THEN
    EXECUTE $sql$CREATE TYPE "VisaPurposeOfTravel" AS ENUM ('EDUCATION', 'TOURISM', 'BUSINESS', 'FAMILY', 'MEDICAL', 'TRANSIT', 'WORK', 'OTHER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImmigrationAssistanceCapacity') THEN
    EXECUTE $sql$CREATE TYPE "ImmigrationAssistanceCapacity" AS ENUM ('LICENSED_IMMIGRATION_ADVISER', 'EXEMPT_PERSON', 'FAMILY_MEMBER', 'FRIEND', 'OTHER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaSupportingDocumentType') THEN
    EXECUTE $sql$CREATE TYPE "VisaSupportingDocumentType" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'RESIDENCE_VISA', 'MILITARY_RECORD', 'TRAVEL_HISTORY', 'AUTHORITY_DOC', 'OFFER_OF_PLACE', 'PHD_RESEARCH_PROPOSAL', 'PUBLICATIONS_LIST', 'PERSONAL_CIRCUMSTANCES_EVIDENCE', 'PREVIOUS_TERTIARY_EVIDENCE', 'CURRENT_EMPLOYMENT_EVIDENCE', 'PREVIOUS_EMPLOYMENT_EVIDENCE', 'ENGLISH_TEST_RESULTS', 'TUITION_PAYMENT_CONFIRMATION', 'INZ1014_FINANCIAL_UNDERTAKING', 'PREPAID_ACCOMMODATION_EVIDENCE', 'SCHOLARSHIP_EVIDENCE', 'OUTWARD_TRAVEL_EVIDENCE', 'BANK_STATEMENTS', 'EMPLOYMENT_INCOME_EVIDENCE', 'SCHEDULED_HOLIDAY_EVIDENCE', 'OTHER_EVIDENCE')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TuitionPaymentMethod') THEN
    EXECUTE $sql$CREATE TYPE "TuitionPaymentMethod" AS ENUM ('SELF_PAID', 'PARTNER_PROVIDER_OR_GOVT_LOAN', 'THIRD_PARTY_SPONSOR', 'SCHOLARSHIP')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtherEvidenceType') THEN
    EXECUTE $sql$CREATE TYPE "OtherEvidenceType" AS ENUM ('COVER_LETTER', 'STATEMENT_OF_PURPOSE', 'ADDITIONAL_FUNDS_EVIDENCE', 'FAMILY_TIES_EVIDENCE', 'OTHER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaCaseStatus') THEN
    EXECUTE $sql$CREATE TYPE "VisaCaseStatus" AS ENUM ('DRAFT', 'SUBMITTED_FOR_REVIEW', 'REVIEWED', 'READY_FOR_INZ', 'INZ_SUBMITTED', 'APPROVED', 'DECLINED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaTicketDepartment') THEN
    EXECUTE $sql$CREATE TYPE "VisaTicketDepartment" AS ENUM ('ADMISSIONS', 'VISA_APPLICATION', 'DOCUMENTS', 'PAYMENTS_FINANCE', 'TECHNICAL_SUPPORT', 'GENERAL_INQUIRY')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaTicketStatus') THEN
    EXECUTE $sql$CREATE TYPE "VisaTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaTicketPriority') THEN
    EXECUTE $sql$CREATE TYPE "VisaTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaTicketMessageAuthorRole') THEN
    EXECUTE $sql$CREATE TYPE "VisaTicketMessageAuthorRole" AS ENUM ('CLIENT', 'STAFF', 'SYSTEM')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaCaseFileNoteType') THEN
    EXECUTE $sql$CREATE TYPE "VisaCaseFileNoteType" AS ENUM ('TICKET', 'MEETING_TRANSCRIPT', 'CONSULTANT_NOTE', 'SYSTEM_EVENT')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaMeetingStatus') THEN
    EXECUTE $sql$CREATE TYPE "VisaMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaMeetingType') THEN
    EXECUTE $sql$CREATE TYPE "VisaMeetingType" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'DOCUMENT_REVIEW', 'ASSESSMENT')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaChatMessageRole') THEN
    EXECUTE $sql$CREATE TYPE "VisaChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VisaCaseRoleSlot') THEN
    EXECUTE $sql$CREATE TYPE "VisaCaseRoleSlot" AS ENUM ('LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OwnerApprovalStatus') THEN
    EXECUTE $sql$CREATE TYPE "OwnerApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'EXECUTION_FAILED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OwnerApprovalActionType') THEN
    EXECUTE $sql$CREATE TYPE "OwnerApprovalActionType" AS ENUM ('CREATE_STAFF_USER', 'CHANGE_STAFF_ROLE', 'DEACTIVATE_STAFF', 'DELETE_CASE', 'DELETE_STUDENT', 'ISSUE_REFUND', 'CHANGE_PLATFORM_SETTING', 'HARD_DELETE_STAFF')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScorecardBand') THEN
    EXECUTE $sql$CREATE TYPE "ScorecardBand" AS ENUM ('BAND_1', 'BAND_2', 'BAND_3', 'BAND_4', 'BAND_5', 'BAND_6')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScorecardNextAction') THEN
    EXECUTE $sql$CREATE TYPE "ScorecardNextAction" AS ENUM ('NURTURE_ONLY', 'PAY_GAP_CLOSING_SESSION', 'BOOK_FREE_15MIN_SESSION', 'BLOCKED_HARD_STOP')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketingChannelType') THEN
    EXECUTE $sql$CREATE TYPE "MarketingChannelType" AS ENUM ('INSTAGRAM', 'LINKEDIN', 'YOUTUBE', 'TWITTER', 'WHATSAPP', 'EMAIL', 'WIX_HOMEPAGE', 'TELEGRAM', 'TIKTOK', 'FACEBOOK', 'DIRECT', 'OTHER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffiliateAgentStatus') THEN
    EXECUTE $sql$CREATE TYPE "AffiliateAgentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'TERMINATED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TrackingLinkStatus') THEN
    EXECUTE $sql$CREATE TYPE "TrackingLinkStatus" AS ENUM ('ACTIVE', 'ARCHIVED')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WixPaymentType') THEN
    EXECUTE $sql$CREATE TYPE "WixPaymentType" AS ENUM ('FREE_15MIN', 'GAP_CLOSING', 'LIA_CONSULTATION', 'OTHER')$sql$;
  END IF;
END $do$;

-- CreateEnum
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WixPaymentStatus') THEN
    EXECUTE $sql$CREATE TYPE "WixPaymentStatus" AS ENUM ('RECEIVED', 'REFUNDED', 'DISPUTED')$sql$;
  END IF;
END $do$;

-- AlterEnum
ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'INZ_SUBMITTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LEAD';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STUDENT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AGENT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CONSULTANT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FINANCE';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS     "actorNameSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS     "actorRoleSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS     "eventType" TEXT;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS     "inzApplicationNumber" VARCHAR(128),
ADD COLUMN IF NOT EXISTS     "inzReceiptFileName" TEXT,
ADD COLUMN IF NOT EXISTS     "inzReceiptFileUrl" TEXT,
ADD COLUMN IF NOT EXISTS     "inzReceiptMimeType" TEXT,
ADD COLUMN IF NOT EXISTS     "inzReceiptSizeBytes" INTEGER,
ADD COLUMN IF NOT EXISTS     "inzSubmissionNotes" TEXT,
ADD COLUMN IF NOT EXISTS     "inzSubmittedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "liaAssignedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "liaId" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "gender" TEXT,
ADD COLUMN IF NOT EXISTS     "photoUrl" TEXT,
ADD COLUMN IF NOT EXISTS     "userId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS     "attributedAgentId" TEXT,
ADD COLUMN IF NOT EXISTS     "countryRaw" TEXT,
ADD COLUMN IF NOT EXISTS     "currentEducationLevel" TEXT,
ADD COLUMN IF NOT EXISTS     "externalSubmissionId" TEXT,
ADD COLUMN IF NOT EXISTS     "trackingLinkId" TEXT,
ADD COLUMN IF NOT EXISTS     "webhookMetadata" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS     "address" TEXT,
ADD COLUMN IF NOT EXISTS     "countryOfResidence" TEXT,
ADD COLUMN IF NOT EXISTS     "emergencyContact" TEXT,
ADD COLUMN IF NOT EXISTS     "googleId" TEXT,
ADD COLUMN IF NOT EXISTS     "mobileNumber" TEXT,
ADD COLUMN IF NOT EXISTS     "specialisedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "magic_link_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_status_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "isUndo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visas" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "outcome" "VisaIssueOutcome" NOT NULL,
    "visaStartDate" TIMESTAMP(3),
    "visaEndDate" TIMESTAMP(3),
    "visaDocumentUrl" TEXT,
    "visaDocumentName" TEXT,
    "visaDocumentMime" TEXT,
    "visaDocumentSize" INTEGER,
    "declineReasonEncrypted" BYTEA,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "immigration_officers" (
    "id" TEXT NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "officerCode" VARCHAR(64),
    "branch" VARCHAR(200),
    "countryOfPosting" VARCHAR(120),
    "profileDescriptionEncrypted" BYTEA,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "immigration_officers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "immigration_officer_observations" (
    "id" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyEncrypted" BYTEA NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "immigration_officer_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_officer_linkages" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "linkedOutcome" "VisaIssueOutcome",
    "noteEncrypted" BYTEA,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_officer_linkages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_expiry_reminders_sent" (
    "id" TEXT NOT NULL,
    "visaId" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "recipient" "VisaExpiryReminderRecipient" NOT NULL,
    "recipientUserId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailDeliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailErrorMessage" TEXT,

    CONSTRAINT "visa_expiry_reminders_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "contract_signers" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "role" "ContractSignerRole" NOT NULL,
    "routingOrder" INTEGER NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signingOnBehalfOf" TEXT,
    "userId" TEXT,
    "status" "ContractSignerStatus" NOT NULL DEFAULT 'PENDING',
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "docusignRecipientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "legal_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyEncrypted" BYTEA NOT NULL,
    "decision" "LegalDecision",
    "decisionReasonEncrypted" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_messages" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "CaseMessageAuthorRole" NOT NULL,
    "kind" "CaseMessageKind" NOT NULL DEFAULT 'MESSAGE',
    "bodyEncrypted" BYTEA NOT NULL,
    "requestedDocType" TEXT,
    "fulfilledByFileId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "readByClient" BOOLEAN NOT NULL DEFAULT false,
    "readByLia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_document_reviews" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "source" "CaseDocumentReviewSource" NOT NULL,
    "sourceRowId" TEXT NOT NULL,
    "status" "CaseDocumentReviewStatus" NOT NULL,
    "reasonEncrypted" BYTEA NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tickets" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "contactId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[],
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "contactId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "stripeInvoiceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payments" (
    "id" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "caseId" TEXT,
    "paymentType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'nzd',
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admission_applications" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "AdmissionApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "termsAgreedAt" TIMESTAMP(3),
    "dateOfBirth" TIMESTAMP(3),
    "maritalStatus" TEXT,
    "hasChildren" BOOLEAN,
    "phone" TEXT,
    "phoneType" TEXT,
    "countryOfBirth" TEXT,
    "citizenship" TEXT,
    "ethnicity" TEXT,
    "passportNumberEncrypted" BYTEA,
    "visaRefused" BOOLEAN,
    "visaRefusalDetailsEncrypted" BYTEA,
    "englishTestSat" BOOLEAN,
    "englishTestName" TEXT,
    "englishPreCourse" BOOLEAN,
    "hasDisability" BOOLEAN,
    "disabilityDetailsEncrypted" BYTEA,
    "needsEvacAssistance" BOOLEAN,
    "evacDetailsEncrypted" BYTEA,
    "medicalNotesEncrypted" BYTEA,
    "otherStudyNotesEncrypted" BYTEA,
    "schoolCountry" TEXT,
    "schoolName" TEXT,
    "schoolQualification" TEXT,
    "qualificationCompleted" BOOLEAN,
    "qualYearStart" INTEGER,
    "qualYearEnd" INTEGER,
    "lastYearOfSchool" INTEGER,
    "highestQualification" TEXT,
    "sponsorshipProgramme" TEXT,
    "guardianRelationship" TEXT,
    "guardianFirstNameEncrypted" BYTEA,
    "guardianLastNameEncrypted" BYTEA,
    "guardianEmail" TEXT,
    "guardianMobileEncrypted" BYTEA,
    "guardianHomePhoneEncrypted" BYTEA,
    "guardianAddressSameAs" BOOLEAN,
    "guardianStreetEncrypted" BYTEA,
    "guardianSuburbEncrypted" BYTEA,
    "guardianCity" TEXT,
    "guardianState" TEXT,
    "guardianCountry" TEXT,
    "guardianPostcodeEncrypted" BYTEA,
    "accommodationType" TEXT,
    "counsellorFirstNameEncrypted" BYTEA,
    "counsellorLastNameEncrypted" BYTEA,
    "counsellorEmail" TEXT,
    "anotherBranch" BOOLEAN,
    "branchAgentCode" TEXT,
    "branchName" TEXT,
    "agentDeclarationAgreed" BOOLEAN,
    "agentCommentsEncrypted" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admission_education_entries" (
    "id" TEXT NOT NULL,
    "admissionApplicationId" TEXT NOT NULL,
    "qualificationLevel" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "certificateNotReceived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_education_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admission_programme_choices" (
    "id" TEXT NOT NULL,
    "admissionApplicationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "intakeMonth" INTEGER NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_programme_choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admission_documents" (
    "id" TEXT NOT NULL,
    "admissionApplicationId" TEXT NOT NULL,
    "educationEntryId" TEXT,
    "documentType" "AdmissionDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "agencyCode" TEXT NOT NULL,
    "branchName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lia_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "iaaLicenceNumber" TEXT,
    "iaaLicenceFileUrl" TEXT,
    "iaaLicenceFileName" TEXT,
    "iaaLicenceFileMime" TEXT,
    "iaaLicenceSizeBytes" INTEGER,
    "iaaLicenceVerifiedAt" TIMESTAMP(3),
    "iaaLicenceVerifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lia_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_applications" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "hasMononym" BOOLEAN,
    "middleNames" TEXT,
    "hasUsedOtherNames" BOOLEAN,
    "otherNamesEncrypted" BYTEA,
    "countryWhenSubmitting" TEXT,
    "prevAppliedNzVisa" BOOLEAN,
    "prevRequestedNzeta" BOOLEAN,
    "everTravelledNz" BOOLEAN,
    "totalNzTime24Plus" BOOLEAN,
    "passportIssueDate" TIMESTAMP(3),
    "passportExpiryDate" TIMESTAMP(3),
    "passportCountryOfIssue" TEXT,
    "passportGender" TEXT,
    "stateOfBirth" TEXT,
    "cityOfBirth" TEXT,
    "hasNationalId" BOOLEAN,
    "nationalIdEncrypted" BYTEA,
    "nationalIdCountry" TEXT,
    "physicalStreetEncrypted" BYTEA,
    "physicalSuburb" TEXT,
    "physicalCity" TEXT,
    "physicalState" TEXT,
    "physicalPostcode" TEXT,
    "physicalCountry" TEXT,
    "postalSameAsPhysical" BOOLEAN,
    "postalStreetEncrypted" BYTEA,
    "postalSuburb" TEXT,
    "postalCity" TEXT,
    "postalState" TEXT,
    "postalPostcode" TEXT,
    "postalCountry" TEXT,
    "preferredContactCountryCode" TEXT,
    "preferredContactNumber" TEXT,
    "alternativeContactCountryCode" TEXT,
    "alternativeContactNumber" TEXT,
    "holdsNzStudentVisa" BOOLEAN,
    "usedEducationAgent" BOOLEAN,
    "agentOrganisationName" TEXT,
    "agentCountry" TEXT,
    "agentGivenName" TEXT,
    "agentSurname" TEXT,
    "agentEmail" TEXT,
    "studyingSchoolLevel" BOOLEAN,
    "studyingMastersOrPhd" TEXT,
    "educationProviderName" TEXT,
    "studyLocation" TEXT,
    "courseRequiresOtherLocation" BOOLEAN,
    "courseProgrammeName" TEXT,
    "courseStartDate" TIMESTAMP(3),
    "courseEndDate" TIMESTAMP(3),
    "intendedArrivalDate" TIMESTAMP(3),
    "phdDiscipline" TEXT,
    "phdSubject" TEXT,
    "phdSupervisorTitle" TEXT,
    "phdSupervisorGivenName" TEXT,
    "phdSupervisorSurname" TEXT,
    "phdSupervisorOrganisation" TEXT,
    "phdPublishedPapers" BOOLEAN,
    "phdSupervisorOutsideNz" BOOLEAN,
    "providerIssuedStudentId" BOOLEAN,
    "studentIdNumber" TEXT,
    "homeCommitmentsEncrypted" BYTEA,
    "studyRelatesToPrevious" BOOLEAN,
    "studyRelatesDetailsEncrypted" BYTEA,
    "whyStudyNzEncrypted" BYTEA,
    "whyThisProviderEncrypted" BYTEA,
    "howCourseBenefitsEncrypted" BYTEA,
    "plansAfterStudyEncrypted" BYTEA,
    "studyingMultiYear" BOOLEAN,
    "everConvicted" BOOLEAN,
    "underInvestigation" BOOLEAN,
    "everDeportedExcluded" BOOLEAN,
    "everRefusedVisa" BOOLEAN,
    "policeCertIssueDate" TIMESTAMP(3),
    "policeCertCountryOfIssue" TEXT,
    "policeCertInEnglish" BOOLEAN,
    "holdsOtherCitizenships" BOOLEAN,
    "livedOtherCountry5Years" BOOLEAN,
    "hasTuberculosis" BOOLEAN,
    "needsRenalDialysis" BOOLEAN,
    "hasMedicalCondition" BOOLEAN,
    "needsResidentialCare" BOOLEAN,
    "isPregnant" BOOLEAN,
    "intendedLengthOfStay" TEXT,
    "hadMedicalExam" BOOLEAN,
    "medicalRefNumber" TEXT,
    "tbCountriesNoMore" BOOLEAN,
    "insuranceDeclarationAgreed" BOOLEAN,
    "publicHealthAckAgreed" BOOLEAN,
    "everGovernmentEmployed" BOOLEAN,
    "everPrisonGuard" BOOLEAN,
    "currentlyWorking" BOOLEAN,
    "hadPreviousEmployment" BOOLEAN,
    "everUnemployed" BOOLEAN,
    "hasFormerPartners" BOOLEAN,
    "hasSiblings" BOOLEAN,
    "hasNzContacts" BOOLEAN,
    "heldReligiousCulturalPosition" BOOLEAN,
    "heldPoliticalAppointment" BOOLEAN,
    "hadPoliticalAssociation" BOOLEAN,
    "associatedIntelligenceAgency" BOOLEAN,
    "witnessedIllTreatment" BOOLEAN,
    "involvedArmedConflict" BOOLEAN,
    "associatedViolentGroup" BOOLEAN,
    "involvedWarCrimes" BOOLEAN,
    "memberLiberationMilitia" BOOLEAN,
    "everDetainedImprisoned" BOOLEAN,
    "militaryServiceCompulsoryHome" BOOLEAN,
    "everUndertakenMilitaryService" BOOLEAN,
    "wasExemptFromMilitaryService" BOOLEAN,
    "exemptExplanationEncrypted" BYTEA,
    "hasTravelledInternationally" BOOLEAN,
    "completingOnBehalf" BOOLEAN,
    "immigrationAssistanceCapacity" "ImmigrationAssistanceCapacity",
    "adviserNumberEncrypted" BYTEA,
    "adviserFullNameEncrypted" BYTEA,
    "adviserEmailEncrypted" BYTEA,
    "adviserContactNumberEncrypted" BYTEA,
    "adviserIsPrimaryContact" BOOLEAN,
    "livingInDifferentCountry" BOOLEAN,
    "countryOfResidenceEncrypted" BYTEA,
    "areAllDocsInEnglish" BOOLEAN,
    "tuitionFeesPaid" BOOLEAN,
    "tuitionPaymentMethod" "TuitionPaymentMethod",
    "fundsSourceSavings" BOOLEAN,
    "fundsSourceNZSponsor" BOOLEAN,
    "fundsSourceInz1014" BOOLEAN,
    "fundsSourcePrepaidAccom" BOOLEAN,
    "fundsSourceScholarship" BOOLEAN,
    "outwardSourceSufficientFunds" BOOLEAN,
    "outwardSourceInz1014" BOOLEAN,
    "outwardSourcePrepaidBooking" BOOLEAN,
    "outwardSourceScholarship" BOOLEAN,
    "fundsFormatBankAccount" BOOLEAN,
    "fundsFormatProvidentFund" BOOLEAN,
    "fundsFormatEducationLoan" BOOLEAN,
    "fundsFormatFixedTermDeposit" BOOLEAN,
    "fundsFormatOther" BOOLEAN,
    "savingsSourceWages" BOOLEAN,
    "savingsSourceSelfEmployment" BOOLEAN,
    "savingsSourceRentalIncome" BOOLEAN,
    "savingsSourceOther" BOOLEAN,
    "depositExplanationEncrypted" BYTEA,
    "scholarshipNameEncrypted" BYTEA,
    "scholarshipOrganisationEncrypted" BYTEA,
    "studyIs120CreditsOrMore" BOOLEAN,
    "courseRequiresPracticalWork" BOOLEAN,
    "tookEnglishTest" BOOLEAN,
    "declarationChecked" BOOLEAN,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_partner" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "relationshipToApplicant" TEXT,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "relationshipStatus" TEXT,
    "countryOfBirth" TEXT,
    "stateOfBirth" TEXT,
    "cityOfBirth" TEXT,
    "nationality" TEXT,
    "countryOfResidence" TEXT,
    "occupation" TEXT,
    "holdsPassport" BOOLEAN,
    "passportNumberEncrypted" BYTEA,
    "passportCountryOfIssue" TEXT,
    "passportIssueDate" TIMESTAMP(3),
    "passportExpiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_former_partners" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "relationshipStatus" TEXT,
    "countryOfBirth" TEXT,
    "nationality" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_former_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_children" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "countryOfBirth" TEXT,
    "nationality" TEXT,
    "relationshipToApplicant" TEXT,
    "livesWithApplicant" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_parents" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "relationshipToApplicant" TEXT,
    "isDeceased" BOOLEAN,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "dateOfBirthUnknown" BOOLEAN,
    "relationshipStatus" TEXT,
    "countryOfBirth" TEXT,
    "citizenship" TEXT,
    "countryOfResidence" TEXT,
    "occupation" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_siblings" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "relationshipToApplicant" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "dateOfBirthUnknown" BOOLEAN,
    "relationshipStatus" TEXT,
    "countryOfBirth" TEXT,
    "citizenship" TEXT,
    "countryOfResidence" TEXT,
    "occupation" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_siblings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_nz_contacts" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "givenNameEncrypted" BYTEA,
    "middleNamesEncrypted" BYTEA,
    "surnameEncrypted" BYTEA,
    "relationshipToApplicant" TEXT,
    "phoneEncrypted" BYTEA,
    "email" TEXT,
    "streetEncrypted" BYTEA,
    "suburb" TEXT,
    "townCity" TEXT,
    "region" TEXT,
    "postcode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_nz_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_employment_entries" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "entryKind" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "roleTitle" TEXT,
    "dutiesEncrypted" BYTEA,
    "countryOfWork" TEXT,
    "stateOfWork" TEXT,
    "supervisorName" TEXT,
    "organisationField" TEXT,
    "organisationCountry" TEXT,
    "organisationState" TEXT,
    "employerName" TEXT,
    "employerStreet" TEXT,
    "employerSuburb" TEXT,
    "employerTownCity" TEXT,
    "employerSubregion" TEXT,
    "employerRegion" TEXT,
    "employerPostcode" TEXT,
    "employerPhone" TEXT,
    "employerEmail" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_employment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_unemployment_entries" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "activityEncrypted" BYTEA,
    "financialSupportEncrypted" BYTEA,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_unemployment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_education_supplements" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "educationEntryId" TEXT NOT NULL,
    "startMonth" INTEGER,
    "endMonth" INTEGER,
    "institutionState" TEXT,
    "institutionTown" TEXT,
    "qualificationAwarded" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_education_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_tb_risk_countries" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "totalDurationDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_tb_risk_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_military_services" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "dateStarted" TIMESTAMP(3),
    "dateFinished" TIMESTAMP(3),
    "location" TEXT,
    "corps" TEXT,
    "division" TEXT,
    "brigade" TEXT,
    "battalion" TEXT,
    "unit" TEXT,
    "rank" TEXT,
    "dutiesEncrypted" BYTEA,
    "commandingOfficer" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_military_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_supporting_documents" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "documentType" "VisaSupportingDocumentType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_supporting_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_other_evidence_entries" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "evidenceType" "OtherEvidenceType" NOT NULL,
    "customLabelEncrypted" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_other_evidence_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_supporting_document_files" (
    "id" TEXT NOT NULL,
    "visaSupportingDocumentId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_supporting_document_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_other_evidence_entry_files" (
    "id" TEXT NOT NULL,
    "visaOtherEvidenceEntryId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_other_evidence_entry_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_cases" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignedConsultantId" TEXT,
    "status" "VisaCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "assessment_reports" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "score" INTEGER,
    "band" INTEGER,
    "route" TEXT,
    "summaryNarrativeEncrypted" BYTEA,
    "aiRecommendations" JSONB,
    "sourceSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_support_tickets" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "assignedStaffId" TEXT,
    "department" "VisaTicketDepartment" NOT NULL,
    "subjectEncrypted" BYTEA NOT NULL,
    "status" "VisaTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "VisaTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "lastClientMessageAt" TIMESTAMP(3),
    "lastStaffMessageAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "VisaTicketMessageAuthorRole" NOT NULL,
    "bodyEncrypted" BYTEA NOT NULL,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_case_file_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "noteType" "VisaCaseFileNoteType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "summaryEncrypted" BYTEA NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_case_file_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_meetings" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "consultantId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "VisaMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "meetingType" "VisaMeetingType" NOT NULL DEFAULT 'CONSULTATION',
    "locationOrLink" TEXT,
    "agenda" TEXT,
    "transcriptNotes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_meeting_transcripts" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_meeting_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_chat_conversations" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "visa_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "VisaChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "modelUsed" TEXT,
    "escalationOffered" BOOLEAN NOT NULL DEFAULT false,
    "escalatedTicketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_travel_history_entries" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "destinationEncrypted" BYTEA,
    "dateEnteredMonth" INTEGER,
    "dateEnteredYear" INTEGER,
    "dateExitedMonth" INTEGER,
    "dateExitedYear" INTEGER,
    "arrivalMode" "VisaArrivalMode",
    "pointOfEntryEncrypted" BYTEA,
    "purposeOfTravel" "VisaPurposeOfTravel",
    "otherPurposeEncrypted" BYTEA,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_travel_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_other_citizenships" (
    "id" TEXT NOT NULL,
    "visaApplicationId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "holdsPassport" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_other_citizenships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "visa_case_assignments" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "roleSlot" "VisaCaseRoleSlot" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,
    "unassignedAt" TIMESTAMP(3),
    "unassignedById" TEXT,

    CONSTRAINT "visa_case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "owner_approval_requests" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "actionType" "OwnerApprovalActionType" NOT NULL,
    "payload" TEXT NOT NULL,
    "reason" TEXT,
    "status" "OwnerApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "executionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "staff_active_status" (
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,

    CONSTRAINT "staff_active_status_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_STRIPE_INTEGRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "category" VARCHAR(50) NOT NULL DEFAULT 'general',
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scorecard_submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answersEncrypted" BYTEA NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "category1Score" INTEGER NOT NULL,
    "category2Score" INTEGER NOT NULL,
    "category3Score" INTEGER NOT NULL,
    "category4Score" INTEGER NOT NULL,
    "band" "ScorecardBand" NOT NULL,
    "hardStops" JSONB NOT NULL,
    "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "executionEligible" BOOLEAN NOT NULL,
    "gateResults" JSONB NOT NULL,
    "nextAction" "ScorecardNextAction" NOT NULL,
    "nextActionTextEn" TEXT NOT NULL,
    "nextActionTextFa" TEXT NOT NULL,
    "nextActionContent" JSONB,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "draftLastSavedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,
    "consultationBookedAt" TIMESTAMP(3),
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,

    CONSTRAINT "scorecard_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_agents" (
    "id" TEXT NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "email" VARCHAR(200),
    "phone" VARCHAR(64),
    "status" "AffiliateAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tracking_links" (
    "id" TEXT NOT NULL,
    "shortCode" VARCHAR(16) NOT NULL,
    "channel" "MarketingChannelType" NOT NULL,
    "agentId" TEXT,
    "campaignLabel" VARCHAR(200),
    "destination" TEXT NOT NULL,
    "status" "TrackingLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tracking_link_clicks" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,
    "referer" TEXT,

    CONSTRAINT "tracking_link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "wix_payments" (
    "id" TEXT NOT NULL,
    "wixPaymentId" VARCHAR(200) NOT NULL,
    "wixBookingId" VARCHAR(200),
    "paymentType" "WixPaymentType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "WixPaymentStatus" NOT NULL DEFAULT 'RECEIVED',
    "customerEmail" VARCHAR(200) NOT NULL,
    "customerName" VARCHAR(200),
    "customerPhone" VARCHAR(64),
    "bookingStart" TIMESTAMP(3),
    "bookingEnd" TIMESTAMP(3),
    "bookingLocation" VARCHAR(200),
    "matchedLeadId" TEXT,
    "matchedUserId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wix_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "magic_link_tokens_userId_idx" ON "magic_link_tokens"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_status_history_leadId_createdAt_idx" ON "lead_status_history"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visas_caseId_key" ON "visas"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visas_issuedById_issuedAt_idx" ON "visas"("issuedById", "issuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visas_visaEndDate_idx" ON "visas"("visaEndDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "immigration_officers_fullName_idx" ON "immigration_officers"("fullName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "immigration_officers_branch_idx" ON "immigration_officers"("branch");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "immigration_officers_countryOfPosting_idx" ON "immigration_officers"("countryOfPosting");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "immigration_officer_observations_officerId_createdAt_idx" ON "immigration_officer_observations"("officerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "immigration_officer_observations_authorId_createdAt_idx" ON "immigration_officer_observations"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "case_officer_linkages_caseId_key" ON "case_officer_linkages"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_officer_linkages_officerId_linkedAt_idx" ON "case_officer_linkages"("officerId", "linkedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_officer_linkages_linkedAt_idx" ON "case_officer_linkages"("linkedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "case_officer_linkages_caseId_officerId_key" ON "case_officer_linkages"("caseId", "officerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_expiry_reminders_sent_visaId_sentAt_idx" ON "visa_expiry_reminders_sent"("visaId", "sentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_expiry_reminders_sent_sentAt_idx" ON "visa_expiry_reminders_sent"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_expiry_reminders_sent_visaId_thresholdDays_recipient_key" ON "visa_expiry_reminders_sent"("visaId", "thresholdDays", "recipient");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_signers_contractId_idx" ON "contract_signers"("contractId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_signers_userId_idx" ON "contract_signers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contract_signers_contractId_routingOrder_key" ON "contract_signers"("contractId", "routingOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "legal_notes_caseId_createdAt_idx" ON "legal_notes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_messages_caseId_createdAt_idx" ON "case_messages"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_messages_caseId_readByClient_idx" ON "case_messages"("caseId", "readByClient");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_messages_caseId_readByLia_idx" ON "case_messages"("caseId", "readByLia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_document_reviews_caseId_reviewedAt_idx" ON "case_document_reviews"("caseId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "case_document_reviews_source_sourceRowId_key" ON "case_document_reviews"("source", "sourceRowId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_contactId_idx" ON "tickets"("contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_caseId_idx" ON "tickets"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_contactId_idx" ON "invoices"("contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_leadId_idx" ON "payments"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_caseId_idx" ON "payments"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_applications_caseId_idx" ON "admission_applications"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_applications_contactId_idx" ON "admission_applications"("contactId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_applications_status_idx" ON "admission_applications"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_education_entries_admissionApplicationId_idx" ON "admission_education_entries"("admissionApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_programme_choices_admissionApplicationId_idx" ON "admission_programme_choices"("admissionApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_documents_admissionApplicationId_idx" ON "admission_documents"("admissionApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admission_documents_educationEntryId_idx" ON "admission_documents"("educationEntryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profiles_userId_key" ON "agent_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profiles_agencyCode_key" ON "agent_profiles"("agencyCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lia_profiles_userId_key" ON "lia_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lia_profiles_iaaLicenceNumber_key" ON "lia_profiles"("iaaLicenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_applications_applicationId_key" ON "visa_applications"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_partner_visaApplicationId_key" ON "visa_partner"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_former_partners_visaApplicationId_idx" ON "visa_former_partners"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_children_visaApplicationId_idx" ON "visa_children"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_parents_visaApplicationId_idx" ON "visa_parents"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_siblings_visaApplicationId_idx" ON "visa_siblings"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_nz_contacts_visaApplicationId_idx" ON "visa_nz_contacts"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_employment_entries_visaApplicationId_idx" ON "visa_employment_entries"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_unemployment_entries_visaApplicationId_idx" ON "visa_unemployment_entries"("visaApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_education_supplements_educationEntryId_key" ON "visa_education_supplements"("educationEntryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_education_supplements_visaApplicationId_idx" ON "visa_education_supplements"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_tb_risk_countries_visaApplicationId_idx" ON "visa_tb_risk_countries"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_military_services_visaApplicationId_idx" ON "visa_military_services"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_supporting_documents_visaApplicationId_idx" ON "visa_supporting_documents"("visaApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_supporting_documents_visaApplicationId_documentType_key" ON "visa_supporting_documents"("visaApplicationId", "documentType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_other_evidence_entries_visaApplicationId_idx" ON "visa_other_evidence_entries"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_supporting_document_files_visaSupportingDocumentId_idx" ON "visa_supporting_document_files"("visaSupportingDocumentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_other_evidence_entry_files_visaOtherEvidenceEntryId_idx" ON "visa_other_evidence_entry_files"("visaOtherEvidenceEntryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_cases_visaApplicationId_key" ON "visa_cases"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_cases_clientId_idx" ON "visa_cases"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_cases_assignedConsultantId_idx" ON "visa_cases"("assignedConsultantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_cases_status_idx" ON "visa_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "assessment_reports_clientId_key" ON "assessment_reports"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_support_tickets_clientId_status_idx" ON "visa_support_tickets"("clientId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_support_tickets_assignedStaffId_status_idx" ON "visa_support_tickets"("assignedStaffId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_support_tickets_caseId_idx" ON "visa_support_tickets"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_support_ticket_messages_ticketId_createdAt_idx" ON "visa_support_ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_case_file_notes_caseId_createdAt_idx" ON "visa_case_file_notes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_case_file_notes_referenceId_idx" ON "visa_case_file_notes"("referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_meetings_studentId_scheduledAt_idx" ON "visa_meetings"("studentId", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_meetings_consultantId_scheduledAt_idx" ON "visa_meetings"("consultantId", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_meetings_status_idx" ON "visa_meetings"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "visa_meeting_transcripts_meetingId_key" ON "visa_meeting_transcripts"("meetingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_meeting_transcripts_uploadedById_idx" ON "visa_meeting_transcripts"("uploadedById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_chat_conversations_studentId_updatedAt_idx" ON "visa_chat_conversations"("studentId", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_chat_messages_conversationId_createdAt_idx" ON "visa_chat_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_travel_history_entries_visaApplicationId_idx" ON "visa_travel_history_entries"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_other_citizenships_visaApplicationId_idx" ON "visa_other_citizenships"("visaApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_case_assignments_caseId_roleSlot_unassignedAt_idx" ON "visa_case_assignments"("caseId", "roleSlot", "unassignedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visa_case_assignments_staffId_unassignedAt_idx" ON "visa_case_assignments"("staffId", "unassignedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "owner_approval_requests_status_expiresAt_idx" ON "owner_approval_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "owner_approval_requests_requestedById_createdAt_idx" ON "owner_approval_requests"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key" ON "platform_settings"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "platform_settings_category_idx" ON "platform_settings"("category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "scorecard_submissions_leadId_key" ON "scorecard_submissions"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scorecard_submissions_userId_submittedAt_idx" ON "scorecard_submissions"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scorecard_submissions_band_submittedAt_idx" ON "scorecard_submissions"("band", "submittedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scorecard_submissions_executionEligible_idx" ON "scorecard_submissions"("executionEligible");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scorecard_submissions_userId_isDraft_idx" ON "scorecard_submissions"("userId", "isDraft");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_agents_status_fullName_idx" ON "affiliate_agents"("status", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tracking_links_shortCode_key" ON "tracking_links"("shortCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tracking_links_channel_createdAt_idx" ON "tracking_links"("channel", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tracking_links_agentId_createdAt_idx" ON "tracking_links"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tracking_links_status_createdAt_idx" ON "tracking_links"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tracking_link_clicks_linkId_clickedAt_idx" ON "tracking_link_clicks"("linkId", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "wix_payments_wixPaymentId_key" ON "wix_payments"("wixPaymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wix_payments_customerEmail_receivedAt_idx" ON "wix_payments"("customerEmail", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wix_payments_matchedLeadId_idx" ON "wix_payments"("matchedLeadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wix_payments_paymentType_receivedAt_idx" ON "wix_payments"("paymentType", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wix_payments_status_idx" ON "wix_payments"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cases_liaId_idx" ON "cases"("liaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cases_inzApplicationNumber_idx" ON "cases"("inzApplicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_userId_key" ON "contacts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "leads_externalSubmissionId_key" ON "leads"("externalSubmissionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_attributedAgentId_idx" ON "leads"("attributedAgentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_trackingLinkId_idx" ON "leads"("trackingLinkId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'magic_link_tokens_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "contacts" ADD CONSTRAINT "contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_trackingLinkId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "leads" ADD CONSTRAINT "leads_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_attributedAgentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "leads" ADD CONSTRAINT "leads_attributedAgentId_fkey" FOREIGN KEY ("attributedAgentId") REFERENCES "affiliate_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_status_history_leadId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_status_history_changedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_liaId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "cases" ADD CONSTRAINT "cases_liaId_fkey" FOREIGN KEY ("liaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visas_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visas" ADD CONSTRAINT "visas_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visas_issuedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visas" ADD CONSTRAINT "visas_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'immigration_officers_createdById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "immigration_officers" ADD CONSTRAINT "immigration_officers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'immigration_officer_observations_officerId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "immigration_officer_observations" ADD CONSTRAINT "immigration_officer_observations_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "immigration_officers"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'immigration_officer_observations_authorId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "immigration_officer_observations" ADD CONSTRAINT "immigration_officer_observations_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_officer_linkages_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_officer_linkages" ADD CONSTRAINT "case_officer_linkages_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_officer_linkages_officerId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_officer_linkages" ADD CONSTRAINT "case_officer_linkages_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "immigration_officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_officer_linkages_linkedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_officer_linkages" ADD CONSTRAINT "case_officer_linkages_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_expiry_reminders_sent_visaId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_expiry_reminders_sent" ADD CONSTRAINT "visa_expiry_reminders_sent_visaId_fkey" FOREIGN KEY ("visaId") REFERENCES "visas"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_signers_contractId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "contract_signers" ADD CONSTRAINT "contract_signers_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_signers_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "contract_signers" ADD CONSTRAINT "contract_signers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_notes_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "legal_notes" ADD CONSTRAINT "legal_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_notes_authorId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "legal_notes" ADD CONSTRAINT "legal_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_messages_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_messages_authorId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_messages_fulfilledByFileId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_fulfilledByFileId_fkey" FOREIGN KEY ("fulfilledByFileId") REFERENCES "visa_supporting_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_document_reviews_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_document_reviews" ADD CONSTRAINT "case_document_reviews_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_document_reviews_reviewedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "case_document_reviews" ADD CONSTRAINT "case_document_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tickets" ADD CONSTRAINT "tickets_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_contactId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_assignedToId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_createdById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_ticketId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_senderId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "invoices" ADD CONSTRAINT "invoices_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_contactId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_leadId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "payments" ADD CONSTRAINT "payments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "payments" ADD CONSTRAINT "payments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_applications_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_applications_contactId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_applications_agentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_education_entries_admissionApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_education_entries" ADD CONSTRAINT "admission_education_entries_admissionApplicationId_fkey" FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_programme_choices_admissionApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_programme_choices" ADD CONSTRAINT "admission_programme_choices_admissionApplicationId_fkey" FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_programme_choices_programmeId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_programme_choices" ADD CONSTRAINT "admission_programme_choices_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_documents_admissionApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_documents" ADD CONSTRAINT "admission_documents_admissionApplicationId_fkey" FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admission_documents_educationEntryId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "admission_documents" ADD CONSTRAINT "admission_documents_educationEntryId_fkey" FOREIGN KEY ("educationEntryId") REFERENCES "admission_education_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_profiles_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lia_profiles_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "lia_profiles" ADD CONSTRAINT "lia_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lia_profiles_iaaLicenceVerifiedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "lia_profiles" ADD CONSTRAINT "lia_profiles_iaaLicenceVerifiedById_fkey" FOREIGN KEY ("iaaLicenceVerifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_applications_applicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_partner_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_partner" ADD CONSTRAINT "visa_partner_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_former_partners_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_former_partners" ADD CONSTRAINT "visa_former_partners_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_children_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_children" ADD CONSTRAINT "visa_children_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_parents_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_parents" ADD CONSTRAINT "visa_parents_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_siblings_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_siblings" ADD CONSTRAINT "visa_siblings_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_nz_contacts_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_nz_contacts" ADD CONSTRAINT "visa_nz_contacts_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_employment_entries_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_employment_entries" ADD CONSTRAINT "visa_employment_entries_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_unemployment_entries_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_unemployment_entries" ADD CONSTRAINT "visa_unemployment_entries_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_education_supplements_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_education_supplements" ADD CONSTRAINT "visa_education_supplements_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_education_supplements_educationEntryId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_education_supplements" ADD CONSTRAINT "visa_education_supplements_educationEntryId_fkey" FOREIGN KEY ("educationEntryId") REFERENCES "admission_education_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_tb_risk_countries_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_tb_risk_countries" ADD CONSTRAINT "visa_tb_risk_countries_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_military_services_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_military_services" ADD CONSTRAINT "visa_military_services_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_supporting_documents_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_supporting_documents" ADD CONSTRAINT "visa_supporting_documents_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_other_evidence_entries_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_other_evidence_entries" ADD CONSTRAINT "visa_other_evidence_entries_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_supporting_document_files_visaSupportingDocumentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_supporting_document_files" ADD CONSTRAINT "visa_supporting_document_files_visaSupportingDocumentId_fkey" FOREIGN KEY ("visaSupportingDocumentId") REFERENCES "visa_supporting_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_other_evidence_entry_files_visaOtherEvidenceEntryId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_other_evidence_entry_files" ADD CONSTRAINT "visa_other_evidence_entry_files_visaOtherEvidenceEntryId_fkey" FOREIGN KEY ("visaOtherEvidenceEntryId") REFERENCES "visa_other_evidence_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_cases_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_cases_clientId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_cases_assignedConsultantId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_cases" ADD CONSTRAINT "visa_cases_assignedConsultantId_fkey" FOREIGN KEY ("assignedConsultantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_reports_clientId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "assessment_reports" ADD CONSTRAINT "assessment_reports_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_support_tickets_clientId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_support_tickets" ADD CONSTRAINT "visa_support_tickets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_support_tickets_assignedStaffId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_support_tickets" ADD CONSTRAINT "visa_support_tickets_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_support_tickets_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_support_tickets" ADD CONSTRAINT "visa_support_tickets_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_support_ticket_messages_ticketId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_support_ticket_messages" ADD CONSTRAINT "visa_support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "visa_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_support_ticket_messages_authorId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_support_ticket_messages" ADD CONSTRAINT "visa_support_ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_case_file_notes_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_case_file_notes" ADD CONSTRAINT "visa_case_file_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_case_file_notes_createdById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_case_file_notes" ADD CONSTRAINT "visa_case_file_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_meetings_studentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_meetings" ADD CONSTRAINT "visa_meetings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_meetings_consultantId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_meetings" ADD CONSTRAINT "visa_meetings_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_meeting_transcripts_meetingId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_meeting_transcripts" ADD CONSTRAINT "visa_meeting_transcripts_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "visa_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_meeting_transcripts_uploadedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_meeting_transcripts" ADD CONSTRAINT "visa_meeting_transcripts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_chat_conversations_studentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_chat_conversations" ADD CONSTRAINT "visa_chat_conversations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_chat_messages_conversationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_chat_messages" ADD CONSTRAINT "visa_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "visa_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_chat_messages_escalatedTicketId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_chat_messages" ADD CONSTRAINT "visa_chat_messages_escalatedTicketId_fkey" FOREIGN KEY ("escalatedTicketId") REFERENCES "visa_support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_travel_history_entries_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_travel_history_entries" ADD CONSTRAINT "visa_travel_history_entries_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_other_citizenships_visaApplicationId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_other_citizenships" ADD CONSTRAINT "visa_other_citizenships_visaApplicationId_fkey" FOREIGN KEY ("visaApplicationId") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_case_assignments_caseId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_case_assignments" ADD CONSTRAINT "visa_case_assignments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "visa_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_case_assignments_staffId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_case_assignments" ADD CONSTRAINT "visa_case_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visa_case_assignments_assignedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "visa_case_assignments" ADD CONSTRAINT "visa_case_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_approval_requests_requestedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "owner_approval_requests" ADD CONSTRAINT "owner_approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_approval_requests_decidedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "owner_approval_requests" ADD CONSTRAINT "owner_approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_active_status_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "staff_active_status" ADD CONSTRAINT "staff_active_status_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_updatedById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scorecard_submissions_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "scorecard_submissions" ADD CONSTRAINT "scorecard_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scorecard_submissions_leadId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "scorecard_submissions" ADD CONSTRAINT "scorecard_submissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_agents_createdById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "affiliate_agents" ADD CONSTRAINT "affiliate_agents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_links_createdById_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_links_agentId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "affiliate_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_link_clicks_linkId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "tracking_link_clicks" ADD CONSTRAINT "tracking_link_clicks_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "tracking_links"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wix_payments_matchedLeadId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "wix_payments" ADD CONSTRAINT "wix_payments_matchedLeadId_fkey" FOREIGN KEY ("matchedLeadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- AddForeignKey
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wix_payments_matchedUserId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "wix_payments" ADD CONSTRAINT "wix_payments_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

