# PR-12 — Immigration assistance

## What this step does

Step 12 captures whether someone other than the applicant is completing the visa form (an immigration adviser, lawyer, family member, friend, etc.) and, when an adviser is involved, the adviser's licensing number, full name, email, contact phone, and whether they should be the primary contact for INZ correspondence. The four adviser identifiers are PII and encrypted. This is a single-instance section (no child table) — everything lives on the parent row.

## INZ source

INZ 1200 Online Student visa, "Immigration assistance" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260520041829_visa_pr12_immigration_assistance/migration.sql`.
- **Backend:** `dto/immigration-assistance.dto.ts` (new), `visa.service.ts` (`getImmigrationAssistance` + `saveImmigrationAssistance`), `visa.controller.ts` (two new routes).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step12ImmigrationAssistance.tsx` (new, ~390 LOC), `Step11TravelHistory.tsx` (advance to Step 12).
- **i18n:** ~31 keys per locale (`visaImmigration*`).

## Database changes

Seven new parent-row columns on `VisaApplication`:

```text
completingOnBehalf             Boolean?
immigrationAssistanceCapacity  ImmigrationAssistanceCapacity?
adviserNumberEncrypted         Bytes?
adviserFullNameEncrypted       Bytes?
adviserEmailEncrypted          Bytes?
adviserContactNumberEncrypted  Bytes?
adviserIsPrimaryContact        Boolean?
```

New enum `ImmigrationAssistanceCapacity` — `LICENSED_IMMIGRATION_ADVISER`, `EXEMPT_PERSON`, `FAMILY_MEMBER`, `FRIEND`, `OTHER`. Only the first two unlock the adviser field block. No child tables.

Migration filename: `20260520041829_visa_pr12_immigration_assistance/migration.sql`.

## API endpoints

- `GET /students/me/visa/immigration-assistance` — returns gate + capacity + decrypted adviser block + primary-contact flag.
- `PATCH /students/me/visa/immigration-assistance` — saves the seven fields with server-side cascade clearing.

## Frontend

- Component: `Step12ImmigrationAssistance.tsx`, ~390 LOC.
- Conditional UI: capacity select only when `completingOnBehalf = true`; adviser block only when `capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}`.
- Local downstream clearing mirrors server clearing: flipping the gate to No or picking a non-adviser capacity wipes the adviser inputs immediately so the UI doesn't flash stale required-field warnings.

## i18n

`visaImmigration*`. About 31 keys per locale.

## Validation rules

- `completingOnBehalf` is required.
- `completingOnBehalf = true` → capacity required.
- `capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}` → all five adviser fields required:
  - `adviserNumber` non-empty.
  - `adviserFullName` non-empty.
  - `adviserEmail` valid email format (regex check after `class-validator`'s `@IsEmail`).
  - `adviserContactNumber` matches `^[+\d\s]{1,16}$` (digits, plus, spaces; max 16 chars).
  - `adviserIsPrimaryContact` is a boolean.

## Server-side cascade clearing

The service is the load-bearing piece here — every downstream field is wiped server-side when a higher gate removes its need:

- `completingOnBehalf = false` → nulls capacity + all four adviser PII + `adviserIsPrimaryContact`.
- `capacity ∈ {FAMILY_MEMBER, FRIEND, OTHER}` → nulls all four adviser PII + `adviserIsPrimaryContact`.

The transaction lives inside `saveImmigrationAssistance`; the encrypted columns are written as the cipher output of `null` if cleared.

## Security layers applied

- Standard controller guards + ownership check.
- Four encrypted columns (adviser number, full name, email, contact number) via `CryptoService`.
- The phone regex is enforced both client-side (zod-style local check) and server-side (DTO `@Matches`).

## How to test it works (manual)

1. Open Step 12. Toggle gate = No, save — confirm all downstream stays null.
2. Toggle gate = Yes, pick capacity = `FRIEND`, save — capacity persists, adviser block stays null.
3. Switch capacity to `LICENSED_IMMIGRATION_ADVISER` — verify the five-field adviser block appears.
4. Fill adviser number, full name, email (`adviser@example.com`), phone (`+64 21 555 1234`), primary contact = Yes.
5. Save. Reload — every adviser field decrypts and round-trips.
6. Switch capacity back to `FRIEND`, save — adviser block disappears, the server nulls all four PII fields.
7. Try saving with a 17-char phone — expect 400 with the regex message.

## Known limitations

- Adviser-number format isn't validated against the IAA registry (Sorena consultants do that out-of-band).
- The "primary contact" flag only persists when the adviser block is active; when the block is wiped, `adviserIsPrimaryContact` nulls too.

## Commit reference

`6fa4685` — `feat(visa): VISA-PR-12 Immigration assistance`. 12 files changed, +810/−5.
