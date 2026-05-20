# PR-02 — Address and contact

## What this step does

Step 2 captures the student's residential and postal addresses plus two contact phone numbers (preferred + alternative). Postal can be marked as "same as physical" to skip re-typing. The PR also added a small photo upload block to Step 1 (visa photo as a separate document type on the admission documents pipeline) and the visual stepper component that the rest of the section uses.

## INZ source

INZ 1200 Online Student visa, "Address and contact information" page.

## Files created/changed

- **Schema/migration:** `schema.prisma` plus three migration folders — one for the address columns, one for `VISA_PHOTO` added to `AdmissionDocumentType`, one auxiliary fix-up.
- **Backend:** `visa.service.ts` (encryption hooks for the two street fields), `admission/admission.service.ts` (photo document support).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `Step1IdentityDetails.tsx` (added the photo block), `steps/Step2AddressContact.tsx` (new, ~480 LOC), `VisaStepper.tsx` (new), `VisaPhotoUploader.tsx` (new).
- **i18n:** about 65 keys added to each locale (`visaAddress*`, `visaContact*`, `visaPhoto*`).

## Database changes

All 16 new columns live on `VisaApplication`. All nullable for partial drafts:

| Field | Type | Encrypted |
|-------|------|-----------|
| `physicalStreetEncrypted` | Bytes? | Yes |
| `physicalSuburb`, `physicalCity`, `physicalState`, `physicalPostcode`, `physicalCountry` | String? | — |
| `postalSameAsPhysical` | Boolean? | — |
| `postalStreetEncrypted` | Bytes? | Yes |
| `postalSuburb`, `postalCity`, `postalState`, `postalPostcode`, `postalCountry` | String? | — |
| `preferredContactCountryCode`, `preferredContactNumber`, `alternativeContactCountryCode`, `alternativeContactNumber` | String? | — |

Existing enum extension: `VISA_PHOTO` value added to `AdmissionDocumentType`.

Migration filenames: `<ts>_add_visa_address_contact/`, `<ts>_add_admission_visa_photo/`, plus one corrective migration.

## API endpoints

No new routes — Step 2 PATCHes the same `application` endpoint Step 1 uses. The photo upload runs through the existing admission documents pipeline.

## Frontend

- Page route: still `/student/documents`. `VisaFormShell` switches to `Step2AddressContact` when `activeStep === 2`.
- Component: `Step2AddressContact.tsx`, ~480 LOC.
- Conditional UI: the `postalSameAsPhysical` Y/N toggle hides every postal-address input when true.
- The stepper component (`VisaStepper.tsx`) was introduced in this PR and used by every later step.

## i18n

`visaAddress*`, `visaContact*`, `visaPhoto*`. About 65 keys per locale.

## Validation rules

- Country fields are searchable selects (`SearchableSelect` from PR-1).
- `postalSameAsPhysical = true` clears every postal-* input in the local state (mirrored server-side on save).
- Phone fields use a country-code + national-number split; INZ accepts that shape.

## Server-side cascade clearing

`postalSameAsPhysical = true` → the service mirrors the physical address into the postal columns on save, so the row stays self-consistent if a downstream reader ignores the gate flag.

## Security layers applied

- Same controller-level guards as PR-1.
- `physicalStreetEncrypted` and `postalStreetEncrypted` go through `CryptoService` (street addresses are reasonable re-identifiers in combination with other fields).
- Phone numbers are stored cleartext per the existing project decision (low re-identification risk on their own).

## How to test it works (manual)

1. Reach Step 2 from Step 1 (after a successful Step-1 save).
2. Upload a visa-format photo on Step 1's new photo block. Confirm it appears under `admission_documents` with `documentType = VISA_PHOTO`.
3. On Step 2, fill in a physical address; toggle "postal same as physical" — postal inputs should disappear.
4. Add a preferred contact phone and an alternative.
5. Save. Reload — every value should round-trip.

## Known limitations

- Phone format is free-text inside each input; the strict INZ phone-format check isn't enforced until PR-12 (which uses a `^[+\d\s]{1,16}$` pattern for adviser numbers and could be retrofitted here).

## Commit reference

`1b47a43` — `VISA-PR-2: INZ Address & contact + Identity Details photo block`. 14 files changed, +1125/−39.
