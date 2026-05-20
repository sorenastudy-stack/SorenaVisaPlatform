# PR-13 — Supporting documents

## What this step does

Step 13 is the first half of INZ's "Supporting documents" section: identity evidence (passport, optional national ID), residence visa if living outside the country of citizenship, military records if applicable, optional travel records, and an authority document if someone else is completing the form. The big architectural decision in this PR: **file storage is deferred to a future PR**. The browser extracts `originalFilename`, `mimeType`, and `sizeBytes` from each picked file and PUTs only those primitives. File bytes never reach the backend.

## INZ source

INZ 1200 Online Student visa, "Supporting documents" page (first of two).

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260520043244_visa_pr13_supporting_documents/migration.sql`.
- **Backend:** `dto/supporting-documents.dto.ts` (new), `visa.service.ts` (four new methods — see below), `visa.controller.ts` (four new routes, plus `Put` added to the Nest imports).
- **Frontend:** `lib/api.ts` (added `api.put`), `DocumentMetadataPicker.tsx` (new reusable subcomponent), `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step13SupportingDocuments.tsx` (new, ~400 LOC), `Step12ImmigrationAssistance.tsx` (advance to Step 13).
- **i18n:** ~43 keys per locale (`visaDocs*`).

## Database changes

Parent-row additions on `VisaApplication`:

```text
livingInDifferentCountry       Boolean?
countryOfResidenceEncrypted    Bytes?     // encrypted PII
areAllDocsInEnglish            Boolean?
```

New enum `VisaSupportingDocumentType` (initial 6 values; PR-14 extends to 23):

```text
PASSPORT
NATIONAL_ID
RESIDENCE_VISA
MILITARY_RECORD
TRAVEL_HISTORY
AUTHORITY_DOC
```

New child table `VisaSupportingDocument` (`visa_supporting_documents`):

```text
id String PK
visaApplicationId String FK cascade
documentType VisaSupportingDocumentType
originalFilename, mimeType String
sizeBytes Int
uploadedAt DateTime default now()
createdAt, updatedAt
UNIQUE(visaApplicationId, documentType)
INDEX(visaApplicationId)
```

The UNIQUE constraint enforces one metadata row per `(application, documentType)`, which is what makes the replace-on-upload pattern safe.

Migration filename: `20260520043244_visa_pr13_supporting_documents/migration.sql`.

## API endpoints

- `GET /students/me/visa/supporting-documents` — returns the three parent fields + metadata array.
- `PATCH /students/me/visa/supporting-documents` — saves the three parent fields; transactionally deletes the `RESIDENCE_VISA` metadata row if `livingInDifferentCountry` flips to false.
- `PUT /students/me/visa/supporting-documents/metadata` — upsert one metadata row (single transaction: deleteMany by the composite key, then create).
- `DELETE /students/me/visa/supporting-documents/metadata/:documentType` — remove a metadata row.

## Frontend

- New reusable subcomponent `DocumentMetadataPicker.tsx` (~200 LOC) — handles the file `<input>`, client-side MIME + size validation, and the PUT/DELETE calls. **File bytes never sent**: the picker reads `file.name`, `file.type`, `file.size` and sends just those primitives.
- Component: `Step13SupportingDocuments.tsx`, ~400 LOC.
- Conditional UI: residence-visa picker + country-of-residence text input only when `livingInDifferentCountry = true`. Military record picker only when `visa.everUndertakenMilitaryService === true` (PR-10's D2 gate). Authority document picker only when `visa.completingOnBehalf === true` (PR-12's gate).
- Cross-step reads: this is the first step that reads flags from earlier steps in the form context (no own state for those — pure derived UI).

## i18n

`visaDocs*`. About 43 keys per locale — section title + intro + deferral notice + guidance copy + six per-document labels with help text + picker BROWSE/REMOVE + the seven validation messages.

## Validation rules

- `areAllDocsInEnglish` required.
- `PASSPORT` metadata row required to complete the step.
- `livingInDifferentCountry = true` → `countryOfResidence` non-empty AND `RESIDENCE_VISA` metadata row required.
- `everUndertakenMilitaryService = true` (read from PR-10) → `MILITARY_RECORD` metadata row required.
- `completingOnBehalf = true` (read from PR-12) → `AUTHORITY_DOC` metadata row required.
- File picker enforces MIME ∈ `{application/pdf, image/jpeg, image/png}` and size ≤ 10MB client-side; the DTO re-checks server-side.

## Server-side cascade clearing

- `livingInDifferentCountry = false` → nulls `countryOfResidenceEncrypted` and deletes the `RESIDENCE_VISA` metadata row in the same transaction.

## Security layers applied

- Standard controller guards + ownership check.
- One encrypted parent column (`countryOfResidenceEncrypted`).
- MIME allowlist + 10MB cap re-checked server-side via the DTO's `@IsIn` and `@Max(MAX_SIZE_BYTES)`.
- The UNIQUE constraint protects against any race between concurrent uploads of the same document type.

## How to test it works (manual)

1. Open Step 13.
2. Answer "all docs in English" Y/N.
3. Pick a PDF for the passport slot — confirm filename + size show in the saved card with a REMOVE button.
4. Toggle "living in different country" Yes — verify the country input + residence-visa picker appear.
5. Try uploading a 12MB PDF — expect the inline "file too large" error and no metadata row created.
6. Try uploading a `.docx` — expect the "file type" error.
7. Upload a valid PDF for residence-visa, set country = "Australia", save. Reload — every metadata row + the country round-trip.
8. Flip the country gate to No, save. Reload — the `RESIDENCE_VISA` row is gone.

## Known limitations

- **File bytes are never stored anywhere.** The metadata row tells INZ which files the student says they have ready, but the actual blob has to be supplied out-of-band until PR-15 wires Supabase Storage.
- The PR-10 / PR-12 cross-step gates rely on flags already being present in the context; if a student lands on Step 13 directly without loading the earlier steps, the gates may briefly read `null` and skip the conditional pickers. The context loads everything on mount so this is more theoretical than real.

## Commit reference

`ab255be` — `feat(visa): VISA-PR-13 Supporting documents (metadata only)`. 14 files changed, +1159/−6.
