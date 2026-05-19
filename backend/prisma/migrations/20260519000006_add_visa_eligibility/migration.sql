-- Visa Section — INZ 1200 rebuild, PR-VISA3 (Eligibility).
-- Extends visa_applications with the columns INZ collects in Section 3.
--
-- Six free-text answers + one conditional one are PII and stored encrypted
-- with the standard AES-256-GCM envelope ([version:1][iv:12][tag:16][ct:N])
-- via CryptoService — same shape as the existing visa + admission
-- encrypted columns.
--
-- All editable columns are nullable so the student can save a partial
-- draft. INZ requires most at submission time — required-ness is enforced
-- in the UI's save validator, not the schema.

ALTER TABLE "visa_applications"
  -- Study history
  ADD COLUMN "holdsNzStudentVisa"              BOOLEAN,
  -- Offer of Place assistance
  ADD COLUMN "usedEducationAgent"              BOOLEAN,
  ADD COLUMN "agentOrganisationName"           TEXT,
  ADD COLUMN "agentCountry"                    TEXT,
  ADD COLUMN "agentGivenName"                  TEXT,
  ADD COLUMN "agentSurname"                    TEXT,
  ADD COLUMN "agentEmail"                      TEXT,
  ADD COLUMN "agentSamePersonSubmitting"       BOOLEAN,
  ADD COLUMN "agentGaveImmigrationAdvice"      BOOLEAN,
  -- Study details
  ADD COLUMN "studyingSchoolLevel"             BOOLEAN,
  ADD COLUMN "studyingMastersOrPhd"            TEXT,
  ADD COLUMN "educationProviderName"           TEXT,
  ADD COLUMN "studyLocation"                   TEXT,
  ADD COLUMN "courseRequiresOtherLocation"     BOOLEAN,
  ADD COLUMN "courseProgrammeName"             TEXT,
  ADD COLUMN "courseStartDate"                 TIMESTAMP(3),
  ADD COLUMN "courseEndDate"                   TIMESTAMP(3),
  ADD COLUMN "intendedArrivalDate"             TIMESTAMP(3),
  -- PhD details
  ADD COLUMN "phdDiscipline"                   TEXT,
  ADD COLUMN "phdSubject"                      TEXT,
  ADD COLUMN "phdSupervisorTitle"              TEXT,
  ADD COLUMN "phdSupervisorGivenName"          TEXT,
  ADD COLUMN "phdSupervisorSurname"            TEXT,
  ADD COLUMN "phdSupervisorOrganisation"       TEXT,
  ADD COLUMN "phdPublishedPapers"              BOOLEAN,
  ADD COLUMN "phdSupervisorOutsideNz"          BOOLEAN,
  -- Student identification number
  ADD COLUMN "providerIssuedStudentId"         BOOLEAN,
  ADD COLUMN "studentIdNumber"                 TEXT,
  -- Your situation and plans
  ADD COLUMN "homeCommitmentsEncrypted"        BYTEA,
  ADD COLUMN "studyRelatesToPrevious"          BOOLEAN,
  ADD COLUMN "studyRelatesDetailsEncrypted"    BYTEA,
  ADD COLUMN "whyStudyNzEncrypted"             BYTEA,
  ADD COLUMN "whyThisProviderEncrypted"        BYTEA,
  ADD COLUMN "howCourseBenefitsEncrypted"      BYTEA,
  ADD COLUMN "plansAfterStudyEncrypted"        BYTEA,
  ADD COLUMN "studyingMultiYear"               BOOLEAN,
  ADD COLUMN "tuitionPaymentMode"              TEXT;
