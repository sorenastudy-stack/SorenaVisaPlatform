# Visa Section — Existing Data Inventory

**Purpose.** The new Visa Section will mirror INZ 1200 (student visa application).
Before we add any new field, we need a complete picture of what the platform
already collects. This document is the source of truth for that question.

**Read-only.** Nothing here was changed. Pulled from:

- `backend/prisma/schema.prisma`
- `frontend/src/components/student/admission/AdmissionFormContext.tsx`
- `frontend/src/components/student/admission/steps/Step1Study.tsx` … `Step8Acceptance.tsx`
- `frontend/src/components/student/admission/EducationHistoryEditor.tsx`

When building the Visa Section, **do not re-collect any field that already
appears below.** Read it from `AdmissionApplication`, `Contact`, or the related
tables instead.

---

## 1. The 8 admission-form steps and what each collects

### Step 1 — Programme choices
Collected into the **`admission_programme_choices`** table (one row per chosen
programme; up to 3, priority-ordered):

| Field           | Type     | Notes                                       |
|-----------------|----------|---------------------------------------------|
| `programmeId`   | string   | FK → `education_programmes.id`              |
| `intakeMonth`   | int      | 1–12                                        |
| `intakeYear`    | int      | calendar year                               |
| `priority`      | int      | 1 = first choice                            |

### Step 2 — Additional student info
Stored on **`admission_applications`** (single row per case):

| Field                          | Type      | Storage    | Notes                                              |
|--------------------------------|-----------|------------|----------------------------------------------------|
| `dateOfBirth`                  | DateTime  | plaintext  | Drives "under-18 → skip steps 5–6" branching       |
| `maritalStatus`                | string    | plaintext  | enum-like string                                   |
| `hasChildren`                  | boolean   | plaintext  |                                                    |
| `phone`                        | string    | plaintext  | Student's own mobile/home                          |
| `phoneType`                    | string    | plaintext  | "MOBILE" \| "HOME"                                 |
| `countryOfBirth`               | string    | plaintext  | ISO country name (searchable dropdown)             |
| `citizenship`                  | string    | plaintext  | ISO country name                                   |
| `ethnicity`                    | string    | plaintext  | Curated list                                       |
| `passportNumberEncrypted`      | Bytes     | AES-256-GCM| Encrypted at rest (PR-SEC3)                        |
| `visaRefused`                  | boolean   | plaintext  | Triggers refusal-letter upload                     |
| `visaRefusalDetailsEncrypted`  | Bytes     | AES-256-GCM| Free text — only present if `visaRefused = true`   |

Document uploads on Step 2: **PASSPORT**, **NZ_VISA_HISTORY**,
**VISA_REFUSAL_LETTER** (conditional, only when `visaRefused = true`).

### Step 3 — English, education background, funding, health
Stored on **`admission_applications`**:

**3A — English proficiency**
| Field              | Type    | Storage   | Notes                                  |
|--------------------|---------|-----------|----------------------------------------|
| `englishTestSat`   | boolean | plaintext | Have you taken an English test?        |
| `englishTestName`  | string  | plaintext | IELTS/PTE/etc. — only if `Sat = true`  |
| `englishPreCourse` | boolean | plaintext | Willing to do a pre-course?            |

**3B — Education background (single-school summary)**
| Field                    | Type    | Storage   |
|--------------------------|---------|-----------|
| `schoolCountry`          | string  | plaintext |
| `schoolName`             | string  | plaintext |
| `schoolQualification`    | string  | plaintext |
| `qualificationCompleted` | boolean | plaintext |
| `qualYearStart`          | int     | plaintext |
| `qualYearEnd`            | int     | plaintext |
| `lastYearOfSchool`       | int     | plaintext |
| `highestQualification`   | string  | plaintext |

**3C — Funding**
| Field                  | Type   | Storage   |
|------------------------|--------|-----------|
| `sponsorshipProgramme` | string | plaintext |

**3D — Health**
| Field                        | Type    | Storage    |
|------------------------------|---------|------------|
| `hasDisability`              | boolean | plaintext  |
| `disabilityDetailsEncrypted` | Bytes   | AES-256-GCM|
| `needsEvacAssistance`        | boolean | plaintext  |
| `evacDetailsEncrypted`       | Bytes   | AES-256-GCM|
| `medicalNotesEncrypted`      | Bytes   | AES-256-GCM|
| `otherStudyNotesEncrypted`   | Bytes   | AES-256-GCM|

Document uploads on Step 3: **ENGLISH_TEST_EVIDENCE** (one or more, when
`englishTestSat = true`); **EDUCATION_TRANSCRIPTS** (one or more, always).

### Step 4 — Education history + supporting documents
Repeating table **`admission_education_entries`** — multiple rows per
application, one per qualification. Each row:

| Field                    | Type    | Notes                                                  |
|--------------------------|---------|--------------------------------------------------------|
| `qualificationLevel`     | string  | INTERMEDIATE / HIGH_SCHOOL / CERTIFICATE / DIPLOMA / ASSOCIATE_DEGREE / BACHELORS / MASTERS / DOCTORATE / OTHER |
| `institutionName`        | string  |                                                        |
| `country`                | string  | ISO country name                                       |
| `fieldOfStudy`           | string  | Required at app layer; nullable in DB for legacy rows  |
| `startYear`              | int     | Year-only                                              |
| `endYear`                | int     | Year-only                                              |
| `completed`              | boolean | If true, demands transcript ± certificate              |
| `certificateNotReceived` | boolean | If true, certificate is optional                       |
| `sortOrder`              | int     |                                                        |

Per-row document uploads: **NOTARIZED_CERTIFICATE**,
**NOTARIZED_TRANSCRIPT**. Application-level: **SUPPORTING_DOCUMENT** (free
attachments).

### Step 5 — Parent / guardian / emergency contact (skipped if 18+)
Stored on **`admission_applications`**:

| Field                       | Type    | Storage    |
|-----------------------------|---------|------------|
| `guardianRelationship`      | string  | plaintext  |
| `guardianFirstNameEncrypted`| Bytes   | AES-256-GCM|
| `guardianLastNameEncrypted` | Bytes   | AES-256-GCM|
| `guardianEmail`             | string  | plaintext  |
| `guardianMobileEncrypted`   | Bytes   | AES-256-GCM|
| `guardianHomePhoneEncrypted`| Bytes   | AES-256-GCM|
| `guardianAddressSameAs`     | boolean | plaintext  |
| `guardianStreetEncrypted`   | Bytes   | AES-256-GCM|
| `guardianSuburbEncrypted`   | Bytes   | AES-256-GCM|
| `guardianCity`              | string  | plaintext  |
| `guardianState`             | string  | plaintext  |
| `guardianCountry`           | string  | plaintext  |
| `guardianPostcodeEncrypted` | Bytes   | AES-256-GCM|

### Step 6 — Accommodation (skipped if 18+)
| Field               | Type   | Storage   |
|---------------------|--------|-----------|
| `accommodationType` | string | plaintext |

### Step 7 — Agent / counsellor (only when `agentId` is set)
| Field                          | Type    | Storage    |
|--------------------------------|---------|------------|
| `counsellorFirstNameEncrypted` | Bytes   | AES-256-GCM|
| `counsellorLastNameEncrypted`  | Bytes   | AES-256-GCM|
| `counsellorEmail`              | string  | plaintext  |
| `anotherBranch`                | boolean | plaintext  |
| `branchAgentCode`              | string  | plaintext  |
| `branchName`                   | string  | plaintext  |
| `agentDeclarationAgreed`       | boolean | plaintext  |
| `agentCommentsEncrypted`       | Bytes   | AES-256-GCM|

### Step 8 — Acceptance / declaration
| Field           | Type     | Notes                                |
|-----------------|----------|--------------------------------------|
| `termsAgreedAt` | DateTime | Timestamp the student ticked accept  |

---

## 2. Data the student already has on file BEFORE the admission form

The Visa Section also gets these for free — collected during signup / lead
intake, never re-asked by the admission form.

**`contacts`** (one row per student; reachable via `admissionApplications[].contactId`)

| Field                | Type     | Notes                                       |
|----------------------|----------|---------------------------------------------|
| `fullName`           | string   |                                             |
| `email`              | string   | Unique                                      |
| `emailHash`          | string   | HMAC-SHA256 lookup hash (PR-SEC2)           |
| `phone`              | string   | Pre-admission contact phone                 |
| `whatsapp`           | string   |                                             |
| `nationality`        | string   |                                             |
| `countryOfResidence` | string   |                                             |
| `preferredLanguage`  | string   | "en" / "fa"                                 |
| `dateOfBirth`        | DateTime | May be present from intake; admission Step 2 also asks |
| `gender`             | string   |                                             |
| `photoUrl`           | string   |                                             |

**`users`** (auth row; linked 1-1 to `contacts.userId`)

| Field          | Type   | Notes                |
|----------------|--------|----------------------|
| `name`         | string |                      |
| `email`        | string | Login email          |
| `passwordHash` | string | bcrypt               |
| `role`         | enum   | STUDENT / AGENT / etc|

**`leads` / `intake_forms`** (acquisition stage — pre-admission)

A `lead` row exists for every contact who came through marketing. Useful
fields already collected by intake forms:

| Field                   | Type    | Notes                                          |
|-------------------------|---------|------------------------------------------------|
| `englishTestType`       | string  | May duplicate Step 3A's `englishTestName`      |
| `englishOverallScore`   | float   |                                                |
| `englishComponentScores`| Json    | L/R/W/S breakdown                              |
| `visaHistory`           | string  | Free text                                      |
| `visaRejectionCount`    | int     |                                                |
| `visaRejectionReason`   | string  |                                                |
| `workExperienceYears`   | int     |                                                |
| `studyIntent`           | string  |                                                |
| `preferredStartDate`    | string  |                                                |
| `preferredCountry`      | string  | Default "NZ"                                   |
| `preferredLevel`        | string  |                                                |
| `preferredField`        | string  |                                                |
| `financialLevel`        | string  | "self_funded" / "family" / etc.                |
| `estimatedBudgetNZD`    | float   |                                                |

**`cases`** — `id`, `stage` (ADMISSION / VISA / COMPLETED), `ownerId`, `riskLevel`.

---

## 3. Every file/document upload the platform already stores

### Admission documents (`admission_documents` table, `AdmissionDocumentType` enum)

Each row keeps `fileName`, `fileUrl`, `mimeType`, `fileSizeBytes`,
`uploadedAt`, and an optional `educationEntryId` (when the upload is tied to
one row of Step 4's education history).

| `documentType` enum value | Where collected     | Cardinality          | Conditional on                          |
|---------------------------|---------------------|----------------------|-----------------------------------------|
| `PASSPORT`                | Step 2              | Single               | Always required                         |
| `NZ_VISA_HISTORY`         | Step 2              | One or more          | Always required                         |
| `VISA_REFUSAL_LETTER`     | Step 2              | One or more          | Only when `visaRefused = true`          |
| `ENGLISH_TEST_EVIDENCE`   | Step 3              | One or more          | Only when `englishTestSat = true`       |
| `EDUCATION_TRANSCRIPTS`   | Step 3              | One or more          | Always required                         |
| `SUPPORTING_DOCUMENT`     | Step 4              | One or more          | Optional                                |
| `NOTARIZED_CERTIFICATE`   | Step 4 (per entry)  | One per entry        | Per `admission_education_entry`, when `completed = true` and `certificateNotReceived = false` |
| `NOTARIZED_TRANSCRIPT`    | Step 4 (per entry)  | One per entry        | Per `admission_education_entry`, when `completed = true` |

### Application documents (`application_documents` table)

Separate from admission docs — this is the post-admission, per-`Application`
(per-provider) document store. Right now `type` is a free string, no enum;
nothing in the student-facing UI writes to it yet. Available for Visa Section
to extend.

### Other file storage on the schema (non-student-facing for now)
- `contracts.signedFileUrl` / `contracts.auditTrailUrl` (DocuSign artifacts)
- `education_providers.agreementUrl` (provider agreements)
- `ticket_messages.attachments` (string[] of URLs)
- `whatsapp_messages.content` (text, no attachments currently typed)

---

## 4. Quick alphabetical field index (admission form only)

`accommodationType` · `agentCommentsEncrypted` · `agentDeclarationAgreed` ·
`anotherBranch` · `branchAgentCode` · `branchName` · `certificateNotReceived` ·
`citizenship` · `counsellorEmail` · `counsellorFirstNameEncrypted` ·
`counsellorLastNameEncrypted` · `country` (per education entry) ·
`countryOfBirth` · `dateOfBirth` · `disabilityDetailsEncrypted` ·
`endYear` · `englishPreCourse` · `englishTestName` · `englishTestSat` ·
`ethnicity` · `evacDetailsEncrypted` · `fieldOfStudy` · `guardianAddressSameAs` ·
`guardianCity` · `guardianCountry` · `guardianEmail` ·
`guardianFirstNameEncrypted` · `guardianHomePhoneEncrypted` ·
`guardianLastNameEncrypted` · `guardianMobileEncrypted` ·
`guardianPostcodeEncrypted` · `guardianRelationship` · `guardianState` ·
`guardianStreetEncrypted` · `guardianSuburbEncrypted` · `hasChildren` ·
`hasDisability` · `highestQualification` · `institutionName` · `intakeMonth` ·
`intakeYear` · `lastYearOfSchool` · `maritalStatus` · `medicalNotesEncrypted` ·
`needsEvacAssistance` · `otherStudyNotesEncrypted` · `passportNumberEncrypted` ·
`phone` · `phoneType` · `priority` · `programmeId` · `qualificationCompleted` ·
`qualificationLevel` · `qualYearEnd` · `qualYearStart` · `schoolCountry` ·
`schoolName` · `schoolQualification` · `sponsorshipProgramme` ·
`startYear` · `termsAgreedAt` · `visaRefusalDetailsEncrypted` · `visaRefused`

---

## 5. Reuse rules for the Visa Section

1. **Never re-ask a field that already lives in `admission_applications`,
   `admission_education_entries`, `admission_programme_choices`, `contacts`,
   `users`, or `leads`.** Read the existing value and pre-fill / display
   read-only.
2. **Document re-use.** The Visa Section should treat the 8 existing
   `AdmissionDocumentType` uploads as already-supplied evidence. Only add new
   `documentType` values to the enum when INZ 1200 demands a file we haven't
   collected yet (e.g. medical certificate, police certificate, evidence of
   funds, English certificate scan if separate from `ENGLISH_TEST_EVIDENCE`).
3. **Encryption.** Any new PII the Visa Section introduces (passport-style
   numbers, ID numbers, addresses, free-text health info, financial detail)
   must follow the same `*Encrypted Bytes` + `CryptoService` pattern used in
   PR-SEC3 — don't store new PII in plaintext.
4. **Schema first, then UI.** Schema additions for the Visa Section will need
   a hand-written migration (the auto-generator halts on warnings in our
   non-interactive shell) and a deploy via `prisma migrate deploy`.
