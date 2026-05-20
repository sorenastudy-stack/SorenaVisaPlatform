# PR-04 — Character

## What this step does

Step 4 captures the four mandatory character declarations INZ requires (any prior convictions, ongoing investigations, prior deportations, prior visa refusals), the police-certificate metadata (issue date, country of issue, in-English flag) — with the actual certificate file uploaded via the admission documents pipeline — plus a repeating block for additional citizenships when the student holds more than one.

## INZ source

INZ 1200 Online Student visa, "Character" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, three migration folders (main + two fix-ups).
- **Backend:** `visa.service.ts` (Section-4 PATCH allow-list + the `VisaOtherCitizenship` POST/PATCH/DELETE handlers), `visa.controller.ts` (three new routes), `admission/admission.service.ts` (`VISA_POLICE_CERTIFICATE` document type wiring).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `VisaDocumentUploader.tsx` (new — admission-documents-backed picker), `steps/Step4Character.tsx` (new, ~500 LOC), `Step3Eligibility.tsx` (advance to Step 4), `app/student/documents/page.tsx`.
- **i18n:** ~63 keys per locale (`visaCharacter*`).

## Database changes

Parent-row additions on `VisaApplication`:

```text
everConvicted, underInvestigation, everDeportedExcluded, everRefusedVisa Boolean?
policeCertIssueDate DateTime?
policeCertCountryOfIssue String?
policeCertInEnglish Boolean?
holdsOtherCitizenships, livedOtherCountry5Years Boolean?
```

New repeating child table `VisaOtherCitizenship` (`visa_other_citizenships`):

```text
id String PK
visaApplicationId String FK cascade
country String
holdsPassport Boolean
sortOrder Int default 0
createdAt, updatedAt
```

Enum extension: `VISA_POLICE_CERTIFICATE` added to `AdmissionDocumentType`.

Migration filenames: `<ts>_add_visa_character/`, `<ts>_add_admission_visa_police_certificate/`, `<ts>_add_visa_other_citizenships/`.

## API endpoints

- `PATCH /students/me/visa/application` — flat-field PATCH (extended allow-list).
- `POST /students/me/visa/citizenships` — add a citizenship row.
- `PATCH /students/me/visa/citizenships/:id` — update a row.
- `DELETE /students/me/visa/citizenships/:id` — remove a row.

## Frontend

- Component: `Step4Character.tsx`, ~500 LOC.
- New reusable subcomponent: `VisaDocumentUploader.tsx` — wraps the admission documents pipeline for visa-context uploads (police certificate today; later PRs use it as a reference).
- Conditional UI: police-certificate block is gated by the four declaration toggles; the citizenships repeating block is rendered only when `holdsOtherCitizenships = true`.

## i18n

`visaCharacter*`. About 63 keys per locale, including the four declaration labels, the police-cert sub-block, and the additional-citizenship row labels.

## Validation rules

- The four declaration Y/Ns are all required.
- Police certificate: issue date, country, and the in-English flag are required when the student has uploaded a certificate row.
- `holdsOtherCitizenships = true` requires at least one citizenship row, each with a country and the `holdsPassport` boolean populated.

## Server-side cascade clearing

- `holdsOtherCitizenships` flipping to false deletes every `VisaOtherCitizenship` row for that application atomically (in the same PATCH transaction).

## Security layers applied

- Standard controller guards + per-row ownership checks (the citizenship endpoints look up the row, walk the FK chain to the user's admission, and refuse to mutate rows that don't belong to the caller).
- No encrypted columns in this PR — every field is cleartext.

## How to test it works (manual)

1. Open Step 4.
2. Answer all four declarations (try a mix of Yes/No).
3. Upload a police certificate via the document uploader; fill the issue date / country / in-English flag.
4. Tick "I hold other citizenships" — verify the repeating block appears with an "add" button.
5. Add two citizenship rows.
6. Save — the four declarations + cert metadata save, and the two citizenship rows are persisted as separate child rows.
7. Toggle "other citizenships" back to No, save — both child rows should be gone on reload.

## Known limitations

- The police certificate is captured as admission-pipeline metadata; there's no visa-specific validation that the cert matches the passport country yet (left for the consultant to check).

## Commit reference

`6733009` — `VISA-PR-4: INZ Character section`. 16 files changed, +1235/−11.
