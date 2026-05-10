-- Migration: add_admission_form
-- Adds: AGENT role, Contact.dateOfBirth/gender, AdmissionApplication,
--       AdmissionProgrammeChoice, AdmissionDocument, AgentProfile

-- ─── 1. Extend UserRole enum ──────────────────────────────────────────────────

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AGENT';

-- ─── 2. Extend contacts table ─────────────────────────────────────────────────

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gender"      TEXT;

-- ─── 3. New enums ─────────────────────────────────────────────────────────────

CREATE TYPE "AdmissionApplicationStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'LOCKED'
);

CREATE TYPE "AdmissionDocumentType" AS ENUM (
  'PASSPORT',
  'NZ_VISA_HISTORY',
  'VISA_REFUSAL_LETTER',
  'ENGLISH_TEST_EVIDENCE',
  'EDUCATION_TRANSCRIPTS',
  'SUPPORTING_DOCUMENT'
);

-- ─── 4. admission_applications ────────────────────────────────────────────────
-- Single fat table: one row per student application draft/submission.
-- All step data is nullable; sparse columns are acceptable because the form
-- is finite, single-instance per case, and always read/written per step.
-- Variable-length data (programme picks, file uploads) live in child tables.

CREATE TABLE "admission_applications" (
  "id"            TEXT                        NOT NULL,
  "caseId"        TEXT                        NOT NULL,
  "contactId"     TEXT                        NOT NULL,
  "agentId"       TEXT,
  "status"        "AdmissionApplicationStatus" NOT NULL DEFAULT 'DRAFT',
  "currentStep"   INTEGER                      NOT NULL DEFAULT 1,
  "submittedAt"   TIMESTAMP(3),
  "lockedAt"      TIMESTAMP(3),
  "termsAgreedAt" TIMESTAMP(3),

  -- Step 2: Additional student info
  "phone"              TEXT,
  "phoneType"          TEXT,
  "countryOfBirth"     TEXT,
  "citizenship"        TEXT,
  "ethnicity"          TEXT,
  "passportNumber"     TEXT,
  "visaRefused"        BOOLEAN,
  "visaRefusalDetails" TEXT,

  -- Step 3A: English proficiency
  "englishTestSat"   BOOLEAN,
  "englishTestName"  TEXT,
  "englishPreCourse" BOOLEAN,

  -- Step 3B: Health
  "hasDisability"       BOOLEAN,
  "disabilityDetails"   TEXT,
  "needsEvacAssistance" BOOLEAN,
  "evacDetails"         TEXT,
  "medicalNotes"        TEXT,
  "otherStudyNotes"     TEXT,

  -- Step 3C: Education background
  "schoolCountry"          TEXT,
  "schoolName"             TEXT,
  "schoolQualification"    TEXT,
  "qualificationCompleted" BOOLEAN,
  "qualYearStart"          INTEGER,
  "qualYearEnd"            INTEGER,
  "lastYearOfSchool"       INTEGER,
  "highestQualification"   TEXT,

  -- Step 3D: Funding
  "sponsorshipProgramme" TEXT,

  -- Step 5: Parent / guardian emergency contact
  "guardianRelationship"  TEXT,
  "guardianFirstName"     TEXT,
  "guardianLastName"      TEXT,
  "guardianEmail"         TEXT,
  "guardianMobile"        TEXT,
  "guardianHomePhone"     TEXT,
  "guardianAddressSameAs" BOOLEAN,
  "guardianStreet"        TEXT,
  "guardianSuburb"        TEXT,
  "guardianCity"          TEXT,
  "guardianState"         TEXT,
  "guardianCountry"       TEXT,
  "guardianPostcode"      TEXT,

  -- Step 6: Accommodation
  "accommodationType" TEXT,

  -- Step 7: Agent / counsellor (only populated when agentId is set)
  "counsellorFirstName"    TEXT,
  "counsellorLastName"     TEXT,
  "counsellorEmail"        TEXT,
  "anotherBranch"          BOOLEAN,
  "branchAgentCode"        TEXT,
  "branchName"             TEXT,
  "agentDeclarationAgreed" BOOLEAN,
  "agentComments"          TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_applications_caseId_idx"     ON "admission_applications"("caseId");
CREATE INDEX "admission_applications_contactId_idx"  ON "admission_applications"("contactId");
CREATE INDEX "admission_applications_status_idx"     ON "admission_applications"("status");

ALTER TABLE "admission_applications"
  ADD CONSTRAINT "admission_applications_caseId_fkey"
    FOREIGN KEY ("caseId")    REFERENCES "cases"("id")    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admission_applications_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admission_applications_agentId_fkey"
    FOREIGN KEY ("agentId")   REFERENCES "users"("id")    ON DELETE SET NULL ON UPDATE CASCADE;

-- one form per case, enforced at DB level
ALTER TABLE "admission_applications"
  ADD CONSTRAINT "admission_applications_caseId_key" UNIQUE ("caseId");

-- agent dashboard filter: "show me all applications I own"
CREATE INDEX "admission_applications_agentId_idx"
  ON "admission_applications"("agentId");

-- ─── 5. admission_programme_choices ───────────────────────────────────────────
-- Normalised: one row per programme+intake selected in Step 1.

CREATE TABLE "admission_programme_choices" (
  "id"                     TEXT     NOT NULL,
  "admissionApplicationId" TEXT     NOT NULL,
  "programmeId"            TEXT     NOT NULL,
  "intakeMonth"            INTEGER  NOT NULL,
  "intakeYear"             INTEGER  NOT NULL,
  "priority"               INTEGER  NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admission_programme_choices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_programme_choices_admissionApplicationId_idx"
  ON "admission_programme_choices"("admissionApplicationId");

ALTER TABLE "admission_programme_choices"
  ADD CONSTRAINT "admission_programme_choices_admissionApplicationId_fkey"
    FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "admission_programme_choices_programmeId_fkey"
    FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 6. admission_documents ───────────────────────────────────────────────────
-- Normalised: one row per uploaded file. Supports multiple files per type.

CREATE TABLE "admission_documents" (
  "id"                     TEXT                    NOT NULL,
  "admissionApplicationId" TEXT                    NOT NULL,
  "documentType"           "AdmissionDocumentType" NOT NULL,
  "fileName"               TEXT                    NOT NULL,
  "fileUrl"                TEXT                    NOT NULL,
  "mimeType"               TEXT                    NOT NULL,
  "fileSizeBytes"          INTEGER                 NOT NULL,
  "uploadedAt"             TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admission_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_documents_admissionApplicationId_idx"
  ON "admission_documents"("admissionApplicationId");

ALTER TABLE "admission_documents"
  ADD CONSTRAINT "admission_documents_admissionApplicationId_fkey"
    FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 7. agent_profiles ────────────────────────────────────────────────────────

CREATE TABLE "agent_profiles" (
  "id"         TEXT         NOT NULL,
  "userId"     TEXT         NOT NULL,
  "agencyName" TEXT         NOT NULL,
  "agencyCode" TEXT         NOT NULL,
  "branchName" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_profiles_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "agent_profiles_userId_key"     UNIQUE ("userId"),
  CONSTRAINT "agent_profiles_agencyCode_key" UNIQUE ("agencyCode")
);

ALTER TABLE "agent_profiles"
  ADD CONSTRAINT "agent_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
