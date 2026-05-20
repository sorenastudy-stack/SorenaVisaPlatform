# PR-03 — Eligibility

## What this step does

Step 3 captures everything INZ uses to assess that the student is eligible for a Student visa: study-history flags, education-agent contact details, the course and provider being applied for, PhD-specific supervisor and publication details if applicable, the student's provider-issued ID, and six long free-text "intent and motivation" answers (home commitments, why NZ, why this provider, etc.). The free-text answers are encrypted; everything else is cleartext.

## INZ source

INZ 1200 Online Student visa, "Eligibility" page (covers Study history, Offer of Place assistance, Study details, PhD details, Student identification number, and Your situation and plans).

## Files created/changed

- **Schema/migration:** `schema.prisma`, two migration folders (one main + one fix-up).
- **Backend:** `visa.service.ts` (PATCH allow-list extended; six new encrypted fields wired through `encryptOrNull`).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step3Eligibility.tsx` (new, ~780 LOC), `Step2AddressContact.tsx` (advance to Step 3 on save), `lib/sorenaAgent.ts`.
- **i18n:** ~100 keys per locale (`visaEligibility*`).

## Database changes

All 28 new columns live on `VisaApplication`. All nullable.

```text
holdsNzStudentVisa Boolean?
usedEducationAgent Boolean?
agentOrganisationName, agentCountry, agentGivenName, agentSurname, agentEmail String?
studyingSchoolLevel Boolean?
studyingMastersOrPhd String?   // "PHD" | "MASTERS" | null — discriminator for PhD block
educationProviderName, studyLocation String?
courseRequiresOtherLocation Boolean?
courseProgrammeName String?
courseStartDate, courseEndDate, intendedArrivalDate DateTime?
phdDiscipline, phdSubject, phdSupervisorTitle, phdSupervisorGivenName,
  phdSupervisorSurname, phdSupervisorOrganisation String?
phdPublishedPapers, phdSupervisorOutsideNz Boolean?
providerIssuedStudentId Boolean?
studentIdNumber String?
homeCommitmentsEncrypted, studyRelatesDetailsEncrypted, whyStudyNzEncrypted,
  whyThisProviderEncrypted, howCourseBenefitsEncrypted, plansAfterStudyEncrypted Bytes?
studyRelatesToPrevious, studyingMultiYear Boolean?
```

Six of the columns are encrypted (the free-text intent fields). The PhD block is only meaningful when `studyingMastersOrPhd = 'PHD'`; PR-14 reads this flag to gate the PhD research-proposal document picker.

Migration filenames: `<ts>_add_visa_eligibility/`, `<ts>_visa_eligibility_fix/`.

## API endpoints

No new routes — Step 3 PATCHes the same `application` endpoint.

## Frontend

- Component: `Step3Eligibility.tsx`, ~780 LOC.
- Conditional UI: agent block shown only when `usedEducationAgent = true`. PhD-specific block shown only when `studyingMastersOrPhd = 'PHD'`. `studyRelatesToPrevious = true` reveals the encrypted detail textarea.
- Six long-form textareas drive the encrypted-fields list.

## i18n

`visaEligibility*`. About 100 keys per locale, covering 5 sub-sections + helper copy + validation messages.

## Validation rules

- `usedEducationAgent = true` requires every agent-* field to be non-empty.
- `studyingMastersOrPhd = 'PHD'` requires the supervisor block to be filled.
- `providerIssuedStudentId = true` requires `studentIdNumber`.
- Long-form intent answers are required (encrypted, non-empty after trim).

## Server-side cascade clearing

- `usedEducationAgent` flipping to false nulls every `agent*` field.
- `studyingMastersOrPhd` leaving `'PHD'` nulls every `phd*` field.
- `providerIssuedStudentId = false` nulls `studentIdNumber`.

## Security layers applied

- Standard controller guards + ownership check.
- Six new encrypted fields go through `CryptoService`.

## How to test it works (manual)

1. Open Step 3.
2. Tick "used an education agent" — verify the agent block expands and requires all five fields.
3. Pick a PhD as the study level — verify the supervisor block appears with its own fields.
4. Fill the six intent textareas with at least a sentence each.
5. Save. Reload — every value (including the encrypted textareas) should round-trip decoded.

## Known limitations

- The PhD branch is binary on the `studyingMastersOrPhd` string; if the value drifts (typo, future enum migration) the gating breaks silently. A future cleanup should turn this into a proper enum.

## Commit reference

`d1b9d6d` — `VISA-PR-3: INZ Eligibility section`. 12 files changed, +1236/−13.
