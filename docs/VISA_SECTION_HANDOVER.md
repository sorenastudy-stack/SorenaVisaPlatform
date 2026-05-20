# Visa Section Handover

This document is the entry point for understanding the Visa Section of the Sorena platform. It covers the whole 14-step build in one place; for the deeper detail behind any single step, jump to the matching per-PR doc under [`docs/visa-section/`](visa-section/).

## Overview

The Visa Section is a 14-step data-capture flow that mirrors the New Zealand INZ 1200 online Student visa application. Sorena consultants use it to gather every answer INZ asks for before lodging a real submission outside the platform. Every answer is persisted on a single parent `VisaApplication` row plus a small family of child tables for the sections that repeat (citizenships, education supplements, employment, relationships, military service, travel history, supporting documents, other evidence). All personally identifying free-text fields are stored encrypted with AES-256-GCM through the existing `CryptoService`. File uploads in the last two steps are metadata-only — the actual file bytes never reach the backend; a future PR will add the storage layer.

The flow lives entirely under one Next.js route (`/student/documents`), driven by [`VisaFormShell.tsx`](../frontend/src/components/student/visa/VisaFormShell.tsx), [`VisaFormContext.tsx`](../frontend/src/components/student/visa/VisaFormContext.tsx), and [`VisaStepper.tsx`](../frontend/src/components/student/visa/VisaStepper.tsx). Each step is a single component that owns its own form state, talks to one of the routes mounted under `students/me/visa/*`, and bumps `currentStep` so the stepper can unlock the next one.

## Step map

| Step | Name | PR commit | Frontend component | Primary backend route(s) |
|------|------|-----------|---------------------|---------------------------|
| 1 | Identity Details | `708690c` | `Step1IdentityDetails.tsx` | `GET/POST/PATCH application` |
| 2 | Address and contact | `1b47a43` | `Step2AddressContact.tsx` | `PATCH application` |
| 3 | Eligibility | `d1b9d6d` | `Step3Eligibility.tsx` | `PATCH application` |
| 4 | Character | `6733009` | `Step4Character.tsx` | `PATCH application`, `POST/PATCH/DELETE citizenships` |
| 5 | Health | `f6c148a` | `Step5Health.tsx` | `PATCH application`, `POST/PATCH/DELETE tb-countries` |
| 6 | Education history | `8d52c86` | `Step6EducationHistory.tsx` | `PATCH education-supplements/:id` |
| 7 | Employment history | `15430d9` | `Step7EmploymentHistory.tsx` | `POST/PATCH/DELETE employment-entries`, `POST/PATCH/DELETE unemployment-entries` |
| 8 | Relationships | `33198d8` | `Step8Relationships.tsx` | `PATCH partner`, `POST/PATCH/DELETE former-partners children parents siblings nz-contacts` |
| 9 | Background details | `ce242f5` | `Step9BackgroundDetails.tsx` | `PATCH application` |
| 10 | Military history | `97a5154` | `Step10MilitaryHistory.tsx` | `GET/PATCH military-history` |
| 11 | Travel history | `30085f9` | `Step11TravelHistory.tsx` | `GET/PATCH travel-history` |
| 12 | Immigration assistance | `6fa4685` | `Step12ImmigrationAssistance.tsx` | `GET/PATCH immigration-assistance` |
| 13 | Supporting documents | `ab255be` | `Step13SupportingDocuments.tsx` | `GET/PATCH supporting-documents`, `PUT/DELETE supporting-documents/metadata` |
| 14 | Supporting documents (2) | `6d9267c` | `Step14SupportingDocuments2.tsx` | `GET/PATCH supporting-documents-2`, `PUT/DELETE supporting-documents-2/other-evidence` |

All routes are mounted under the controller prefix `students/me/visa/` (see [`visa.controller.ts:37`](../backend/src/students/visa/visa.controller.ts#L37)).

## Tech stack

- **Frontend:** Next.js 14 App Router, React Server Components for shell pages and client components for the form bodies; Tailwind for layout; `next-intl` for i18n (English + Persian, with RTL handling on the Persian locale).
- **Backend:** NestJS controllers/services with Prisma ORM on PostgreSQL.
- **Validation:** `class-validator` DTOs on every PATCH/PUT; cross-field rules live in the service layer for cleaner error messages.
- **Auth:** the project's existing `JwtAuthGuard` + `RolesGuard` chain; `@Roles('STUDENT', 'AGENT')` gates every route on the visa controller.
- **PII at rest:** the project's existing `CryptoService` — AES-256-GCM with the key in `.env`, encrypt-on-write / decrypt-on-read.
- **Migrations:** hand-written SQL under `prisma/migrations/<timestamp>_visa_pr<N>_*/`. The team agreed early on to skip `prisma migrate dev` because it kept picking up unrelated drift from working production constraints.

## Domain model

The Visa Section adds one parent row plus fifteen child tables. The shapes:

- [`VisaApplication`](../backend/prisma/schema.prisma#L1254) (table `visa_applications`) — one row per student, linked to the corresponding `AdmissionApplication`. Holds every non-repeating answer across all 14 steps as columns. Identity, address, eligibility, character gates, health gates, employment gates, relationship gates, background Y/Ns, military gates, travel gate, immigration assistance gate + adviser block, supporting-documents gates, supporting-documents-2 gates, encrypted free-text PII, and `currentStep` for stepper progression.
- [`VisaOtherCitizenship`](../backend/prisma/schema.prisma#L1996) (PR-4) — one row per additional citizenship.
- [`VisaTbRiskCountry`](../backend/prisma/schema.prisma#L1752) (PR-5) — one row per TB-risk country the student has visited.
- [`VisaEducationSupplement`](../backend/prisma/schema.prisma#L1729) (PR-6) — visa-only fields layered on an existing `AdmissionEducationEntry`; cascades from either parent.
- [`VisaEmploymentEntry`](../backend/prisma/schema.prisma#L1664) (PR-7) — covers both `CURRENT` and `PREVIOUS` jobs (discriminator on `entryKind`).
- [`VisaUnemploymentEntry`](../backend/prisma/schema.prisma#L1699) (PR-7) — unemployment / unpaid-service periods.
- [`VisaPartner`](../backend/prisma/schema.prisma#L1511) (PR-8, singleton — `UNIQUE` on `visaApplicationId`).
- [`VisaFormerPartner`](../backend/prisma/schema.prisma#L1540) (PR-8).
- [`VisaChild`](../backend/prisma/schema.prisma#L1561) (PR-8).
- [`VisaParent`](../backend/prisma/schema.prisma#L1583) (PR-8).
- [`VisaSibling`](../backend/prisma/schema.prisma#L1609) (PR-8).
- [`VisaNzContact`](../backend/prisma/schema.prisma#L1634) (PR-8).
- [`VisaMilitaryService`](../backend/prisma/schema.prisma#L1773) (PR-10) — repeating service periods.
- [`VisaTravelHistoryEntry`](../backend/prisma/schema.prisma#L1967) (PR-11) — repeating trips.
- [`VisaSupportingDocument`](../backend/prisma/schema.prisma#L1909) (PR-13) — file metadata keyed `UNIQUE` on `(visaApplicationId, documentType)`; shared between PR-13 and PR-14.
- [`VisaOtherEvidenceEntry`](../backend/prisma/schema.prisma#L1934) (PR-14) — repeating "Other evidence" rows (no UNIQUE, multiple allowed per type).

Every child relation is `ON DELETE CASCADE` from `VisaApplication`, so a deleted application takes its full graph with it.

## Enums

| Enum | Values | PR | Used by |
|------|--------|-----|---------|
| `VisaArrivalMode` | `AIR`, `SEA`, `LAND` | PR-11 | `VisaTravelHistoryEntry.arrivalMode` |
| `VisaPurposeOfTravel` | `EDUCATION`, `TOURISM`, `BUSINESS`, `FAMILY`, `MEDICAL`, `TRANSIT`, `WORK`, `OTHER` | PR-11 | `VisaTravelHistoryEntry.purposeOfTravel` |
| `ImmigrationAssistanceCapacity` | `LICENSED_IMMIGRATION_ADVISER`, `EXEMPT_PERSON`, `FAMILY_MEMBER`, `FRIEND`, `OTHER` | PR-12 | `VisaApplication.immigrationAssistanceCapacity` |
| `VisaSupportingDocumentType` | 23 values (6 added by PR-13, 17 by PR-14) | PR-13 / PR-14 | `VisaSupportingDocument.documentType` |
| `TuitionPaymentMethod` | `SELF_PAID`, `PARTNER_PROVIDER_OR_GOVT_LOAN`, `THIRD_PARTY_SPONSOR`, `SCHOLARSHIP` | PR-14 | `VisaApplication.tuitionPaymentMethod` |
| `OtherEvidenceType` | `COVER_LETTER`, `STATEMENT_OF_PURPOSE`, `ADDITIONAL_FUNDS_EVIDENCE`, `FAMILY_TIES_EVIDENCE`, `OTHER` | PR-14 | `VisaOtherEvidenceEntry.evidenceType` |

PR-2 also added `VISA_PHOTO` and PR-4 added `VISA_POLICE_CERTIFICATE` to the existing `AdmissionDocumentType` enum so the visa-specific files reuse the admission documents pipeline.

## PII & encryption

The pattern across the section is consistent: anything that is a free-text label or label-like reference to a third party is stored encrypted as `BYTEA`. Booleans, enums, dates, country codes, and other low-cardinality values are stored in cleartext. Encrypted columns always end in the suffix `Encrypted` and the corresponding plaintext is exposed only on the GET responses, never on the GET/PATCH payload column itself.

The encrypted-field inventory, by table:

- **`VisaApplication`** — `otherNamesEncrypted`, `nationalIdEncrypted` (PR-1); `physicalStreetEncrypted`, `postalStreetEncrypted` (PR-2); `homeCommitmentsEncrypted`, `studyRelatesDetailsEncrypted`, `whyStudyNzEncrypted`, `whyThisProviderEncrypted`, `howCourseBenefitsEncrypted`, `plansAfterStudyEncrypted` (PR-3); `exemptExplanationEncrypted` (PR-10); `adviserNumberEncrypted`, `adviserFullNameEncrypted`, `adviserEmailEncrypted`, `adviserContactNumberEncrypted` (PR-12); `countryOfResidenceEncrypted` (PR-13); `depositExplanationEncrypted`, `scholarshipNameEncrypted`, `scholarshipOrganisationEncrypted` (PR-14).
- **`VisaPartner`** — `givenNameEncrypted`, `middleNamesEncrypted`, `surnameEncrypted`, `passportNumberEncrypted` (PR-8).
- **`VisaFormerPartner`, `VisaChild`, `VisaParent`, `VisaSibling`** — `givenNameEncrypted`, `middleNamesEncrypted`, `surnameEncrypted` (PR-8).
- **`VisaNzContact`** — `givenNameEncrypted`, `middleNamesEncrypted`, `surnameEncrypted`, `phoneEncrypted`, `streetEncrypted` (PR-8).
- **`VisaEmploymentEntry`** — `dutiesEncrypted` (PR-7).
- **`VisaUnemploymentEntry`** — `activityEncrypted`, `financialSupportEncrypted` (PR-7).
- **`VisaMilitaryService`** — `dutiesEncrypted` (PR-10).
- **`VisaTravelHistoryEntry`** — `destinationEncrypted`, `pointOfEntryEncrypted`, `otherPurposeEncrypted` (PR-11).
- **`VisaOtherEvidenceEntry`** — `customLabelEncrypted` (PR-14; only populated when `evidenceType = OTHER`).

`CryptoService` reads its key from the `ENCRYPTION_KEY` env var. The visa service has two thin helpers, `encryptOrNull` and `decryptOrNull` (see [`visa.service.ts:1340-1350`](../backend/src/students/visa/visa.service.ts#L1340)), that wrap the cipher with `null`-safe semantics.

## Authorization model

Every route on `VisaController` is gated by `JwtAuthGuard + RolesGuard` with `@Roles('STUDENT', 'AGENT')` ([`visa.controller.ts:37-39`](../backend/src/students/visa/visa.controller.ts#L37)). Inside each service method, an ownership check (`resolveAdmissionApplication(userId)`) ensures the caller can only read or mutate their own visa application. Child-row mutations additionally verify the row belongs to the caller's visa application before update or delete.

The project's audit log (`audit_log` table, owned by an interceptor outside the visa module) records every mutation route — the visa code itself doesn't emit audit rows manually.

## Stepper & navigation flow

`VISA_TOTAL_STEPS = 14` lives in [`VisaFormContext.tsx`](../frontend/src/components/student/visa/VisaFormContext.tsx). On every successful save, the service bumps `visa.currentStep` to `Math.max(current, N+1)` so a partial draft never loses progress. The stepper component reads `currentStep` and disables any step whose number exceeds `Math.max(activeStep, currentStep)` — students can jump back to anything they've already completed but can't skip ahead.

Step `N`'s save handler calls `setActiveStep(N+1)` on success. The terminal step (14) currently calls no advance: there is no Step 15 yet (Review and declare is the next planned step). When that lands, change the trailing line in `Step14SupportingDocuments2.handleSave` to `setActiveStep(15)` and update `VISA_TOTAL_STEPS`.

## i18n

All keys live under one of two locale files: [`en.json`](../frontend/src/i18n/messages/en.json) and [`fa.json`](../frontend/src/i18n/messages/fa.json). The naming convention is a per-step prefix — `visaIdentity*`, `visaAddress*`, `visaEligibility*`, `visaCharacter*`, `visaHealth*` / `visaTbRisk*` / `visaInsurance*` / `visaPublicHealth*`, `visaEducation*`, `visaEmployment*` / `visaUnemployment*`, `visaRelationships*` / `visaPartner*` / `visaFormerPartner*` / `visaChildren*` / `visaParents*` / `visaSiblings*` / `visaNzContacts*`, `visaBackground*`, `visaMilitary*`, `visaTravel*`, `visaImmigration*`, `visaDocs*`, `visaDocs2*` — plus a small shared `visaCommon*` block for buttons (`Yes`, `No`, `Back`, `Saving…`, etc.).

The total visa-key count across the section is roughly 800 keys per locale (Persian translations of every English string). Per-PR doc rows give rough key counts under each "i18n" section. The Persian locale is rendered right-to-left when active — the standard Next.js `dir` attribute is set by the layout based on `useLocale()`.

## File storage (deferred)

PR-13 and PR-14 introduce file-picker UI for 23 distinct document types plus an open-ended "Other evidence" repeating block, but **no file bytes are uploaded or stored**. The browser extracts `originalFilename`, `mimeType`, and `sizeBytes` from the `File` object and PUTs only those primitives to the backend. The backend stores them in `visa_supporting_documents` and `visa_other_evidence_entries` as metadata rows; nothing else.

A future PR (PR-15) will integrate Supabase Storage and backfill against the existing metadata rows so that when a student uploaded "passport.pdf" today, the future system can attach the real blob to that same row. The metadata table's `UNIQUE(visaApplicationId, documentType)` constraint already enforces one-row-per-type-per-application, so the migration to add a `storagePath` column will be additive only.

## How to extend with a new step

A developer adding Step 15 ("Review and declare", say) should follow the same checklist that PR-11 onwards used:

1. Take a DB backup: `cd backend && pg_dump <conn> > backup_before_visa_pr15.sql`. The `.gitignore` already excludes `backup_*.sql`.
2. Add Prisma model/enum/field changes to `schema.prisma`. Place new fields after the Section-14 block, matching the comment style.
3. Hand-write the migration under `prisma/migrations/<UTC-timestamp>_visa_pr15_<slug>/migration.sql`. Do not use `prisma migrate dev`.
4. Apply with `npx prisma migrate deploy`, then `npx prisma generate`. Kill the running backend first (the generated Prisma client DLL is locked on Windows while Nest is running).
5. Add the DTO file: `backend/src/students/visa/dto/<slug>.dto.ts`. One DTO per request payload; cross-field rules belong in the service, not the DTO.
6. Append service methods to `backend/src/students/visa/visa.service.ts`. Standard shape: `get<Name>(userId)`, `save<Name>(userId, body)`. Use transactions for any cascade clearing.
7. Add controller routes at the end of `visa.controller.ts`, under the same controller-level guards.
8. Create the frontend component: `frontend/src/components/student/visa/steps/Step15<Name>.tsx`. Mirror the latest step's shape.
9. For file fields, reuse [`DocumentMetadataPicker`](../frontend/src/components/student/visa/DocumentMetadataPicker.tsx).
10. Add i18n keys under a fresh `visa<Section>*` prefix in both `en.json` and `fa.json`.
11. Extend `VisaFormContext` to expose any new gate flags the stepper needs to render.
12. Bump `VISA_TOTAL_STEPS` to `15`.
13. Add a row to `VisaStepper.tsx`'s `steps` array.
14. Wire the new component into `VisaFormShell.tsx`'s `ActiveStep` switch.
15. Change the previous step's save handler to call `setActiveStep(15)` instead of staying put.
16. Verify with `npx tsc --noEmit` on both backend and frontend.
17. Commit: `feat(visa): VISA-PR-15 <Name>`. One commit per step.

## Known limitations

- **File storage is deferred.** No file bytes are persisted anywhere yet. PR-15 will introduce Supabase Storage and backfill against the existing metadata rows.
- **No Review and declare step yet.** Step 14 is currently the terminal step; saving it bumps `currentStep` to 15 but leaves the user on Step 14.
- **No automated tests were run during the build.** Per the project rule the user runs their own smoke tests after each PR; nothing is wired to CI.
- **No INZ submission step.** Sorena consultants use the captured data internally — INZ submission is out of scope.
- **Wix lead capture is not yet wired.** That's Phase 4 of the master plan, not part of the Visa Section.

## Rollback procedure

Every PR landed as a single commit, so rollback granularity is one PR at a time.

To roll back the **entire Visa Section** to its pre-PR-1 state: `git revert` each of the 14 commits in reverse order (PR-14 first, then PR-13, …, ending with PR-1). If no other work has landed on `main` since PR-1, `git reset --hard <pre-PR-1 commit>` is faster but destructive — only use it if you have not pushed any other work that would be lost.

To roll back **one PR** in the middle:

```bash
git revert <commit SHA>
cd backend
npx prisma migrate resolve --rolled-back <migration folder name>
# Then restore the DB from backup_before_visa_pr<N>.sql:
psql <conn> -f backend/backup_before_visa_pr<N>.sql
```

The `backup_before_visa_pr<N>.sql` files exist for PR-11 through PR-14 (PR-1..PR-10 predated the convention). They are gitignored — if rollback might ever be needed, copy them offline before deleting your local checkout.

## Per-PR documentation index

- [PR-01 — Identity Details](visa-section/PR-01_identity_details.md)
- [PR-02 — Address and contact](visa-section/PR-02_address_contact.md)
- [PR-03 — Eligibility](visa-section/PR-03_eligibility.md)
- [PR-04 — Character](visa-section/PR-04_character.md)
- [PR-05 — Health](visa-section/PR-05_health.md)
- [PR-06 — Education history](visa-section/PR-06_education_history.md)
- [PR-07 — Employment history](visa-section/PR-07_employment_history.md)
- [PR-08 — Relationships](visa-section/PR-08_relationships.md)
- [PR-09 — Background details](visa-section/PR-09_background_details.md)
- [PR-10 — Military history](visa-section/PR-10_military_history.md)
- [PR-11 — Travel history](visa-section/PR-11_travel_history.md)
- [PR-12 — Immigration assistance](visa-section/PR-12_immigration_assistance.md)
- [PR-13 — Supporting documents](visa-section/PR-13_supporting_documents.md)
- [PR-14 — Supporting documents (2)](visa-section/PR-14_supporting_documents_2.md)
