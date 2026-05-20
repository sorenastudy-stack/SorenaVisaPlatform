# PR-08 — Relationships

## What this step does

Step 8 captures every person INZ asks about in the relationships section: a current partner (at most one), any former partners, children, parents, siblings, and NZ-based contacts. Names, phone numbers, passport numbers, and street addresses are all PII and encrypted. The step reuses two flags from the admission row (`maritalStatus`, `hasChildren`) read-only — the visa form does not duplicate those columns.

## INZ source

INZ 1200 Online Student visa, "Relationships" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/<ts>_add_visa_relationships/migration.sql`.
- **Backend:** `visa.service.ts` (every PATCH/POST/DELETE handler for the six new tables — about 590 lines added), `visa.controller.ts` (15 new routes).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step8Relationships.tsx` (new, ~1230 LOC — the largest step component), `Step7EmploymentHistory.tsx` (advance to Step 8), `app/student/documents/page.tsx`.
- **i18n:** ~116 keys per locale (`visaRelationships*`, `visaPartner*`, `visaFormerPartner*`, `visaChildren*`, `visaParents*`, `visaSiblings*`, `visaNzContacts*`).

## Database changes

Parent-row additions on `VisaApplication`:

```text
hasFormerPartners, hasSiblings, hasNzContacts Boolean?
```

(Marital status and children-flag are deliberately *not* duplicated — they live on `admission.maritalStatus` and `admission.hasChildren` and the visa step reads them through the existing admission relation.)

Six new child tables — full column lists below. Every name field on every table is encrypted.

**`VisaPartner`** (`visa_partner`, singleton via `UNIQUE(visaApplicationId)`):
```text
relationshipToApplicant, gender, relationshipStatus, countryOfBirth, stateOfBirth,
  cityOfBirth, nationality, countryOfResidence, occupation, passportCountryOfIssue String?
dateOfBirth, passportIssueDate, passportExpiryDate DateTime?
givenNameEncrypted, middleNamesEncrypted, surnameEncrypted, passportNumberEncrypted Bytes?
holdsPassport Boolean?
```

**`VisaFormerPartner`** (`visa_former_partners`):
```text
givenNameEncrypted, middleNamesEncrypted, surnameEncrypted Bytes?
gender, relationshipStatus, countryOfBirth, nationality String?
dateOfBirth DateTime?
sortOrder Int default 0
```

**`VisaChild`** (`visa_children`):
```text
givenNameEncrypted, middleNamesEncrypted, surnameEncrypted Bytes?
gender, countryOfBirth, nationality, relationshipToApplicant String?
dateOfBirth DateTime?
livesWithApplicant Boolean?
sortOrder Int default 0
```

**`VisaParent`** (`visa_parents`):
```text
givenNameEncrypted, middleNamesEncrypted, surnameEncrypted Bytes?
relationshipToApplicant, gender, relationshipStatus, countryOfBirth,
  citizenship, countryOfResidence, occupation String?
isDeceased, dateOfBirthUnknown Boolean?
dateOfBirth DateTime?
sortOrder Int default 0
```

**`VisaSibling`** (`visa_siblings`): same shape as `VisaParent` minus the `isDeceased` field.

**`VisaNzContact`** (`visa_nz_contacts`):
```text
givenNameEncrypted, middleNamesEncrypted, surnameEncrypted Bytes?
relationshipToApplicant String?
phoneEncrypted, streetEncrypted Bytes?
email, suburb, townCity, region, postcode String?
sortOrder Int default 0
```

All six tables cascade-delete from `VisaApplication`.

Migration filename: `<ts>_add_visa_relationships/migration.sql`.

## API endpoints

15 new routes — each child table has its own POST/PATCH/DELETE except `VisaPartner` which uses PATCH only (singleton):

- `PATCH /students/me/visa/partner`
- `POST/PATCH/DELETE /students/me/visa/former-partners[/:id]`
- `POST/PATCH/DELETE /students/me/visa/children[/:id]`
- `POST/PATCH/DELETE /students/me/visa/parents[/:id]`
- `POST/PATCH/DELETE /students/me/visa/siblings[/:id]`
- `POST/PATCH/DELETE /students/me/visa/nz-contacts[/:id]`

Plus the three new parent gate flags via the shared `PATCH application` endpoint.

## Frontend

- Component: `Step8Relationships.tsx`, ~1230 LOC.
- Reuses `admission.maritalStatus` and `admission.hasChildren` to decide whether to render the partner / children blocks at all.
- Every encrypted-name input rounds-trips through the live POST/PATCH endpoint per row (no replace-on-save pattern; PR-8 predates that decision).

## i18n

`visaRelationships*`, `visaPartner*`, `visaFormerPartner*`, `visaChildren*`, `visaParents*`, `visaSiblings*`, `visaNzContacts*`. About 116 keys per locale across all six sub-sections.

## Validation rules

- The three gate Y/Ns are required.
- Each sub-section's "is there one?" Y/N controls whether at least one row is required.
- Within each child row, name + DOB (or `dateOfBirthUnknown = true` for parents/siblings) are required.
- NZ contact: phone is required when present (encrypted).

## Server-side cascade clearing

- Toggling any of the gate Y/Ns to false deletes every row in the corresponding child table.
- Toggling `admission.hasChildren` to false on the admission side does *not* automatically delete `VisaChild` rows — the consultant manages that linkage.

## Security layers applied

- Standard controller guards + per-row ownership checks (the row's `visaApplicationId` is verified against the caller's resolved visa application before any update or delete).
- Every name field on every table is encrypted via `CryptoService`, plus `passportNumberEncrypted` on `VisaPartner` and `phoneEncrypted` + `streetEncrypted` on `VisaNzContact`.

## How to test it works (manual)

1. On the admission form, set `maritalStatus = "MARRIED"` and `hasChildren = true`.
2. Open Step 8. Verify the partner sub-section is editable (married) and the children sub-section shows.
3. Fill partner details including passport number — save.
4. Add two children rows with names + DOB.
5. Add a parent + a sibling + one NZ contact.
6. Save. Reload — every encrypted name decrypts, every row shows.
7. Toggle `hasSiblings` to No, save — sibling rows are gone.

## Known limitations

- This step does the most encrypt/decrypt work — performance is fine at typical row counts (≤10 per table) but the service does N round-trips through `CryptoService` per response. A future hardening could batch.

## Commit reference

`33198d8` — `VISA-PR-8: INZ Relationships section`. 12 files changed, +2829/−4.
