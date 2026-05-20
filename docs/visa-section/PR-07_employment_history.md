# PR-07 — Employment history

## What this step does

Step 7 captures employment history in two repeating blocks. The first covers any employment the student has had (one optional `CURRENT` row + any number of `PREVIOUS` rows in a single table discriminated by `entryKind`). The second covers any unemployment or unpaid-service periods. Two policy declarations (`everGovernmentEmployed`, `everPrisonGuard`) and three gate booleans (`currentlyWorking`, `hadPreviousEmployment`, `everUnemployed`) live on the parent row.

## INZ source

INZ 1200 Online Student visa, "Employment history" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/<ts>_add_visa_employment/migration.sql`.
- **Backend:** `visa.service.ts` (Section-7 PATCH + employment/unemployment POST/PATCH/DELETE handlers), `visa.controller.ts` (six new routes).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step7EmploymentHistory.tsx` (new, ~750 LOC), `Step6EducationHistory.tsx` (advance to Step 7), `app/student/documents/page.tsx`.
- **i18n:** ~79 keys per locale (`visaEmployment*`, `visaUnemployment*`).

## Database changes

Parent-row additions on `VisaApplication`:

```text
everGovernmentEmployed, everPrisonGuard Boolean?
currentlyWorking, hadPreviousEmployment, everUnemployed Boolean?
```

New child table `VisaEmploymentEntry` (`visa_employment_entries`):

```text
id String PK
visaApplicationId String FK cascade
entryKind String                   // "CURRENT" | "PREVIOUS"
startDate, endDate DateTime?       // endDate null on the CURRENT row
roleTitle String?
dutiesEncrypted Bytes?             // free-text role description, encrypted
countryOfWork, stateOfWork String?
supervisorName String?
organisationField, organisationCountry, organisationState String?
employerName, employerStreet, employerSuburb, employerTownCity,
  employerSubregion, employerRegion, employerPostcode, employerPhone, employerEmail String?
sortOrder Int default 0
createdAt, updatedAt
```

New child table `VisaUnemploymentEntry` (`visa_unemployment_entries`):

```text
id String PK
visaApplicationId String FK cascade
startDate, endDate DateTime?
activityEncrypted Bytes?           // free-text "what were you doing"
financialSupportEncrypted Bytes?   // free-text "how were you funded"
sortOrder Int default 0
createdAt, updatedAt
```

`dutiesEncrypted`, `activityEncrypted`, and `financialSupportEncrypted` are PII. Everything else is cleartext.

Migration filename: `<ts>_add_visa_employment/migration.sql`.

## API endpoints

- `POST /students/me/visa/employment-entries` — add a row (`entryKind` decides CURRENT vs PREVIOUS).
- `PATCH /students/me/visa/employment-entries/:id` — update a row.
- `DELETE /students/me/visa/employment-entries/:id` — delete a row.
- `POST /students/me/visa/unemployment-entries` — add an unemployment row.
- `PATCH /students/me/visa/unemployment-entries/:id` — update.
- `DELETE /students/me/visa/unemployment-entries/:id` — delete.

Section 7's parent-row fields go through the shared `PATCH /students/me/visa/application` endpoint.

## Frontend

- Component: `Step7EmploymentHistory.tsx`, ~750 LOC.
- The two policy Y/Ns are top-of-step. Below them are three conditional repeating blocks driven by `currentlyWorking`, `hadPreviousEmployment`, and `everUnemployed`.
- The `CURRENT` block enforces "at most one row"; the others are unbounded.

## i18n

`visaEmployment*`, `visaUnemployment*`. About 79 keys per locale.

## Validation rules

- All five parent Y/Ns are required.
- `currentlyWorking = true` requires exactly one `CURRENT` employment entry with the full address + role + duties block filled.
- `hadPreviousEmployment = true` requires at least one `PREVIOUS` entry.
- `everUnemployed = true` requires at least one unemployment entry with `activity` filled.

## Server-side cascade clearing

- `currentlyWorking = false` deletes the existing CURRENT row.
- `hadPreviousEmployment = false` deletes every PREVIOUS row.
- `everUnemployed = false` deletes every unemployment row.

(All three clears happen in a single transaction on the parent PATCH.)

## Security layers applied

- Standard controller guards + per-row ownership checks on every employment/unemployment route.
- Three encrypted columns total (duties, activity, financial support).

## How to test it works (manual)

1. Open Step 7. Answer the two policy Y/Ns and the three gate Y/Ns (turn on current + previous + unemployed for the full test).
2. Add a CURRENT employment row with role, duties (long text), employer, supervisor, full address.
3. Add two PREVIOUS rows with end dates.
4. Add one unemployment row with start/end and a short description.
5. Save. Reload — every row + the encrypted free text round-trips.
6. Toggle "currentlyWorking" to No, save — the CURRENT row is gone, PREVIOUS rows remain.

## Known limitations

- The employer address block stores cleartext street/suburb/city/etc. — re-identifying. A future hardening could encrypt at least `employerStreet`.
- Dates carry full-day precision but INZ collects month-precision; we store day-1 of the month and surface mm/yyyy in the UI.

## Commit reference

`15430d9` — `VISA-PR-7: INZ Employment history section`. 12 files changed, +1703/−10.
