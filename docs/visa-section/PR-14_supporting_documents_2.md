# PR-14 — Supporting documents (2)

## What this step does

Step 14 is the second half of INZ's supporting-documents flow and the largest single step of the Visa Section. It covers everything beyond the identity-evidence block: evidence of study (offer of place, PhD research proposal, publications list), evidence of genuine intent (personal circumstances, prior tertiary education, current and previous employment, English-test results), evidence of tuition fees, evidence of financial support and outward travel (with deep nested gates for savings format and savings sources), evidence of eligibility for work rights, an open-ended "Other evidence" repeating block, and the final declaration checkbox. File storage is still deferred — the new document types reuse PR-13's metadata pipeline.

## INZ source

INZ 1200 Online Student visa, "Supporting documents (2)" page (second of two).

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260520045522_visa_pr14_supporting_documents_2/migration.sql`.
- **Backend:** `dto/supporting-documents-2.dto.ts` (new), `visa.service.ts` (`getSupportingDocuments2`, `saveSupportingDocuments2`, `upsertOtherEvidenceEntry`, `deleteOtherEvidenceEntry`), `visa.controller.ts` (four new routes).
- **Frontend:** `DocumentMetadataPicker.tsx` (extended `DocumentType` union by 17 values), `OtherEvidenceCard.tsx` (new — `OtherEvidenceCard` + `OtherEvidenceAdder`), `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step14SupportingDocuments2.tsx` (new, ~840 LOC — the second-largest step component), `Step13SupportingDocuments.tsx` (advance to Step 14).
- **i18n:** ~100 keys per locale (`visaDocs2*`).

## Database changes

Parent-row additions on `VisaApplication` — 28 columns, all nullable:

```text
tuitionFeesPaid Boolean?
tuitionPaymentMethod TuitionPaymentMethod?
fundsSourceSavings, fundsSourceNZSponsor, fundsSourceInz1014,
  fundsSourcePrepaidAccom, fundsSourceScholarship Boolean?
outwardSourceSufficientFunds, outwardSourceInz1014,
  outwardSourcePrepaidBooking, outwardSourceScholarship Boolean?
fundsFormatBankAccount, fundsFormatProvidentFund, fundsFormatEducationLoan,
  fundsFormatFixedTermDeposit, fundsFormatOther Boolean?
savingsSourceWages, savingsSourceSelfEmployment,
  savingsSourceRentalIncome, savingsSourceOther Boolean?
depositExplanationEncrypted, scholarshipNameEncrypted,
  scholarshipOrganisationEncrypted Bytes?
studyIs120CreditsOrMore, courseRequiresPracticalWork Boolean?
tookEnglishTest, declarationChecked Boolean?
```

Three encrypted columns. Everything else cleartext.

New enums:
- `TuitionPaymentMethod` — `SELF_PAID`, `PARTNER_PROVIDER_OR_GOVT_LOAN`, `THIRD_PARTY_SPONSOR`, `SCHOLARSHIP`.
- `OtherEvidenceType` — `COVER_LETTER`, `STATEMENT_OF_PURPOSE`, `ADDITIONAL_FUNDS_EVIDENCE`, `FAMILY_TIES_EVIDENCE`, `OTHER`.

17 new values appended to the existing `VisaSupportingDocumentType` enum: `OFFER_OF_PLACE`, `PHD_RESEARCH_PROPOSAL`, `PUBLICATIONS_LIST`, `PERSONAL_CIRCUMSTANCES_EVIDENCE`, `PREVIOUS_TERTIARY_EVIDENCE`, `CURRENT_EMPLOYMENT_EVIDENCE`, `PREVIOUS_EMPLOYMENT_EVIDENCE`, `ENGLISH_TEST_RESULTS`, `TUITION_PAYMENT_CONFIRMATION`, `INZ1014_FINANCIAL_UNDERTAKING`, `PREPAID_ACCOMMODATION_EVIDENCE`, `SCHOLARSHIP_EVIDENCE`, `OUTWARD_TRAVEL_EVIDENCE`, `BANK_STATEMENTS`, `EMPLOYMENT_INCOME_EVIDENCE`, `SCHEDULED_HOLIDAY_EVIDENCE`, `OTHER_EVIDENCE`.

New child table `VisaOtherEvidenceEntry` (`visa_other_evidence_entries`):

```text
id String PK
visaApplicationId String FK cascade
evidenceType OtherEvidenceType
customLabelEncrypted Bytes?         // required only when evidenceType = OTHER
originalFilename, mimeType String
sizeBytes Int
uploadedAt DateTime default now()
sortOrder via uploadedAt ordering
createdAt, updatedAt
INDEX(visaApplicationId)
```

No UNIQUE — multiple rows allowed per `(application, evidenceType)` so a student can attach several cover letters etc.

Migration filename: `20260520045522_visa_pr14_supporting_documents_2/migration.sql`. The enum extension uses 17 individual `ALTER TYPE ... ADD VALUE` statements (PostgreSQL 12+ allows these inside a transaction).

## API endpoints

- `GET /students/me/visa/supporting-documents-2` — returns the 28 parent fields (decrypting the three encrypted strings) + the other-evidence array (decrypting `customLabel` when `evidenceType = OTHER`).
- `PATCH /students/me/visa/supporting-documents-2` — saves the 28 parent fields with full cascade clearing.
- `PUT /students/me/visa/supporting-documents-2/other-evidence` — create-or-update by optional `id` (omitted → create; present → update with ownership check).
- `DELETE /students/me/visa/supporting-documents-2/other-evidence/:entryId` — remove an entry (ownership-checked).

The 17 new document types reuse PR-13's `PUT/DELETE /supporting-documents/metadata[/:documentType]` endpoint — the metadata table is shared.

## Frontend

- New subcomponents in `OtherEvidenceCard.tsx`:
  - `OtherEvidenceCard` — renders one existing entry with type select + conditional custom-label + file replace button.
  - `OtherEvidenceAdder` — the "add another document" form.
- Component: `Step14SupportingDocuments2.tsx`, ~840 LOC.
- Cross-step gates: the step reads `visa.studyingMastersOrPhd === 'PHD'`, `visa.phdPublishedPapers === true`, `educationEntries.length > 0`, `employmentEntries.some(e => e.entryKind === 'CURRENT' | 'PREVIOUS')` from the context to decide which conditional pickers to render.
- The `DocumentType` union in `DocumentMetadataPicker.tsx` was extended with the 17 new values so the same picker handles every document type from both pages.

## i18n

`visaDocs2*`. About 100 keys per locale — section title + intro + 8 section headings + 17 document labels with help text + 4 tuition method enum labels + 5 other-evidence type labels + a long list of validation messages + the declaration copy.

## Validation rules

The step is a tree of conditionals. The full list:

- `tookEnglishTest`, `tuitionFeesPaid`, `studyIs120CreditsOrMore`, `courseRequiresPracticalWork`, `declarationChecked` are all required.
- `declarationChecked` must be `true` to mark the step complete.
- `OFFER_OF_PLACE` and `PERSONAL_CIRCUMSTANCES_EVIDENCE` metadata rows required.
- PhD: `studyingMastersOrPhd === 'PHD'` → `PHD_RESEARCH_PROPOSAL` required.
- Publications: `phdPublishedPapers === true` → `PUBLICATIONS_LIST` required.
- Education: `educationEntries.length > 0` → `PREVIOUS_TERTIARY_EVIDENCE` required.
- Current employment present → `CURRENT_EMPLOYMENT_EVIDENCE` required.
- Previous employment present → `PREVIOUS_EMPLOYMENT_EVIDENCE` required.
- `tookEnglishTest === true` → `ENGLISH_TEST_RESULTS` required.
- `tuitionFeesPaid === false` → `tuitionPaymentMethod` required.
- Tuition paid OR method ∈ `{PARTNER_PROVIDER_OR_GOVT_LOAN, THIRD_PARTY_SPONSOR, SCHOLARSHIP}` → `TUITION_PAYMENT_CONFIRMATION` required.
- At least one `fundsSource*` must be true.
- At least one `outwardSource*` must be true.
- `fundsSourceInz1014 || outwardSourceInz1014` → `INZ1014_FINANCIAL_UNDERTAKING` required.
- `fundsSourcePrepaidAccom` → `PREPAID_ACCOMMODATION_EVIDENCE` required.
- `outwardSourcePrepaidBooking` → `OUTWARD_TRAVEL_EVIDENCE` required.
- `fundsSourceSavings === true` → at least one `fundsFormat*` true.
- `fundsFormatBankAccount === true` → at least one `savingsSource*` true AND `BANK_STATEMENTS` metadata required.
- Bank account + (wages or self-employment) → `EMPLOYMENT_INCOME_EVIDENCE` required.
- Scholarship active (any of `fundsSourceScholarship`, `outwardSourceScholarship`, `tuitionPaymentMethod === 'SCHOLARSHIP'`) → `scholarshipName` + `scholarshipOrganisation` non-empty AND `SCHOLARSHIP_EVIDENCE` required.
- Each `VisaOtherEvidenceEntry` with `evidenceType = OTHER` → `customLabel` non-empty.

## Server-side cascade clearing

The save handler is the section's biggest piece of logic. Every higher gate flipping false cascades downstream in a single transaction:

- `tuitionFeesPaid === true` → nulls `tuitionPaymentMethod`.
- `fundsSourceSavings !== true` → nulls every `fundsFormat*`, every `savingsSource*`, `depositExplanation`; deletes `BANK_STATEMENTS` and `EMPLOYMENT_INCOME_EVIDENCE` metadata rows.
- `fundsFormatBankAccount !== true` (when savings is on) → nulls every `savingsSource*` + `depositExplanation`; deletes `BANK_STATEMENTS` + `EMPLOYMENT_INCOME_EVIDENCE`.
- Neither `savingsSourceWages` nor `savingsSourceSelfEmployment` → deletes `EMPLOYMENT_INCOME_EVIDENCE`.
- `!fundsSourceInz1014 && !outwardSourceInz1014` → deletes `INZ1014_FINANCIAL_UNDERTAKING`.
- `!fundsSourcePrepaidAccom` → deletes `PREPAID_ACCOMMODATION_EVIDENCE`.
- `!outwardSourcePrepaidBooking` → deletes `OUTWARD_TRAVEL_EVIDENCE`.
- Scholarship inactive → nulls `scholarshipName` + `scholarshipOrganisation`; deletes `SCHOLARSHIP_EVIDENCE`.
- `tookEnglishTest !== true` → deletes `ENGLISH_TEST_RESULTS`.

Wrapped in `prisma.$transaction(...)` so a partial failure can't leave the row in a half-state.

## Security layers applied

- Standard controller guards + ownership check.
- Three encrypted parent columns (`depositExplanationEncrypted`, `scholarshipNameEncrypted`, `scholarshipOrganisationEncrypted`) + one encrypted child column (`customLabelEncrypted`, only populated when evidenceType = OTHER).
- MIME allowlist + 10MB cap reused from PR-13's metadata DTO.
- The other-evidence routes verify the row belongs to the caller's application before update or delete (`existing.visaApplicationId !== visa.id` → `ForbiddenException`).

## How to test it works (manual)

1. Open Step 14. The step requires data from earlier steps — set up a PhD-level student with at least one education entry and one CURRENT employment row first.
2. Verify the PhD-specific pickers (research proposal, publications list — if `phdPublishedPapers = true`) appear in the Evidence of study section.
3. Verify the previous-tertiary picker appears (because of the admission education entry) and the current-employment picker appears.
4. Tick `tookEnglishTest = Yes` — verify the English-results picker appears and is required.
5. Set tuition unpaid + method = `SCHOLARSHIP` — verify the scholarship sub-block appears with name + organisation inputs and the scholarship-evidence picker.
6. Tick `fundsSourceSavings + fundsFormatBankAccount + savingsSourceWages` — verify the bank-account block expands all the way down to BANK_STATEMENTS + EMPLOYMENT_INCOME_EVIDENCE pickers.
7. Add an "Other evidence" entry of type `COVER_LETTER` with a PDF.
8. Tick declaration, save. Reload — every encrypted free-text decrypts, every metadata row + other-evidence row round-trips.
9. Untick `fundsSourceSavings`, save. Reload — `BANK_STATEMENTS`, `EMPLOYMENT_INCOME_EVIDENCE`, `depositExplanation`, every `fundsFormat*`, every `savingsSource*` are all wiped.

## Known limitations

- **File storage is still deferred.** PR-15 will wire Supabase Storage and backfill against the existing metadata rows.
- **No Step 15 yet.** Saving Step 14 bumps `currentStep` to 15 but the user stays on Step 14 — Review and declare is the next planned step.
- The cascade-clear logic is the largest piece of business logic in the section. Any future change to a gate's semantics needs a matching change here and in the validate function on the frontend; the two must stay in sync.

## Commit reference

`6d9267c` — `feat(visa): VISA-PR-14 Supporting documents (2) (metadata only)`. 14 files changed, +2237/−7.
